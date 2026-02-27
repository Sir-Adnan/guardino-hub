from __future__ import annotations

import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx

from app.services.adapters.base import AdapterError, ProvisionResult, TestConnectionResult


class WGDashboardAdapter:
    """WGDashboard adapter (v4.3.x).

    Node.credentials expected (minimum):
      {
        "apikey": "...",
        "configuration_name": "wg0",  # optional, auto-detected if omitted
        "dns_addresses": "1.1.1.1",
        "mtu": 1460,
        "keep_alive": 21,
        "endpoint_allowed_ip": "0.0.0.0/0",
        "allowed_ips_validation": true
      }

    remote_identifier is stored as WG peer id/public_key (base64).
    """
    BYTES_PER_GB = 1024 ** 3

    def __init__(self, base_url: str, credentials: dict[str, Any], verify_ssl: bool = True, timeout: float = 20.0):
        self.base_url = base_url.rstrip("/")
        self.apikey = str(credentials.get("apikey") or "")
        self.configuration_name = str(
            credentials.get("configuration_name")
            or credentials.get("config_name")
            or credentials.get("interface")
            or ""
        ).strip()
        self.verify_ssl = verify_ssl
        self.timeout = timeout

        self.dns_addresses = str(credentials.get("dns_addresses") or "1.1.1.1").strip()
        self.mtu = self._as_int(credentials.get("mtu"), 1460)
        self.keep_alive = self._as_int(credentials.get("keep_alive"), 21)
        self.endpoint_allowed_ip = str(credentials.get("endpoint_allowed_ip") or "0.0.0.0/0")
        self.allowed_ips_validation = self._as_bool(credentials.get("allowed_ips_validation"), True)
        self.remote_endpoint = str(credentials.get("remote_endpoint") or "").strip()
        self.preshared_key = str(credentials.get("preshared_key") or "").strip()

        if not self.apikey:
            raise AdapterError("WGDashboard credentials must include 'apikey'")

    @staticmethod
    def _as_int(value: Any, default: int) -> int:
        try:
            if value is None:
                return default
            return int(str(value).strip())
        except Exception:
            return default

    @staticmethod
    def _as_bool(value: Any, default: bool) -> bool:
        if value is None:
            return default
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return bool(value)
        s = str(value).strip().lower()
        if s in {"1", "true", "yes", "on"}:
            return True
        if s in {"0", "false", "no", "off"}:
            return False
        return default

    def _headers(self) -> dict[str, str]:
        return {"Accept": "application/json", "wg-dashboard-apikey": self.apikey}

    def _extract_data_or_raise(self, payload: Any) -> Any:
        if isinstance(payload, dict) and "status" in payload:
            ok = bool(payload.get("status"))
            if not ok:
                msg = str(payload.get("message") or "WGDashboard API returned status=false")
                raise AdapterError(msg)
            return payload.get("data")
        return payload

    async def _get_json(self, path: str, params: dict[str, Any] | None = None) -> Any:
        url = f"{self.base_url}{path}"
        async with httpx.AsyncClient(verify=self.verify_ssl, timeout=self.timeout) as client:
            r = await client.get(url, headers=self._headers(), params=params)
        if r.status_code >= 400:
            raise AdapterError(f"HTTP {r.status_code} GET {path}: {r.text[:300]}")
        payload = r.json() if r.text else None
        return self._extract_data_or_raise(payload)

    async def _post_json(self, path: str, payload: dict[str, Any]) -> Any:
        url = f"{self.base_url}{path}"
        async with httpx.AsyncClient(verify=self.verify_ssl, timeout=self.timeout) as client:
            r = await client.post(url, headers={**self._headers(), "Content-Type": "application/json"}, json=payload)
        if r.status_code >= 400:
            raise AdapterError(f"HTTP {r.status_code} POST {path}: {r.text[:300]}")
        body = r.json() if r.text else None
        return self._extract_data_or_raise(body)

    async def _resolve_configuration_name(self) -> str:
        if self.configuration_name:
            return self.configuration_name

        data = await self._get_json("/api/getWireguardConfigurations")
        if not isinstance(data, list) or not data:
            raise AdapterError("WGDashboard has no WireGuard configuration available")

        for item in data:
            if isinstance(item, dict):
                name = str(item.get("Name") or "").strip()
                if name:
                    self.configuration_name = name
                    return name
        raise AdapterError("WGDashboard configuration discovery failed")

    async def _get_configuration_info(self) -> dict[str, Any]:
        config_name = await self._resolve_configuration_name()
        data = await self._get_json("/api/getWireguardConfigurationInfo", params={"configurationName": config_name})
        if not isinstance(data, dict):
            raise AdapterError("WGDashboard getWireguardConfigurationInfo returned invalid payload")
        return data

    async def _get_peer_info(self, remote_identifier: str) -> dict[str, Any] | None:
        data = await self._get_configuration_info()
        peers = data.get("configurationPeers")
        if not isinstance(peers, list):
            return None
        for peer in peers:
            if not isinstance(peer, dict):
                continue
            if str(peer.get("id") or "") == str(remote_identifier):
                return peer
        return None

    async def _delete_peer_volume_jobs(self, remote_identifier: str) -> None:
        peer = await self._get_peer_info(remote_identifier)
        if not isinstance(peer, dict):
            return
        jobs = peer.get("jobs")
        if not isinstance(jobs, list):
            return
        for job in jobs:
            if not isinstance(job, dict):
                continue
            if str(job.get("Peer") or "") != str(remote_identifier):
                continue
            if str(job.get("Field") or "").lower() != "total_data":
                continue
            if str(job.get("Action") or "").lower() != "restrict":
                continue
            try:
                await self._post_json("/api/deletePeerScheduleJob", {"Job": job})
            except Exception:
                # best-effort cleanup to avoid duplicate/legacy jobs
                continue

    async def _sync_peer_volume_job(self, remote_identifier: str, total_gb: int) -> None:
        safe_total = max(0, int(total_gb))
        await self._delete_peer_volume_jobs(remote_identifier)
        if safe_total <= 0:
            return

        config_name = await self._resolve_configuration_name()
        value_bytes = safe_total * self.BYTES_PER_GB
        stable_job_id = str(
            uuid.uuid5(uuid.NAMESPACE_URL, f"guardino:{self.base_url}:{config_name}:{remote_identifier}:total_data")
        )
        job = {
            "JobID": stable_job_id,
            "Configuration": config_name,
            "Peer": str(remote_identifier),
            "Field": "total_data",
            "Operator": "lgt",
            "Value": str(value_bytes),
            "CreationDate": "",
            "ExpireDate": "",
            "Action": "restrict",
        }
        await self._post_json("/api/savePeerScheduleJob", {"Job": job})

    async def _build_add_peer_payload(self, label: str) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "name": label,
            "allowed_ips_validation": self.allowed_ips_validation,
            "dns_addresses": self.dns_addresses,
            "mtu": self.mtu,
            "keep_alive": self.keep_alive,
            "endpoint_allowed_ip": self.endpoint_allowed_ip,
        }
        if self.remote_endpoint:
            payload["remote_endpoint"] = self.remote_endpoint
        if self.preshared_key:
            payload["preshared_key"] = self.preshared_key

        # Use a deterministic available address when possible.
        # If the API call fails, WGDashboard default behavior is still valid.
        try:
            available_ip = await self._get_available_ip()
            if available_ip:
                payload["allowed_ips"] = [available_ip]
        except Exception:
            pass
        return payload

    async def test_connection(self) -> TestConnectionResult:
        try:
            await self._get_json("/api/handshake")
            config_name = await self._resolve_configuration_name()
            return TestConnectionResult(ok=True, detail="ok", meta={"configuration_name": config_name})
        except Exception as e:
            return TestConnectionResult(ok=False, detail=str(e))

    async def _get_available_ip(self) -> str:
        config_name = await self._resolve_configuration_name()
        data = await self._get_json(f"/api/getAvailableIPs/{config_name}")
        if isinstance(data, dict):
            for _subnet, ip_list in data.items():
                if isinstance(ip_list, list):
                    for candidate in ip_list:
                        s = str(candidate or "").strip()
                        if s:
                            return s
        if isinstance(data, list):
            for candidate in data:
                s = str(candidate or "").strip()
                if s:
                    return s
        raise AdapterError("WGDashboard: no available IP returned")

    async def provision_user(self, label: str, total_gb: int, expire_at: datetime) -> ProvisionResult:
        config_name = await self._resolve_configuration_name()
        payload = await self._build_add_peer_payload(label)
        try:
            result = await self._post_json(f"/api/addPeers/{config_name}", payload)
        except Exception:
            # Fallback: let WGDashboard use dashboard defaults.
            # Some deployments may reject strict custom fields.
            result = await self._post_json(f"/api/addPeers/{config_name}", {"name": label})
        if not isinstance(result, list) or not result:
            raise AdapterError("WGDashboard addPeers returned an empty response")
        peer = result[0] if isinstance(result[0], dict) else {}
        remote_identifier = str(peer.get("id") or "").strip()
        if not remote_identifier:
            raise AdapterError("WGDashboard addPeers did not return peer id")

        # Explicitly allow access (idempotent) and sync schedule limit.
        try:
            await self.enable_user(remote_identifier)
        except Exception:
            pass
        try:
            await self._sync_peer_volume_job(remote_identifier, total_gb)
        except Exception:
            # Guardino local enforcement still applies even if peer job fails.
            pass

        direct = await self.get_direct_subscription_url(remote_identifier)
        return ProvisionResult(
            remote_identifier=remote_identifier,
            direct_sub_url=direct,
            meta={
                "configuration_name": config_name,
                "allowed_ip": peer.get("allowed_ip"),
                "name": peer.get("name"),
            },
        )

    async def update_user_limits(self, remote_identifier: str, total_gb: int, expire_at: datetime) -> None:
        # WGDashboard does not have native quota/expiry fields per peer.
        # We mirror Guardino traffic limit via peer schedule jobs.
        await self._sync_peer_volume_job(remote_identifier, total_gb)

    async def delete_user(self, remote_identifier: str) -> None:
        config_name = await self._resolve_configuration_name()
        try:
            await self._delete_peer_volume_jobs(remote_identifier)
        except Exception:
            pass
        await self._post_json(f"/api/deletePeers/{config_name}", {"peers": [remote_identifier]})

    async def set_status(self, remote_identifier: str, status: str) -> None:
        config_name = await self._resolve_configuration_name()
        if status == "active":
            await self._post_json(f"/api/allowAccessPeers/{config_name}", {"peers": [remote_identifier]})
        else:
            await self._post_json(f"/api/restrictPeers/{config_name}", {"peers": [remote_identifier]})

    async def disable_user(self, remote_identifier: str) -> None:
        await self.set_status(remote_identifier, "disabled")

    async def enable_user(self, remote_identifier: str) -> None:
        await self.set_status(remote_identifier, "active")

    async def get_direct_subscription_url(self, remote_identifier: str) -> str | None:
        config_name = await self._resolve_configuration_name()
        encoded = quote(remote_identifier, safe="")
        return f"{self.base_url}/api/downloadPeer/{config_name}?id={encoded}"

    async def download_peer_config(self, remote_identifier: str) -> tuple[str, str]:
        config_name = await self._resolve_configuration_name()
        data = await self._get_json(f"/api/downloadPeer/{config_name}", params={"id": remote_identifier})
        if not isinstance(data, dict):
            raise AdapterError("WGDashboard downloadPeer returned invalid payload")
        file_content = str(data.get("file") or "")
        if not file_content.strip():
            raise AdapterError("WGDashboard did not return peer config content")
        raw_file_name = str(data.get("fileName") or "wireguard-peer").strip() or "wireguard-peer"
        name_only = Path(raw_file_name).name
        stem = Path(name_only).stem or "wireguard-peer"
        stem = re.sub(r"[^a-zA-Z0-9_.-]+", "_", stem).strip("._-") or "wireguard-peer"
        file_name = f"{stem}.conf"
        return file_name, file_content

    async def revoke_subscription(self, label: str, remote_identifier: str, total_gb: int, expire_at: datetime) -> ProvisionResult:
        # Policy: delete & recreate peer (link changes).
        try:
            await self.delete_user(remote_identifier)
        except Exception:
            pass
        return await self.provision_user(label=label, total_gb=total_gb, expire_at=expire_at)

    async def reset_usage(self, remote_identifier: str) -> None:
        config_name = await self._resolve_configuration_name()
        await self._post_json(f"/api/resetPeerData/{config_name}", {"id": remote_identifier, "type": "total"})

    async def get_used_bytes(self, remote_identifier: str) -> int | None:
        peer = await self._get_peer_info(remote_identifier)
        if not isinstance(peer, dict):
            return None
        val = peer.get("total_data")
        try:
            return int(val)
        except Exception:
            return None
