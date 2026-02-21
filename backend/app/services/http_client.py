from __future__ import annotations
import httpx
from app.core.config import settings

def build_async_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        timeout=httpx.Timeout(settings.HTTP_TIMEOUT_SECONDS),
        verify=settings.PANEL_TLS_VERIFY,
        headers={"User-Agent": f"{settings.APP_NAME}/1.0"},
    )
