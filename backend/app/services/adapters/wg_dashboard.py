from __future__ import annotations

from datetime import datetime
from typing import Any

import httpx

from app.services.adapters.base import AdapterError, ProvisionResult, TestConnectionResult


class WGDashboardAdapter:
    """WGDashboard adapter (minimal v4.x support).

    Credentials JSON expected on the node:
      {"apikey": "...", "interface": "wg0"}

    NOTE: WGDashboard doesn't provide "subscription" in the same sense.
    For now we return a download URL for the peer config (requires apikey header).
    """

    def __init__(self, base_url: str, credentials: dict[str, Any], verify_ssl: bool = True, timeout: float = 20.0):
        self.base_url = base_url.rstrip("/")
        self.apikey = str(credentials.get("apikey") or "")
        self.interface = str(credentials.get("interface") or "wg0")
        self.verify_ssl = verify_ssl
        self.timeout = timeout

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
        return r.json()

    async def _post_json(self, path: str, payload: dict[str, Any]) -> Any:
        url = f"{self.base_url}{path}"
        async with httpx.AsyncClient(verify=self.verify_ssl, timeout=self.timeout) as client:
            r = await client.post(url, headers={**self._headers(), "Content-Type": "application/json"}, json=payload)
        if r.status_code >= 400:
            raise AdapterError(f"HTTP {r.status_code} POST {path}: {r.text[:300]}")
        return r.json()

    async def test_connection(self) -> TestConnectionResult:
        try:
            js = await self._get_json("/api/app")
            return TestConnectionResult(ok=True, detail="ok", meta={"app": js})
        except Exception as e:
            return TestConnectionResult(ok=False, detail=str(e))

    async def provision_user(self, label: str, total_gb: int, expire_at: datetime) -> ProvisionResult:
        # WGDashboard doesn't support data-limit/expire natively; expiry can be managed by Guardino.
        payload = {"peerCount": 1, "peerName": label}
        js = await self._post_json(f"/api/addPeers/{self.interface}", payload)

        # Try to read created peer id from response; if missing, return label.
        peer_id = None
        if isinstance(js, dict):
            # observed patterns: {"success":true,"peers":[{"id":"..."}]}
            peers = js.get("peers")
            if isinstance(peers, list) and peers and isinstance(peers[0], dict):
                peer_id = peers[0].get("id") or peers[0].get("publicKey")

        remote_identifier = str(peer_id or label)
        # download link for peer (requires apikey header)
        direct = f"{self.base_url}/api/downloadPeer/{self.interface}?id={remote_identifier}"
        return ProvisionResult(remote_identifier=remote_identifier, direct_sub_url=direct, meta=None)

    async def update_user_limits(self, remote_identifier: str, total_gb: int, expire_at: datetime) -> None:
        # Not supported natively.
        return None

    async def delete_user(self, remote_identifier: str) -> None:
        # Best-effort: remove peer by id.
        await self._post_json(f"/api/deletePeer/{self.interface}", {"peerId": remote_identifier})

    async def set_status(self, remote_identifier: str, status: str) -> None:
        # Best-effort: toggle peer.
        is_active = status == "active"
        await self._post_json(f"/api/togglePeer/{self.interface}", {"peerId": remote_identifier, "enabled": is_active})

    async def disable_user(self, remote_identifier: str) -> None:
        await self.set_status(remote_identifier, "disabled")

    async def enable_user(self, remote_identifier: str) -> None:
        await self.set_status(remote_identifier, "active")

    async def get_used_bytes(self, remote_identifier: str) -> int | None:
        # If available, return 0.
        return None
