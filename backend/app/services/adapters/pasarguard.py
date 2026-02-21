from __future__ import annotations
from typing import Any
from datetime import datetime
import httpx
from app.services.http_client import build_async_client
from app.services.adapters.base import TestConnectionResult, AdapterError, ProvisionResult

class PasarguardAdapter:
    """Minimal Pasarguard adapter using official admin token endpoint.
    Expected credentials:
      {"username": "...", "password": "...", "mock": true/false}
    NOTE: provision_user is **mock-only** for now. We'll implement it using official Pasarguard API in a later step.
    """

    def __init__(self, base_url: str, credentials: dict[str, Any]):
        self.base_url = base_url.rstrip("/")
        self.username = str(credentials.get("username", "")).strip()
        self.password = str(credentials.get("password", "")).strip()
        self.mock = bool(credentials.get("mock", False))

    async def test_connection(self) -> TestConnectionResult:
        if not self.username or not self.password:
            return TestConnectionResult(ok=False, detail="Missing credentials: username/password")

        url = f"{self.base_url}/api/admin/token"
        data = {"username": self.username, "password": self.password}
        try:
            async with build_async_client() as client:
                r = await client.post(url, data=data)
                if r.status_code >= 400:
                    return TestConnectionResult(ok=False, detail=f"HTTP {r.status_code}: {r.text[:200]}")
                js = r.json()
                token = js.get("access_token") or js.get("token") or js.get("accessToken")
                if not token:
                    return TestConnectionResult(ok=False, detail="Token not found in response", meta={"response": js})
                return TestConnectionResult(ok=True, detail="OK", meta={"token_type": js.get("token_type", "bearer")})
        except httpx.RequestError as e:
            return TestConnectionResult(ok=False, detail=f"Request error: {e}")
        except Exception as e:
            raise AdapterError(str(e)) from e

    async def provision_user(self, label: str, total_gb: int, expire_at: datetime) -> ProvisionResult:
        if self.mock:
            remote_id = f"psg_{label}"
            sub = f"{self.base_url}/sub/mock/{remote_id}"
            return ProvisionResult(remote_identifier=remote_id, direct_sub_url=sub, meta={"mode": "mock"})
        raise AdapterError("provision_user not implemented for Pasarguard yet (set node.credentials.mock=true to mock)")
