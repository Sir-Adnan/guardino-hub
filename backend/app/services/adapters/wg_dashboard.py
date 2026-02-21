from __future__ import annotations
from typing import Any
from datetime import datetime, timezone
import uuid
import httpx

from app.services.http_client import build_async_client
from app.services.adapters.base import TestConnectionResult, AdapterError, ProvisionResult
from app.services.wg_keys import generate_wg_keypair

def _fmt_dt(dt: datetime) -> str:
    # WGDashboard examples use: "YYYY-MM-DD HH:MM:SS"
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

class WGDashboardAdapter:
    """WGDashboard adapter.
    Expected credentials:
      {
        "apikey": "...",
        "configuration": "wg-external",
        "ip_prefix": "10.0.0.",
        "ip_start": 2,
        "ip_end": 254,
        "dns": "1.1.1.1",
        "mtu": 1460,
        "keep_alive": 21,
        "endpoint_allowed_ip": "0.0.0.0/0"
      }
    """

    def __init__(self, base_url: str, credentials: dict[str, Any]):
        self.base_url = base_url.rstrip("/")
        self.apikey = str(credentials.get("apikey", "")).strip()
        self.configuration = str(credentials.get("configuration", "")).strip()
        self.ip_prefix = str(credentials.get("ip_prefix", "10.0.0.")).strip()
        self.ip_start = int(credentials.get("ip_start", 2))
        self.ip_end = int(credentials.get("ip_end", 254))
        self.dns = str(credentials.get("dns", "1.1.1.1")).strip()
        self.mtu = int(credentials.get("mtu", 1460))
        self.keep_alive = int(credentials.get("keep_alive", 21))
        self.endpoint_allowed_ip = str(credentials.get("endpoint_allowed_ip", "0.0.0.0/0")).strip()

    async def test_connection(self) -> TestConnectionResult:
        if not self.apikey:
            return TestConnectionResult(ok=False, detail="Missing credentials: apikey")
        url = f"{self.base_url}/api/handshake"
        try:
            async with build_async_client() as client:
                r = await client.get(url, headers={"wg-dashboard-apikey": self.apikey})
                if r.status_code >= 400:
                    return TestConnectionResult(ok=False, detail=f"HTTP {r.status_code}: {r.text[:200]}")
                js = r.json() if r.headers.get("content-type","").startswith("application/json") else {"raw": r.text[:200]}
                return TestConnectionResult(ok=True, detail="OK", meta={"response": js})
        except httpx.RequestError as e:
            return TestConnectionResult(ok=False, detail=f"Request error: {e}")
        except Exception as e:
            raise AdapterError(str(e)) from e

    async def _pick_free_ip(self, client: httpx.AsyncClient) -> str:
        url = f"{self.base_url}/api/ping/getAllPeersIpAddress"
        r = await client.get(url, headers={"wg-dashboard-apikey": self.apikey})
        r.raise_for_status()
        js = r.json()
        used = set()
        # Best-effort parse
        data = js.get("data") or js.get("Data") or []
        if isinstance(data, list):
            for item in data:
                ip = item.get("ip_address") or item.get("IPAddress") or item.get("ip")
                if ip:
                    used.add(str(ip).strip())
        for i in range(self.ip_start, self.ip_end + 1):
            ip = f"{self.ip_prefix}{i}"
            if ip not in used:
                return ip
        raise AdapterError("No free IP address found")

    async def provision_user(self, label: str, total_gb: int, expire_at: datetime) -> ProvisionResult:
        if not self.apikey or not self.configuration:
            raise AdapterError("Missing credentials: apikey/configuration")

        priv_b64, pub_b64 = generate_wg_keypair()

        async with build_async_client() as client:
            ip = await self._pick_free_ip(client)

            # Add peer
            url_add = f"{self.base_url}/api/addPeers/{self.configuration}"
            payload = {
                "name": label,
                "private_key": priv_b64,
                "public_key": pub_b64,
                "allowed_ips": [f"{ip}/32"],
                "allowed_ips_validation": True,
                "endpoint_allowed_ip": self.endpoint_allowed_ip,
                "dns_addresses": self.dns,
                "mtu": self.mtu,
                "keep_alive": self.keep_alive,
                "preshared_key": "",
            }
            ra = await client.post(url_add, headers={"wg-dashboard-apikey": self.apikey}, json=payload)
            ra.raise_for_status()

            # Create share link (direct url for customers) with ExpireDate
            url_share = f"{self.base_url}/api/sharePeer/create"
            rs = await client.post(
                url_share,
                headers={"wg-dashboard-apikey": self.apikey},
                json={"Configuration": self.configuration, "Peer": pub_b64, "ExpireDate": _fmt_dt(expire_at)},
            )
            rs.raise_for_status()
            js = rs.json()
            share_id = (js.get("data") or {}).get("ShareID") or (js.get("Data") or {}).get("ShareID") or js.get("ShareID")
            direct = None
            if share_id:
                direct = f"{self.base_url}/api/sharePeer/get?ShareID={share_id}"

            # Enforce volume with schedule job (total_data > total_gb => restrict)
            try:
                job_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"guardino:{self.configuration}:{pub_b64}:total_data"))
                url_job = f"{self.base_url}/api/savePeerScheduleJob"
                job_payload = {
                    "Job": {
                        "JobID": job_id,
                        "Configuration": self.configuration,
                        "Peer": pub_b64,
                        "Field": "total_data",
                        "Operator": "lgt",
                        "Value": str(int(total_gb)),
                        "CreationDate": "",
                        "ExpireDate": "",
                        "Action": "restrict",
                    }
                }
                rj = await client.post(url_job, headers={"wg-dashboard-apikey": self.apikey}, json=job_payload)
                # do not hard fail if schedule job isn't supported on some installs
                if rj.status_code >= 400:
                    pass
            except Exception:
                pass

            return ProvisionResult(remote_identifier=pub_b64, direct_sub_url=direct, meta={"ip": ip, "share_id": share_id, "configuration": self.configuration})

    async def get_direct_subscription_url(self, remote_identifier: str) -> str | None:
        # If we previously created a share link, Guardino stores it as cached url; we do not recreate here.
        return None

    async def update_user_limits(self, remote_identifier: str, total_gb: int, expire_at) -> None:
        # Update share link expiry if we can recover ShareID from cached URL is handled by API layer (not adapter).
        # Update schedule job value for total_data
        async with build_async_client() as client:
            try:
                job_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"guardino:{self.configuration}:{remote_identifier}:total_data"))
                url_job = f"{self.base_url}/api/savePeerScheduleJob"
                job_payload = {
                    "Job": {
                        "JobID": job_id,
                        "Configuration": self.configuration,
                        "Peer": remote_identifier,
                        "Field": "total_data",
                        "Operator": "lgt",
                        "Value": str(int(total_gb)),
                        "CreationDate": "",
                        "ExpireDate": "",
                        "Action": "restrict",
                    }
                }
                await client.post(url_job, headers={"wg-dashboard-apikey": self.apikey}, json=job_payload)
            except Exception:
                pass

    async def delete_user(self, remote_identifier: str) -> None:
        async with build_async_client() as client:
            await client.post(
                f"{self.base_url}/api/deletePeers/{self.configuration}",
                headers={"wg-dashboard-apikey": self.apikey},
                json={"peers": [remote_identifier]},
            )

async def set_status(self, remote_identifier: str, status: str) -> None:
    # Map statuses to WG actions
    # active -> allowAccessPeers
    # limited/disabled/expired -> restrictPeers
    action = "allow" if status == "active" else "restrict"
    async with build_async_client() as client:
        if action == "allow":
            await client.post(
                f"{self.base_url}/api/allowAccessPeers/{self.configuration}",
                headers={"wg-dashboard-apikey": self.apikey},
                json={"peers": [remote_identifier]},
            )
        else:
            await client.post(
                f"{self.base_url}/api/restrictPeers/{self.configuration}",
                headers={"wg-dashboard-apikey": self.apikey},
                json={"peers": [remote_identifier]},
            )

async def get_used_bytes(self, remote_identifier: str) -> int | None:
    # WGDashboard does not provide per-peer total bytes in this collection reliably.
    # Volume is enforced by schedule job (total_data) configured at provision time.
    return None
