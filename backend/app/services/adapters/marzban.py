from __future__ import annotations

from datetime import datetime, timezone
import math
from typing import Any
from urllib.parse import urlencode

import httpx

from app.services.adapters.base import (
    AdapterError,
    ProvisionResult,
    RemoteUserListItem,
    RemoteUserListResult,
    RemoteUserNotFound,
    RemoteUserSnapshot,
    TestConnectionResult,
)


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
        if r.status_code == 404:
            raise RemoteUserNotFound(f"HTTP 404 GET {path}: {r.text[:300]}")
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

    @staticmethod
    def _as_int(value: Any) -> int | None:
        if value is None:
            return None
        if isinstance(value, bool):
            return int(value)
        if isinstance(value, int):
            return value
        if isinstance(value, float):
            return int(value)
        try:
            s = str(value).strip()
            if not s:
                return None
            return int(float(s))
        except Exception:
            return None

    @staticmethod
    def _as_datetime(value: Any) -> datetime | None:
        if value in (None, ""):
            return None
        if isinstance(value, datetime):
            return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        if isinstance(value, (int, float)):
            timestamp = float(value)
            if timestamp <= 0:
                return None
            if timestamp > 10_000_000_000:
                timestamp = timestamp / 1000.0
            try:
                return datetime.fromtimestamp(timestamp, tz=timezone.utc)
            except Exception:
                return None
        text = str(value).strip()
        if not text:
            return None
        try:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
        except Exception:
            return None

    @classmethod
    def _list_item_from_user_payload(cls, payload: Any) -> RemoteUserListItem | None:
        if not isinstance(payload, dict):
            return None
        username = str(payload.get("username") or "").strip()
        if not username:
            return None

        data_limit = cls._as_int(payload.get("data_limit")) or 0
        total_gb = int(math.ceil(max(0, data_limit) / float(1024 ** 3))) if data_limit > 0 else 0
        used_bytes = cls._as_int(payload.get("used_traffic")) or 0
        status = str(payload.get("status") or "").strip().lower() or None
        direct_sub_url = str(payload.get("subscription_url") or "").strip() or None
        return RemoteUserListItem(
            username=username,
            remote_identifier=username,
            total_gb=max(0, total_gb),
            used_bytes=max(0, int(used_bytes)),
            expire_at=cls._as_datetime(payload.get("expire")),
            status=status,
            direct_sub_url=direct_sub_url,
            raw=payload,
        )

    @classmethod
    def _snapshot_from_user_payload(cls, payload: Any) -> RemoteUserSnapshot:
        if not isinstance(payload, dict):
            return RemoteUserSnapshot(raw=None)
        status = str(payload.get("status") or "").strip().lower() or None
        if not status and payload.get("is_disabled") is not None:
            status = "disabled" if bool(payload.get("is_disabled")) else "active"
        used = cls._as_int(payload.get("used_traffic"))
        if used is None and isinstance(payload.get("data"), dict):
            used = cls._as_int(payload["data"].get("used_traffic"))
        return RemoteUserSnapshot(status=status, used_bytes=max(0, used) if used is not None else None, raw=payload)

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

    async def list_users(self, *, offset: int = 0, limit: int = 500, admin: str | None = None) -> RemoteUserListResult:
        params: dict[str, Any] = {
            "offset": max(0, int(offset or 0)),
            "limit": max(1, min(5000, int(limit or 500))),
        }
        js = await self._get_json(f"/api/users?{urlencode(params)}")
        if isinstance(js, dict):
            raw_items = js.get("users") if isinstance(js.get("users"), list) else []
            total = self._as_int(js.get("total"))
        elif isinstance(js, list):
            raw_items = js
            total = len(js)
        else:
            raw_items = []
            total = 0
        items: list[RemoteUserListItem] = []
        for raw in raw_items:
            item = self._list_item_from_user_payload(raw)
            if item:
                items.append(item)
        return RemoteUserListResult(items=items, total=total)

    async def provision_user(self, label: str, total_gb: int, expire_at: datetime, status: str = "active") -> ProvisionResult:
        create_status = "on_hold" if str(status or "").strip().lower() == "on_hold" else "active"
        expire_ts = int(expire_at.timestamp())
        payload: dict[str, Any] = {
            "username": label,
            "expire": expire_ts,
            "data_limit": int(total_gb) * 1024 * 1024 * 1024,
            "data_limit_reset_strategy": "no_reset",
            "status": create_status,
        }
        if create_status == "on_hold":
            now = datetime.now(expire_at.tzinfo) if expire_at.tzinfo else datetime.utcnow()
            duration = max(0, int((expire_at - now).total_seconds()))
            payload["expire"] = None
            payload["on_hold_expire_duration"] = duration

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

    async def get_user_snapshot(self, remote_identifier: str) -> RemoteUserSnapshot:
        js_user = await self._get_json(f"/api/user/{remote_identifier}")
        return self._snapshot_from_user_payload(js_user)

    async def get_used_bytes(self, remote_identifier: str) -> int | None:
        # Newer APIs expose used_traffic directly on /api/user/{username}
        try:
            snapshot = await self.get_user_snapshot(remote_identifier)
            if snapshot.used_bytes is not None:
                return max(0, snapshot.used_bytes)
        except RemoteUserNotFound:
            raise
        except Exception:
            pass

        # Fallback to explicit usage endpoint:
        # { username: ..., usages: [ { used_traffic: ... }, ... ] }
        js = await self._get_json(f"/api/user/{remote_identifier}/usage")
        if isinstance(js, dict):
            payload = js.get("data") if isinstance(js.get("data"), dict) else js
            usages = payload.get("usages")
            if isinstance(usages, list):
                total = 0
                found = False
                for item in usages:
                    if not isinstance(item, dict):
                        continue
                    val = self._as_int(item.get("used_traffic"))
                    if val is None:
                        continue
                    total += max(0, val)
                    found = True
                if found:
                    return total
            direct = self._as_int(payload.get("used_traffic"))
            if direct is not None:
                return max(0, direct)
        return None
