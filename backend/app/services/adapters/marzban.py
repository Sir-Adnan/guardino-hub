from __future__ import annotations
from typing import Any
from datetime import datetime, timezone
import httpx

from app.services.http_client import build_async_client
from app.services.adapters.base import TestConnectionResult, AdapterError, ProvisionResult

class MarzbanAdapter:
    """Marzban adapter using official API.

    Expected credentials (node.credentials JSON):
      {
        "username": "admin",
        "password": "secret"
      }
    """

    def __init__(self, base_url: str, credentials: dict[str, Any]):
        self.base_url = base_url.rstrip("/")
        self.username = str(credentials.get("username", "")).strip()
        self.password = str(credentials.get("password", "")).strip()

    async def _get_token(self) -> str:
        url = f"{self.base_url}/api/admin/token"
        data = {"username": self.username, "password": self.password}
        async with build_async_client() as client:
            r = await client.post(url, data=data)
            if r.status_code >= 400:
                raise AdapterError(f"Token request failed: HTTP {r.status_code}: {r.text[:200]}")
            js = r.json()
            token = js.get("access_token") or js.get("token") or js.get("accessToken")
            if not token:
                raise AdapterError("Token not found in response")
            return str(token)

    async def test_connection(self) -> TestConnectionResult:
        if not self.username or not self.password:
            return TestConnectionResult(ok=False, detail="Missing credentials: username/password")
        try:
            _ = await self._get_token()
            return TestConnectionResult(ok=True, detail="OK")
        except httpx.RequestError as e:
            return TestConnectionResult(ok=False, detail=f"Request error: {e}")
        except Exception as e:
            return TestConnectionResult(ok=False, detail=str(e))

    async def provision_user(self, label: str, total_gb: int, expire_at: datetime) -> ProvisionResult:
        if not self.username or not self.password:
            raise AdapterError("Missing credentials: username/password")

        token = await self._get_token()
        url = f"{self.base_url}/api/user"

        # Marzban expects:
        # - username (required)
        # - data_limit (bytes) nullable
        # - expire (int) nullable (commonly unix timestamp seconds; 0 means no expire)
        expire_ts = int(expire_at.replace(tzinfo=timezone.utc).timestamp())
        data_limit_bytes = int(total_gb) * 1024 * 1024 * 1024

        payload = {
            "username": label,
            "data_limit": data_limit_bytes,
            "expire": expire_ts,
            "status": "active",
        }

        async with build_async_client() as client:
            r = await client.post(url, json=payload, headers={"Authorization": f"Bearer {token}"})
            if r.status_code >= 400:
                raise AdapterError(f"Create user failed: HTTP {r.status_code}: {r.text[:300]}")
            js = r.json()
            sub_url = js.get("subscription_url") or None
            return ProvisionResult(remote_identifier=str(js.get("username", label)), direct_sub_url=sub_url, meta={"panel": "marzban"})

async def get_direct_subscription_url(self, remote_identifier: str) -> str | None:
    """Fetch direct subscription URL for an existing user from panel."""
    # Token login
    url_token = f"{self.base_url}/api/admin/token"
    data = {"username": self.username, "password": self.password}
    async with build_async_client() as client:
        r = await client.post(url_token, data=data)
        r.raise_for_status()
        token = r.json().get("access_token")
        if not token:
            return None
        url_user = f"{self.base_url}/api/user/{remote_identifier}"
        ru = await client.get(url_user, headers={"Authorization": f"Bearer {token}"})
        ru.raise_for_status()
        js = ru.json()
        return js.get("subscription_url")

async def update_user_limits(self, remote_identifier: str, total_gb: int, expire_at) -> None:
    """Update data_limit (bytes) and expire (unix timestamp) on panel."""
    url_token = f"{self.base_url}/api/admin/token"
    data = {"username": self.username, "password": self.password}
    async with build_async_client() as client:
        r = await client.post(url_token, data=data)
        r.raise_for_status()
        token = r.json().get("access_token")
        if not token:
            raise AdapterError("Token not found")
        url_user = f"{self.base_url}/api/user/{remote_identifier}"
        payload = {
            "data_limit": int(total_gb) * (1024 ** 3),
            "expire": int(expire_at.timestamp()),
        }
        ru = await client.put(url_user, json=payload, headers={"Authorization": f"Bearer {token}"})
        ru.raise_for_status()

async def delete_user(self, remote_identifier: str) -> None:
    """Delete user on panel and revoke subscription (best-effort)."""
    url_token = f"{self.base_url}/api/admin/token"
    data = {"username": self.username, "password": self.password}
    async with build_async_client() as client:
        r = await client.post(url_token, data=data)
        r.raise_for_status()
        token = r.json().get("access_token")
        if not token:
            raise AdapterError("Token not found")
        # revoke sub (best-effort)
        try:
            await client.post(f"{self.base_url}/api/user/{remote_identifier}/revoke_sub", headers={"Authorization": f"Bearer {token}"})
        except Exception:
            pass
        rd = await client.delete(f"{self.base_url}/api/user/{remote_identifier}", headers={"Authorization": f"Bearer {token}"})
        rd.raise_for_status()

async def set_status(self, remote_identifier: str, status: str) -> None:
    url_token = f"{self.base_url}/api/admin/token"
    data = {"username": self.username, "password": self.password}
    async with build_async_client() as client:
        r = await client.post(url_token, data=data)
        r.raise_for_status()
        token = r.json().get("access_token")
        if not token:
            raise AdapterError("Token not found")
        url_user = f"{self.base_url}/api/user/{remote_identifier}"
        ru = await client.put(url_user, json={"status": status}, headers={"Authorization": f"Bearer {token}"})
        ru.raise_for_status()

async def get_used_bytes(self, remote_identifier: str) -> int | None:
    url_token = f"{self.base_url}/api/admin/token"
    data = {"username": self.username, "password": self.password}
    async with build_async_client() as client:
        r = await client.post(url_token, data=data)
        r.raise_for_status()
        token = r.json().get("access_token")
        if not token:
            return None
        url_user = f"{self.base_url}/api/user/{remote_identifier}"
        ru = await client.get(url_user, headers={"Authorization": f"Bearer {token}"})
        ru.raise_for_status()
        js = ru.json()
        used = js.get("used_traffic")
        return int(used) if used is not None else None

async def disable_user(self, remote_identifier: str) -> None:
    # Non-destructive: mark as disabled/expired without revoke_sub or delete
    await self.set_status(remote_identifier, "disabled")

async def enable_user(self, remote_identifier: str) -> None:
    await self.set_status(remote_identifier, "active")
