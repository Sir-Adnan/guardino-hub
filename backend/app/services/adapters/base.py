from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol


class AdapterError(Exception):
    """Generic adapter error (network/auth/panel response)."""


@dataclass
class TestConnectionResult:
    ok: bool
    detail: str
    meta: dict[str, Any] | None = None


@dataclass
class ProvisionResult:
    remote_identifier: str
    direct_sub_url: str | None = None
    meta: dict[str, Any] | None = None


class PanelAdapter(Protocol):
    async def test_connection(self) -> TestConnectionResult: ...

    async def provision_user(self, label: str, total_gb: int, expire_at: datetime) -> ProvisionResult: ...

    async def update_user_limits(self, remote_identifier: str, total_gb: int, expire_at: datetime) -> None: ...

    async def delete_user(self, remote_identifier: str) -> None: ...

    async def set_status(self, remote_identifier: str, status: str) -> None: ...

    async def disable_user(self, remote_identifier: str) -> None: ...

    async def enable_user(self, remote_identifier: str) -> None: ...

    async def get_direct_subscription_url(self, remote_identifier: str) -> str | None: ...

    async def revoke_subscription(self, label: str, remote_identifier: str, total_gb: int, expire_at: datetime) -> ProvisionResult: ...

    async def reset_usage(self, remote_identifier: str) -> None: ...

    async def get_used_bytes(self, remote_identifier: str) -> int | None: ...
