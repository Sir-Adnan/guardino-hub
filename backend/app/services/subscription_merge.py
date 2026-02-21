from __future__ import annotations
import base64
import re
from typing import Iterable

_B64_RE = re.compile(r"^[A-Za-z0-9+/=\n\r]+$")

def _maybe_b64decode(text: str) -> str:
    s = text.strip()
    if not s:
        return ""
    if len(s) % 4 != 0:
        return s
    if not _B64_RE.match(s):
        return s
    try:
        raw = base64.b64decode(s.encode("utf-8"), validate=False)
        decoded = raw.decode("utf-8", errors="ignore")
        # Heuristic: decoded should contain typical scheme markers or newlines
        if any(k in decoded for k in ("vmess://", "vless://", "trojan://", "ss://", "\n")):
            return decoded
        return s
    except Exception:
        return s

def _b64encode(text: str) -> str:
    return base64.b64encode(text.encode("utf-8")).decode("utf-8")

def merge_subscriptions(bodies: Iterable[str]) -> str:
    lines = []
    seen = set()
    for body in bodies:
        decoded = _maybe_b64decode(body)
        for ln in decoded.splitlines():
            ln = ln.strip()
            if not ln:
                continue
            if ln in seen:
                continue
            seen.add(ln)
            lines.append(ln)
    merged = "\n".join(lines) + ("\n" if lines else "")
    return _b64encode(merged)
