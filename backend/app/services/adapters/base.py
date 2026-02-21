from __future__ import annotations
from dataclasses import dataclass
from typing import Protocol, Any
from datetime import datetime

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

\1    \1    async def update_user_limits(self, remote_identifier: str, total_gb: int, expire_at) -> None: ...
    async def delete_user(self, remote_identifier: str) -> None: ...
    async def set_status(self, remote_identifier: str, status: str) -> None: ...
    async def get_used_bytes(self, remote_identifier: str) -> int | None: ...
