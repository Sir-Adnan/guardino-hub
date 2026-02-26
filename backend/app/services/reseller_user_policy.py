from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.app_setting import AppSetting

ALLOWED_DURATION_PRESETS = {"7d", "1m", "3m", "6m", "1y", "unlimited"}
DEFAULT_DURATION_PRESETS = ["7d", "1m", "3m", "6m", "1y"]
DEFAULT_TRAFFIC_GB = [20, 30, 50, 70, 100, 150, 200]


def reseller_user_policy_key(reseller_id: int) -> str:
    return f"reseller_user_policy:{int(reseller_id)}"


def base_user_policy() -> dict:
    return {
        "enabled": False,
        "allow_custom_days": True,
        "allow_custom_traffic": True,
        "allow_no_expire": False,
        "min_days": 1,
        "max_days": 3650,
        "allowed_duration_presets": list(DEFAULT_DURATION_PRESETS),
        "allowed_traffic_gb": list(DEFAULT_TRAFFIC_GB),
    }


def normalize_user_policy(raw: dict | None) -> dict:
    out = base_user_policy()
    if not isinstance(raw, dict):
        return out

    out["enabled"] = bool(raw.get("enabled", out["enabled"]))
    out["allow_custom_days"] = bool(raw.get("allow_custom_days", out["allow_custom_days"]))
    out["allow_custom_traffic"] = bool(raw.get("allow_custom_traffic", out["allow_custom_traffic"]))
    out["allow_no_expire"] = bool(raw.get("allow_no_expire", out["allow_no_expire"]))

    try:
        min_days = int(raw.get("min_days", out["min_days"]))
    except Exception:
        min_days = out["min_days"]
    try:
        max_days = int(raw.get("max_days", out["max_days"]))
    except Exception:
        max_days = out["max_days"]
    min_days = max(1, min(36500, min_days))
    max_days = max(min_days, min(36500, max_days))
    out["min_days"] = min_days
    out["max_days"] = max_days

    presets = raw.get("allowed_duration_presets")
    if isinstance(presets, list):
        seen: set[str] = set()
        parsed: list[str] = []
        for p in presets:
            s = str(p or "").strip().lower()
            if s not in ALLOWED_DURATION_PRESETS or s in seen:
                continue
            parsed.append(s)
            seen.add(s)
        if parsed:
            out["allowed_duration_presets"] = parsed

    if not out["allow_no_expire"]:
        out["allowed_duration_presets"] = [p for p in out["allowed_duration_presets"] if p != "unlimited"]
    elif "unlimited" not in out["allowed_duration_presets"]:
        out["allowed_duration_presets"] = [*out["allowed_duration_presets"], "unlimited"]

    traffic = raw.get("allowed_traffic_gb")
    if isinstance(traffic, list):
        seen_gb: set[int] = set()
        parsed_gb: list[int] = []
        for x in traffic:
            try:
                n = int(x)
            except Exception:
                continue
            if n <= 0 or n > 100000 or n in seen_gb:
                continue
            parsed_gb.append(n)
            seen_gb.add(n)
        if parsed_gb:
            parsed_gb.sort()
            out["allowed_traffic_gb"] = parsed_gb

    return out


async def get_user_policy_setting(db: AsyncSession, key: str) -> dict:
    q = await db.execute(select(AppSetting).where(AppSetting.key == key))
    row = q.scalar_one_or_none()
    return normalize_user_policy(row.value if row else None)


async def get_user_policy_setting_optional(db: AsyncSession, key: str) -> dict | None:
    q = await db.execute(select(AppSetting).where(AppSetting.key == key))
    row = q.scalar_one_or_none()
    if not row:
        return None
    return normalize_user_policy(row.value)


async def set_user_policy_setting(db: AsyncSession, key: str, value: dict) -> dict:
    normalized = normalize_user_policy(value)
    q = await db.execute(select(AppSetting).where(AppSetting.key == key))
    row = q.scalar_one_or_none()
    if row:
        row.value = normalized
    else:
        row = AppSetting(key=key, value=normalized)
        db.add(row)
    await db.commit()
    return normalized

