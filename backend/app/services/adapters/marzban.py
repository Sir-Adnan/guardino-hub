from __future__ import annotations

from datetime import datetime
from typing import Any

import httpx

from app.services.adapters.base import AdapterError, ProvisionResult, TestConnectionResult


class MarzbanAdapter:
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

    async def _get_all_inbounds(self) -> tuple[dict[str, list[str]], dict[str, Any]]:
        """Return (inbounds_map, raw) where map is protocol -> list[tag]."""
        raw = await self._get_json("/api/inbounds")
        # raw: { "vless": [{...tag..}, ...], "vmess": [...] }
        inbounds: dict[str, list[str]] = {}
        if isinstance(raw, dict):
            for proto, items in raw.items():
                tags = []
                if isinstance(items, list):
                    for it in items:
                        if isinstance(it, dict) and it.get("tag"):
                            tags.append(str(it["tag"]))
                if tags:
                    inbounds[str(proto)] = tags
        return inbounds, raw

    async def provision_user(self, label: str, total_gb: int, expire_at: datetime) -> ProvisionResult:
        inbounds, raw_inbounds = await self._get_all_inbounds()

        # Default: enable all protocols & all inbounds.
        payload: dict[str, Any] = {
            "username": label,
            "expire": int(expire_at.timestamp()),
            "data_limit": int(total_gb) * 1024 * 1024 * 1024,
            "data_limit_reset_strategy": "no_reset",
            "status": "active",
        }

        if inbounds:
            payload["inbounds"] = inbounds
            payload["proxies"] = {proto: {} for proto in inbounds.keys()}

        js = await self._post_json("/api/user", payload)

        remote_identifier = js.get("username") or label
        sub_url = js.get("subscription_url")
        return ProvisionResult(
            remote_identifier=remote_identifier,
            direct_sub_url=sub_url,
            meta={"inbounds": raw_inbounds},
        )

    async def update_user_limits(self, remote_identifier: str, total_gb: int, expire_at: datetime) -> None:
        # Keep existing proxy/inbound selections; only update limit + expire.
        cur = await self._get_json(f"/api/user/{remote_identifier}")
        payload: dict[str, Any] = {
            "expire": int(expire_at.timestamp()),
            "data_limit": int(total_gb) * 1024 * 1024 * 1024,
        }
        if isinstance(cur, dict):
            if "inbounds" in cur:
                payload["inbounds"] = cur["inbounds"]
            if "proxies" in cur:
                payload["proxies"] = cur["proxies"]
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
