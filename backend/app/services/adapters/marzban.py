from __future__ import annotations
from typing import Any
import httpx
from app.services.http_client import build_async_client
from app.services.adapters.base import TestConnectionResult, AdapterError

class MarzbanAdapter:
    """Minimal Marzban adapter using official admin token endpoint.
    Expected credentials:
      {"username": "...", "password": "..."}
    """

    def __init__(self, base_url: str, credentials: dict[str, Any]):
        self.base_url = base_url.rstrip("/")
        self.username = str(credentials.get("username", "")).strip()
        self.password = str(credentials.get("password", "")).strip()

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
