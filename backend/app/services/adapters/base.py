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

\1    async def get_direct_subscription_url(self, remote_identifier: str) -> str | None: ...
