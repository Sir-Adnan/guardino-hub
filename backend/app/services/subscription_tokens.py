from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.app_setting import AppSetting

REVOKED_MASTER_SUB_TOKENS_KEY = "revoked_master_sub_tokens"
MAX_REVOKED_MASTER_SUB_TOKENS = 5000


def _parse_tokens(value: dict | None) -> list[str]:
    if not isinstance(value, dict):
        return []
    raw = value.get("tokens")
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    seen: set[str] = set()
    for token in raw:
        s = str(token or "").strip()
        if not s or s in seen:
            continue
        out.append(s)
        seen.add(s)
    return out


async def is_master_sub_token_revoked(db: AsyncSession, token: str) -> bool:
    t = str(token or "").strip()
    if not t:
        return True
    q = await db.execute(select(AppSetting).where(AppSetting.key == REVOKED_MASTER_SUB_TOKENS_KEY))
    row = q.scalar_one_or_none()
    return t in set(_parse_tokens(row.value if row else None))


async def remember_revoked_master_sub_token(db: AsyncSession, token: str) -> None:
    t = str(token or "").strip()
    if not t:
        return
    q = await db.execute(select(AppSetting).where(AppSetting.key == REVOKED_MASTER_SUB_TOKENS_KEY))
    row = q.scalar_one_or_none()
    tokens = _parse_tokens(row.value if row else None)
    if t in tokens:
        return
    tokens.append(t)
    tokens = tokens[-MAX_REVOKED_MASTER_SUB_TOKENS:]
    if row:
        row.value = {"tokens": tokens}
    else:
        db.add(AppSetting(key=REVOKED_MASTER_SUB_TOKENS_KEY, value={"tokens": tokens}))
