from __future__ import annotations
from typing import Any
from datetime import datetime
import httpx
from app.services.http_client import build_async_client
from app.services.adapters.base import TestConnectionResult, AdapterError, ProvisionResult

class WGDashboardAdapter:
    """WGDashboard adapter.
    Expected credentials:
      {"apikey": "...", "mock": true/false}
    Uses handshake endpoint: GET /api/handshake
    NOTE: provision_user is **mock-only** for now. We'll implement it using official WGDashboard endpoints in a later step.
    """

    def __init__(self, base_url: str, credentials: dict[str, Any]):
        self.base_url = base_url.rstrip("/")
        self.apikey = str(credentials.get("apikey", "")).strip()
        self.mock = bool(credentials.get("mock", False))

    async def test_connection(self) -> TestConnectionResult:
        if not self.apikey:
            return TestConnectionResult(ok=False, detail="Missing credentials: apikey")

        url = f"{self.base_url}/api/handshake"
        try:
            async with build_async_client() as client:
                r = await client.get(url, headers={"wg-dashboard-apikey": self.apikey})
                if r.status_code >= 400:
                    return TestConnectionResult(ok=False, detail=f"HTTP {r.status_code}: {r.text[:200]}")
                js = r.json() if r.headers.get("content-type","").startswith("application/json") else {"raw": r.text[:200]}
                return TestConnectionResult(ok=True, detail="OK", meta={"response": js})
        except httpx.RequestError as e:
            return TestConnectionResult(ok=False, detail=f"Request error: {e}")
        except Exception as e:
            raise AdapterError(str(e)) from e

    async def provision_user(self, label: str, total_gb: int, expire_at: datetime) -> ProvisionResult:
        if self.mock:
            remote_id = f"wg_{label}"
            sub = f"{self.base_url}/sub/mock/{remote_id}"
            return ProvisionResult(remote_identifier=remote_id, direct_sub_url=sub, meta={"mode": "mock"})
        raise AdapterError("provision_user not implemented for WGDashboard yet (set node.credentials.mock=true to mock)")
