from __future__ import annotations

from datetime import datetime
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

        self.dns_addresses = str(credentials.get("dns_addresses") or "1.1.1.1")
        self.mtu = int(credentials.get("mtu") or 1460)
        self.keep_alive = int(credentials.get("keep_alive") or 21)
        self.endpoint_allowed_ip = str(credentials.get("endpoint_allowed_ip") or "0.0.0.0/0")
        self.allowed_ips_validation = bool(credentials.get("allowed_ips_validation", True))

        if not self.apikey:
            raise AdapterError("WGDashboard credentials must include 'apikey'")

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
        # Let WGDashboard apply its own default peer settings (official API behavior).
        # This avoids mismatch issues and guarantees downloadable .conf generation.
        payload = {"name": label}
        result = await self._post_json(f"/api/addPeers/{config_name}", payload)
        if not isinstance(result, list) or not result:
            raise AdapterError("WGDashboard addPeers returned an empty response")
        peer = result[0] if isinstance(result[0], dict) else {}
        remote_identifier = str(peer.get("id") or "").strip()
        if not remote_identifier:
            raise AdapterError("WGDashboard addPeers did not return peer id")
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
        # WGDashboard doesn't support data-limit/expire natively (handled by Guardino).
        return None

    async def delete_user(self, remote_identifier: str) -> None:
        config_name = await self._resolve_configuration_name()
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
        file_name = str(data.get("fileName") or "wireguard-peer").strip() or "wireguard-peer"
        if not file_name.lower().endswith(".conf"):
            file_name = f"{file_name}.conf"
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
        config_name = await self._resolve_configuration_name()
        data = await self._get_json("/api/getWireguardConfigurationInfo", params={"configurationName": config_name})
        if not isinstance(data, dict):
            return None
        peers = data.get("configurationPeers")
        if not isinstance(peers, list):
            return None
        for p in peers:
            if not isinstance(p, dict):
                continue
            if str(p.get("id") or "") != str(remote_identifier):
                continue
            val = p.get("total_data")
            try:
                return int(val)
            except Exception:
                return None
        return None
