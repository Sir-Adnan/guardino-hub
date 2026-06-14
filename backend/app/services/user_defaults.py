from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.app_setting import AppSetting
from app.models.node import Node
from app.models.node_allocation import NodeAllocation

GLOBAL_USER_DEFAULTS_KEY = "global_user_defaults"


def reseller_user_defaults_key(reseller_id: int) -> str:
    return f"reseller_user_defaults:{int(reseller_id)}"


def base_user_defaults() -> dict:
    return {
        "default_pricing_mode": "per_node",
        "default_node_mode": "manual",
        "default_node_ids": [],
        "default_node_group": "",
        "label_prefix": "",
        "label_suffix": "",
        "username_prefix": "",
        "username_suffix": "",
        "show_guardino_master_sub": False,
    }


def _clean_mode(v: str, allowed: set[str], fallback: str) -> str:
    s = str(v or "").strip().lower()
    return s if s in allowed else fallback


def normalize_user_defaults(raw: dict | None) -> dict:
    out = base_user_defaults()
    if not isinstance(raw, dict):
        return out

    out["default_pricing_mode"] = _clean_mode(raw.get("default_pricing_mode"), {"bundle", "per_node"}, "per_node")
    out["default_node_mode"] = _clean_mode(raw.get("default_node_mode"), {"all", "manual", "group"}, "manual")

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

    # Label and remote username are intentionally unified. Keep the legacy
    # username fields mirrored for older clients that still read them.
    out["username_prefix"] = out["label_prefix"]
    out["username_suffix"] = out["label_suffix"]

    out["show_guardino_master_sub"] = bool(raw.get("show_guardino_master_sub", out["show_guardino_master_sub"]))

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


async def get_effective_user_defaults(db: AsyncSession, reseller_id: int) -> dict:
    global_defaults = await get_user_defaults_setting(db, GLOBAL_USER_DEFAULTS_KEY)
    q_defaults = await db.execute(
        select(NodeAllocation.node_id)
        .join(Node, Node.id == NodeAllocation.node_id)
        .where(
            NodeAllocation.reseller_id == reseller_id,
            NodeAllocation.enabled == True,
            NodeAllocation.default_for_reseller == True,
            Node.is_enabled == True,
        )
        .order_by(NodeAllocation.id.asc())
    )
    default_node_ids = [int(x) for x in q_defaults.scalars().all()]
    allocation_defaults: dict = {}
    if default_node_ids:
        allocation_defaults = {
            "default_pricing_mode": "per_node",
            "default_node_mode": "manual",
            "default_node_ids": default_node_ids,
            "default_node_group": "",
        }

    q = await db.execute(select(AppSetting).where(AppSetting.key == reseller_user_defaults_key(reseller_id)))
    row = q.scalar_one_or_none()
    if not row or not isinstance(row.value, dict):
        return normalize_user_defaults({**global_defaults, **allocation_defaults})
    return normalize_user_defaults({**global_defaults, **allocation_defaults, **row.value})


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
