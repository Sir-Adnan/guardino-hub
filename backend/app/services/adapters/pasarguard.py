from __future__ import annotations

from datetime import datetime
from typing import Any

import httpx

from app.services.adapters.base import AdapterError, ProvisionResult, TestConnectionResult


class PasarguardAdapter:
    def __init__(self, base_url: str, token: str | None = None, verify_ssl: bool = True, timeout: float = 20.0):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.verify_ssl = verify_ssl
        self.timeout = timeout

    def _headers(self) -> dict[str, str]:
        h = {"Accept": "application/json"}
        if self.token:
            h["Authorization"] = f"Bearer {self.token}"
        return h

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

    async def _put_json(self, path: str, payload: dict[str, Any]) -> Any:
        url = f"{self.base_url}{path}"
        async with httpx.AsyncClient(verify=self.verify_ssl, timeout=self.timeout) as client:
            r = await client.put(url, headers={**self._headers(), "Content-Type": "application/json"}, json=payload)
        if r.status_code >= 400:
            raise AdapterError(f"HTTP {r.status_code} PUT {path}: {r.text[:300]}")
        return r.json() if r.text else None

    async def _delete(self, path: str) -> None:
        url = f"{self.base_url}{path}"
        async with httpx.AsyncClient(verify=self.verify_ssl, timeout=self.timeout) as client:
            r = await client.delete(url, headers=self._headers())
        if r.status_code >= 400:
            raise AdapterError(f"HTTP {r.status_code} DELETE {path}: {r.text[:300]}")

    async def test_connection(self) -> TestConnectionResult:
        try:
            js = await self._get_json("/api/system")
            return TestConnectionResult(ok=True, detail="ok", meta={"system": js})
        except Exception as e:
            return TestConnectionResult(ok=False, detail=str(e))

    async def _pick_default_template_id(self) -> str | None:
        """Try to find a template for 'from_template' provisioning."""
        try:
            js = await self._get_json("/api/user_templates/simple")
            templates = js.get("templates") if isinstance(js, dict) else None
            if isinstance(templates, list) and templates:
                # try name hints
                for t in templates:
                    if isinstance(t, dict) and str(t.get("name", "")).lower() in ("default", "all", "full"):
                        return str(t.get("id"))
                # fallback: first template
                t0 = templates[0]
                if isinstance(t0, dict) and t0.get("id"):
                    return str(t0["id"])
        except Exception:
            return None
        return None

    async def provision_user(self, label: str, total_gb: int, expire_at: datetime) -> ProvisionResult:
        payload: dict[str, Any] = {
            "username": label,
            "expire": int(expire_at.timestamp()),
            "data_limit": int(total_gb) * 1024 * 1024 * 1024,
            "data_limit_reset_strategy": "no_reset",
            "status": "active",
        }

        # Preferred: rely on panel defaults (usually enables all protocols/inbounds).
        try:
            js = await self._post_json("/api/user", payload)
        except AdapterError as e:
            # Fallback: create from template (if panel enforces templates)
            template_id = await self._pick_default_template_id()
            if not template_id:
                raise
            js = await self._post_json(
                "/api/user/from_template",
                {
                    "template_id": template_id,
                    "username": label,
                    "expire": int(expire_at.timestamp()),
                    "data_limit": int(total_gb) * 1024 * 1024 * 1024,
                    "status": "active",
                },
            )

        remote_identifier = js.get("username") or label
        sub_url = js.get("subscription_url")
        return ProvisionResult(remote_identifier=remote_identifier, direct_sub_url=sub_url, meta=None)

    async def update_user_limits(self, remote_identifier: str, total_gb: int, expire_at: datetime) -> None:
        cur = await self._get_json(f"/api/user/{remote_identifier}")
        payload: dict[str, Any] = {
            "expire": int(expire_at.timestamp()),
            "data_limit": int(total_gb) * 1024 * 1024 * 1024,
        }
        # preserve proxy_settings if present
        if isinstance(cur, dict) and "proxy_settings" in cur:
            payload["proxy_settings"] = cur["proxy_settings"]
        await self._put_json(f"/api/user/{remote_identifier}", payload)

    async def delete_user(self, remote_identifier: str) -> None:
        await self._delete(f"/api/user/{remote_identifier}")

    async def set_status(self, remote_identifier: str, status: str) -> None:
        await self._put_json(f"/api/user/{remote_identifier}", {"status": status})

    async def disable_user(self, remote_identifier: str) -> None:
        await self.set_status(remote_identifier, "disabled")

    async def enable_user(self, remote_identifier: str) -> None:
        await self.set_status(remote_identifier, "active")

    async def get_used_bytes(self, remote_identifier: str) -> int | None:
        js = await self._get_json(f"/api/user/{remote_identifier}")
        if isinstance(js, dict):
            used = js.get("used_traffic")
            if isinstance(used, int):
                return used
        return None
