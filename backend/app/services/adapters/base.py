from __future__ import annotations
from dataclasses import dataclass
from typing import Protocol, Any, Optional

@dataclass
class TestConnectionResult:
    ok: bool
    detail: str
    meta: dict[str, Any] | None = None

class PanelAdapter(Protocol):
    async def test_connection(self) -> TestConnectionResult:
        ...

class AdapterError(RuntimeError):
    pass
