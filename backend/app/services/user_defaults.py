from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.app_setting import AppSetting

GLOBAL_USER_DEFAULTS_KEY = "global_user_defaults"


def reseller_user_defaults_key(reseller_id: int) -> str:
    return f"reseller_user_defaults:{int(reseller_id)}"


def base_user_defaults() -> dict:
    return {
        "default_pricing_mode": "bundle",
        "default_node_mode": "all",
        "default_node_ids": [],
        "default_node_group": "",
        "label_prefix": "",
        "label_suffix": "",
        "username_prefix": "",
        "username_suffix": "",
    }


def _clean_mode(v: str, allowed: set[str], fallback: str) -> str:
    s = str(v or "").strip().lower()
    return s if s in allowed else fallback


def normalize_user_defaults(raw: dict | None) -> dict:
    out = base_user_defaults()
    if not isinstance(raw, dict):
        return out

    out["default_pricing_mode"] = _clean_mode(raw.get("default_pricing_mode"), {"bundle", "per_node"}, "bundle")
    out["default_node_mode"] = _clean_mode(raw.get("default_node_mode"), {"all", "manual", "group"}, "all")

    ids = raw.get("default_node_ids")
    if isinstance(ids, list):
        parsed: list[int] = []
        seen: set[int] = set()
        for x in ids:
            try:
                n = int(x)
            except Exception:
                continue
            if n > 0 and n not in seen:
                parsed.append(n)
                seen.add(n)
        out["default_node_ids"] = parsed[:200]

    for k in ("default_node_group", "label_prefix", "label_suffix", "username_prefix", "username_suffix"):
        v = raw.get(k, "")
        if v is None:
            v = ""
        out[k] = str(v).strip()[:64]

    return out


async def get_user_defaults_setting(db: AsyncSession, key: str) -> dict:
    q = await db.execute(select(AppSetting).where(AppSetting.key == key))
    row = q.scalar_one_or_none()
    return normalize_user_defaults(row.value if row else None)


async def get_user_defaults_setting_optional(db: AsyncSession, key: str) -> dict | None:
    q = await db.execute(select(AppSetting).where(AppSetting.key == key))
    row = q.scalar_one_or_none()
    if not row:
        return None
    return normalize_user_defaults(row.value)


async def set_user_defaults_setting(db: AsyncSession, key: str, value: dict) -> dict:
    normalized = normalize_user_defaults(value)
    q = await db.execute(select(AppSetting).where(AppSetting.key == key))
    row = q.scalar_one_or_none()
    if row:
        row.value = normalized
    else:
        row = AppSetting(key=key, value=normalized)
        db.add(row)
    await db.commit()
    return normalized
