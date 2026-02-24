from __future__ import annotations

from datetime import datetime
from typing import Any
import base64

import httpx
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey
from cryptography.hazmat.primitives import serialization

from app.services.adapters.base import AdapterError, ProvisionResult, TestConnectionResult


class WGDashboardAdapter:
    """WGDashboard adapter (v4.3.x).

    Node.credentials expected:
      {
        "apikey": "...",
        "interface": "wg0",
        "dns_addresses": "1.1.1.1",
        "mtu": 1460,
        "keep_alive": 21,
        "endpoint_allowed_ip": "0.0.0.0/0",
        "allowed_ips_validation": true
      }

    remote_identifier is stored as the peer public_key (base64).
    """

    def __init__(self, base_url: str, credentials: dict[str, Any], verify_ssl: bool = True, timeout: float = 20.0):
        self.base_url = base_url.rstrip("/")
        self.apikey = str(credentials.get("apikey") or "")
        self.interface = str(credentials.get("interface") or "wg0")
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

    async def _get_json(self, path: str) -> Any:
        url = f"{self.base_url}{path}"
        async with httpx.AsyncClient(verify=self.verify_ssl, timeout=self.timeout) as client:
            r = await client.get(url, headers=self._headers())
        if r.status_code >= 400:
            raise AdapterError(f"HTTP {r.status_code} GET {path}: {r.text[:300]}")
        return r.json() if r.text else None

    async def _post_json(self, path: str, payload: dict[str, Any]) -> Any:
        url = f"{self.base_url}{path}"
        async with httpx.AsyncClient(verify=self.verify_ssl, timeout=self.timeout) as client:
            r = await client.post(url, headers={**self._headers(), "Content-Type": "application/json"}, json=payload)
        if r.status_code >= 400:
            raise AdapterError(f"HTTP {r.status_code} POST {path}: {r.text[:300]}")
        return r.json() if r.text else None

    async def test_connection(self) -> TestConnectionResult:
        try:
            await self._get_json("/api/handshake")
            return TestConnectionResult(ok=True, detail="ok", meta=None)
        except Exception as e:
            return TestConnectionResult(ok=False, detail=str(e))

    def _gen_keypair(self) -> tuple[str, str]:
        priv = X25519PrivateKey.generate()
        pub = priv.public_key()
        priv_b64 = base64.b64encode(priv.private_bytes(encoding=serialization.Encoding.Raw, format=serialization.PrivateFormat.Raw, encryption_algorithm=serialization.NoEncryption())).decode()
        pub_b64 = base64.b64encode(pub.public_bytes(encoding=serialization.Encoding.Raw, format=serialization.PublicFormat.Raw)).decode()
        return priv_b64, pub_b64

    async def _get_available_ip(self) -> str:
        js = await self._get_json(f"/api/getAvailableIPs/{self.interface}")
        if isinstance(js, dict):
            ips = js.get("availableIPs") or js.get("available_ips") or js.get("ips")
            if isinstance(ips, list) and ips:
                return str(ips[0])
        if isinstance(js, list) and js:
            return str(js[0])
        raise AdapterError("WGDashboard: no available IP returned")

    async def provision_user(self, label: str, total_gb: int, expire_at: datetime) -> ProvisionResult:
        allowed_ip = await self._get_available_ip()
        priv_b64, pub_b64 = self._gen_keypair()

        payload = {
            "name": label,
            "private_key": priv_b64,
            "public_key": pub_b64,
            "allowed_ips": [allowed_ip],
            "allowed_ips_validation": self.allowed_ips_validation,
            "endpoint_allowed_ip": self.endpoint_allowed_ip,
            "dns_addresses": self.dns_addresses,
            "mtu": self.mtu,
            "keep_alive": self.keep_alive,
            "preshared_key": "",
        }
        await self._post_json(f"/api/addPeers/{self.interface}", payload)

        remote_identifier = pub_b64
        direct = await self.get_direct_subscription_url(remote_identifier)
        return ProvisionResult(remote_identifier=remote_identifier, direct_sub_url=direct, meta={"allowed_ip": allowed_ip})

    async def update_user_limits(self, remote_identifier: str, total_gb: int, expire_at: datetime) -> None:
        # WGDashboard doesn't support data-limit/expire natively (handled by Guardino).
        return None

    async def delete_user(self, remote_identifier: str) -> None:
        await self._post_json(f"/api/deletePeers/{self.interface}", {"peers": [remote_identifier]})

    async def set_status(self, remote_identifier: str, status: str) -> None:
        if status == "active":
            await self._post_json(f"/api/allowAccessPeers/{self.interface}", {"peers": [remote_identifier]})
        else:
            await self._post_json(f"/api/restrictPeers/{self.interface}", {"peers": [remote_identifier]})

    async def disable_user(self, remote_identifier: str) -> None:
        await self.set_status(remote_identifier, "disabled")

    async def enable_user(self, remote_identifier: str) -> None:
        await self.set_status(remote_identifier, "active")

    async def get_direct_subscription_url(self, remote_identifier: str) -> str | None:
        return f"{self.base_url}/api/downloadPeer/{self.interface}?id={remote_identifier}"

    async def revoke_subscription(self, label: str, remote_identifier: str, total_gb: int, expire_at: datetime) -> ProvisionResult:
        # Policy: delete & recreate peer (link changes).
        try:
            await self.delete_user(remote_identifier)
        except Exception:
            pass
        return await self.provision_user(label=label, total_gb=total_gb, expire_at=expire_at)

    async def reset_usage(self, remote_identifier: str) -> None:
        await self._post_json(f"/api/resetPeerData/{self.interface}", {"peers": [remote_identifier]})

    async def get_used_bytes(self, remote_identifier: str) -> int | None:
        # API doesn't provide a simple per-peer usage endpoint in this collection.
        return None
