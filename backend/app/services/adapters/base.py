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

class PanelAdapter(Protocol):
    async def test_connection(self) -> TestConnectionResult: ...
    async def provision_user(self, label: str, total_gb: int, expire_at: datetime) -> ProvisionResult: ...

class AdapterError(RuntimeError):
    pass
