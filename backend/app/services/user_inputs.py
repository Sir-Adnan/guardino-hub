from __future__ import annotations
import re
import secrets
from typing import Optional

_PRESETS = {
    "7d": 7,
    "1m": 30,
    "3m": 90,
    "6m": 180,
    "1y": 365,
    "unlimited": 0,
}

def resolve_days(days: int, preset: Optional[str]) -> int:
    if preset:
        p = preset.strip().lower()
        if p not in _PRESETS:
            raise ValueError("Invalid duration_preset")
        return _PRESETS[p]
    return int(days)

def sanitize_username(name: str) -> str:
    name = name.strip()
    # allow a-z A-Z 0-9 _ - .
    name = re.sub(r"[^a-zA-Z0-9_.-]+", "_", name)
    name = name.strip("._-")
    return name[:64] if name else ""

def random_username(prefix: str = "u") -> str:
    return f"{prefix}_{secrets.token_hex(4)}"
