from __future__ import annotations
from typing import Any
from datetime import datetime, timezone
import httpx
import base64

from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey
from cryptography.hazmat.primitives import serialization

from app.services.http_client import build_async_client
from app.services.adapters.base import TestConnectionResult, AdapterError, ProvisionResult

def _b64_key(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")

def _gen_x25519_keypair() -> tuple[str, str]:
    priv = X25519PrivateKey.generate()
    pub = priv.public_key()
    priv_bytes = priv.private_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PrivateFormat.Raw,
        encryption_algorithm=serialization.NoEncryption(),
    )
    pub_bytes = pub.public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    return _b64_key(priv_bytes), _b64_key(pub_bytes)

class WGDashboardAdapter:
    """WGDashboard adapter using official endpoints.

    Expected credentials (node.credentials JSON):
      {
        "apikey": "...",
        "configuration": "wg0",
        "ip_prefix": "10.29.1.",   # chooses first free: ip_prefix + N
        "ip_start": 2,
        "ip_end": 254,
        "dns": "1.1.1.1",
        "mtu": 1460,
        "keep_alive": 21
      }

    Direct link strategy:
      - create share link via POST /api/sharePeer/create
      - return direct URL: /api/sharePeer/get?ShareID=...
    """

    def __init__(self, base_url: str, credentials: dict[str, Any]):
        self.base_url = base_url.rstrip("/")
        self.apikey = str(credentials.get("apikey", "")).strip()
        self.configuration = str(credentials.get("configuration", "")).strip()

        self.ip_prefix = str(credentials.get("ip_prefix", "")).strip()
        self.ip_start = int(credentials.get("ip_start", 2))
        self.ip_end = int(credentials.get("ip_end", 254))

        self.dns = str(credentials.get("dns", "1.1.1.1")).strip()
        self.mtu = int(credentials.get("mtu", 1460))
        self.keep_alive = int(credentials.get("keep_alive", 21))

    def _auth_headers(self) -> dict[str, str]:
        return {"wg-dashboard-apikey": self.apikey}

    async def test_connection(self) -> TestConnectionResult:
        if not self.apikey:
            return TestConnectionResult(ok=False, detail="Missing credentials: apikey")
        url = f"{self.base_url}/api/handshake"
        try:
            async with build_async_client() as client:
                r = await client.get(url, headers=self._auth_headers())
                if r.status_code >= 400:
                    return TestConnectionResult(ok=False, detail=f"HTTP {r.status_code}: {r.text[:200]}")
                return TestConnectionResult(ok=True, detail="OK")
        except httpx.RequestError as e:
            return TestConnectionResult(ok=False, detail=f"Request error: {e}")
        except Exception as e:
            return TestConnectionResult(ok=False, detail=str(e))

    async def _get_used_ips(self) -> set[str]:
        # returns set of used IP strings (e.g., '10.29.1.1')
        url = f"{self.base_url}/api/ping/getAllPeersIpAddress"
        async with build_async_client() as client:
            r = await client.get(url, headers=self._auth_headers())
            if r.status_code >= 400:
                raise AdapterError(f"Get used IPs failed: HTTP {r.status_code}: {r.text[:200]}")
            js = r.json()
            data = js.get("data") or {}
            cfg = data.get(self.configuration) or {}
            used = set()
            for _, info in cfg.items():
                ips = info.get("allowed_ips") or []
                for ip in ips:
                    # may contain mask, e.g. 10.29.1.1 or 10.29.1.1/32
                    used.add(str(ip).split("/")[0])
            return used

    async def _pick_ip(self) -> str:
        if not self.configuration:
            raise AdapterError("Missing credentials: configuration")
        if not self.ip_prefix:
            raise AdapterError("Missing credentials: ip_prefix")
        used = await self._get_used_ips()
        for i in range(self.ip_start, self.ip_end + 1):
            ip = f"{self.ip_prefix}{i}"
            if ip not in used:
                return ip
        raise AdapterError("No free IP available in pool")

    async def provision_user(self, label: str, total_gb: int, expire_at: datetime) -> ProvisionResult:
        if not self.apikey:
            raise AdapterError("Missing credentials: apikey")
        if not self.configuration:
            raise AdapterError("Missing credentials: configuration")

        ip = await self._pick_ip()
        priv, pub = _gen_x25519_keypair()

        add_url = f"{self.base_url}/api/addPeers/{self.configuration}"
        peer_name = label

        payload = {
            "name": peer_name,
            "private_key": priv,
            "public_key": pub,
            "allowed_ips": [f"{ip}/32"],
            "allowed_ips_validation": True,
            "endpoint_allowed_ip": "0.0.0.0/0",
            "dns_addresses": self.dns,
            "mtu": self.mtu,
            "keep_alive": self.keep_alive,
            "preshared_key": "",
        }

        async with build_async_client() as client:
            r = await client.post(add_url, json=payload, headers=self._auth_headers())
            if r.status_code >= 400:
                raise AdapterError(f"Add peer failed: HTTP {r.status_code}: {r.text[:300]}")
            js = r.json() if r.headers.get("content-type","").startswith("application/json") else {"raw": r.text[:200]}

        # Create share link (better for end-user)
        share_url = f"{self.base_url}/api/sharePeer/create"
        expire_str = expire_at.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        share_payload = {"Configuration": self.configuration, "Peer": pub, "ExpireDate": expire_str}

        async with build_async_client() as client:
            r2 = await client.post(share_url, json=share_payload, headers=self._auth_headers())
            if r2.status_code >= 400:
                raise AdapterError(f"Share link create failed: HTTP {r2.status_code}: {r2.text[:300]}")
            js2 = r2.json()
            # expected: {"data":[{"ShareID":"..."}], "status": true}
            share_id = None
            if isinstance(js2.get("data"), list) and js2["data"]:
                share_id = js2["data"][0].get("ShareID")
            if not share_id:
                raise AdapterError("ShareID not found in response")
            direct = f"{self.base_url}/api/sharePeer/get?ShareID={share_id}"

        # remote_identifier: we use public key (unique)
        return ProvisionResult(remote_identifier=pub, direct_sub_url=direct, meta={"ip": ip, "share_id": share_id, "add_peers_response": js})

async def get_direct_subscription_url(self, remote_identifier: str) -> str | None:
    # WGDashboard direct link should be created at provision time (sharePeer). We cannot reliably recreate without more stored data.
    return None
