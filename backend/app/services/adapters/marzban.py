from __future__ import annotations

from datetime import datetime
from typing import Any

import httpx

from app.services.adapters.base import AdapterError, ProvisionResult, TestConnectionResult


class MarzbanAdapter:
    def __init__(self, base_url: str, credentials: dict[str, Any], verify_ssl: bool = True, timeout: float = 20.0):
        self.base_url = base_url.rstrip("/")
        self.verify_ssl = verify_ssl
        self.timeout = timeout

        self._username = str(credentials.get("username") or "")
        self._password = str(credentials.get("password") or "")
        self._token = str(credentials.get("token") or "")

    async def _ensure_token(self) -> str:
        if self._token:
            return self._token
        if not (self._username and self._password):
            raise AdapterError("Marzban credentials must include token OR username/password")

        url = f"{self.base_url}/api/admin/token"
        data = {
            "grant_type": "password",
            "username": self._username,
            "password": self._password,
            "scope": "",
        }
        async with httpx.AsyncClient(verify=self.verify_ssl, timeout=self.timeout) as client:
            r = await client.post(url, data=data, headers={"Accept": "application/json"})
        if r.status_code >= 400:
            raise AdapterError(f"HTTP {r.status_code} POST /api/admin/token: {r.text[:300]}")
        js = r.json()
        tok = js.get("access_token")
        if not tok:
            raise AdapterError("Marzban token response missing access_token")
        self._token = str(tok)
        return self._token

    async def _headers(self) -> dict[str, str]:
        token = await self._ensure_token()
        return {"Accept": "application/json", "Authorization": f"Bearer {token}"}

    async def _get_json(self, path: str) -> Any:
        url = f"{self.base_url}{path}"
        async with httpx.AsyncClient(verify=self.verify_ssl, timeout=self.timeout) as client:
            r = await client.get(url, headers=await self._headers())
        if r.status_code >= 400:
            raise AdapterError(f"HTTP {r.status_code} GET {path}: {r.text[:300]}")
        return r.json()

    async def _post_json(self, path: str, payload: dict[str, Any] | None = None) -> Any:
        url = f"{self.base_url}{path}"
        async with httpx.AsyncClient(verify=self.verify_ssl, timeout=self.timeout) as client:
            r = await client.post(
                url,
                headers={**(await self._headers()), "Content-Type": "application/json"},
                json=payload or {},
            )
        if r.status_code >= 400:
            raise AdapterError(f"HTTP {r.status_code} POST {path}: {r.text[:300]}")
        return r.json() if r.text else None

    async def _put_json(self, path: str, payload: dict[str, Any]) -> Any:
        url = f"{self.base_url}{path}"
        async with httpx.AsyncClient(verify=self.verify_ssl, timeout=self.timeout) as client:
            r = await client.put(
                url,
                headers={**(await self._headers()), "Content-Type": "application/json"},
                json=payload,
            )
        if r.status_code >= 400:
            raise AdapterError(f"HTTP {r.status_code} PUT {path}: {r.text[:300]}")
        return r.json() if r.text else None

    async def _delete(self, path: str) -> None:
        url = f"{self.base_url}{path}"
        async with httpx.AsyncClient(verify=self.verify_ssl, timeout=self.timeout) as client:
            r = await client.delete(url, headers=await self._headers())
        if r.status_code >= 400:
            raise AdapterError(f"HTTP {r.status_code} DELETE {path}: {r.text[:300]}")

    async def _get_active_inbounds(self) -> dict[str, list[str]]:
        """Return protocol -> inbound tags.

        Marzban exposes /api/inbounds as a dict of proxy_type -> list[ProxyInbound].
        The OpenAPI schema does not include an enabled/disabled flag for inbounds,
        so we treat all returned inbounds as active.
        """
        js = await self._get_json("/api/inbounds")
        if not isinstance(js, dict):
            return {}

        out: dict[str, list[str]] = {}
        for proto, items in js.items():
            tags: list[str] = []
            if isinstance(items, list):
                for it in items:
                    if isinstance(it, dict):
                        tag = it.get("tag")
                        if isinstance(tag, str) and tag:
                            tags.append(tag)
            if tags:
                out[str(proto)] = tags
        return out

    async def test_connection(self) -> TestConnectionResult:
        try:
            js = await self._get_json("/api/system")
            return TestConnectionResult(ok=True, detail="ok", meta={"system": js})
        except Exception as e:
            return TestConnectionResult(ok=False, detail=str(e))

    async def provision_user(self, label: str, total_gb: int, expire_at: datetime) -> ProvisionResult:
        payload: dict[str, Any] = {
            "username": label,
            "expire": int(expire_at.timestamp()),
            "data_limit": int(total_gb) * 1024 * 1024 * 1024,
            "data_limit_reset_strategy": "no_reset",
            "status": "active",
        }

        # Default selection rule (Guardino): enable ALL proxy types and ALL inbounds.
        # Fetch from panel API so it reflects the current panel configuration.
        try:
            inbounds = await self._get_active_inbounds()
            if inbounds:
                payload["inbounds"] = inbounds
                payload["proxies"] = {k: {} for k in inbounds.keys()}
        except Exception:
            # If fetching inbounds fails, fall back to panel defaults.
            pass
        js = await self._post_json("/api/user", payload)
        remote_identifier = (js or {}).get("username") or label
        sub_url = (js or {}).get("subscription_url")
        return ProvisionResult(remote_identifier=remote_identifier, direct_sub_url=sub_url, meta=None)

    async def update_user_limits(self, remote_identifier: str, total_gb: int, expire_at: datetime) -> None:
        payload: dict[str, Any] = {
            "expire": int(expire_at.timestamp()),
            "data_limit": int(total_gb) * 1024 * 1024 * 1024,
        }
        await self._put_json(f"/api/user/{remote_identifier}", payload)

    async def delete_user(self, remote_identifier: str) -> None:
        await self._delete(f"/api/user/{remote_identifier}")

    async def set_status(self, remote_identifier: str, status: str) -> None:
        await self._put_json(f"/api/user/{remote_identifier}", {"status": status})

    async def disable_user(self, remote_identifier: str) -> None:
        await self.set_status(remote_identifier, "disabled")

    async def enable_user(self, remote_identifier: str) -> None:
        await self.set_status(remote_identifier, "active")

    async def get_direct_subscription_url(self, remote_identifier: str) -> str | None:
        js = await self._get_json(f"/api/user/{remote_identifier}")
        if isinstance(js, dict):
            return js.get("subscription_url") or None
        return None

    async def revoke_subscription(self, label: str, remote_identifier: str, total_gb: int, expire_at: datetime) -> ProvisionResult:
        # Marzban supports revoke_sub which invalidates existing subscription token(s).
        try:
            await self._post_json(f"/api/user/{remote_identifier}/revoke_sub", {})
        except Exception:
            pass
        # Return current subscription url (new token usually)
        direct = await self.get_direct_subscription_url(remote_identifier)
        return ProvisionResult(remote_identifier=remote_identifier, direct_sub_url=direct, meta=None)

    async def reset_usage(self, remote_identifier: str) -> None:
        await self._post_json(f"/api/user/{remote_identifier}/reset", {})

    async def get_used_bytes(self, remote_identifier: str) -> int | None:
        js = await self._get_json(f"/api/user/{remote_identifier}/usage")
        if isinstance(js, dict):
            used = js.get("used_traffic")
            if isinstance(used, int):
                return used
        return None
