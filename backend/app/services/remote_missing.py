from __future__ import annotations

from datetime import datetime, timezone

from app.models.subaccount import SubAccount
from app.models.user import GuardinoUser


def remote_identifier(value: str | None) -> str:
    return str(value or "").strip()


def remote_missing_key(subaccount: SubAccount) -> str:
    remote = remote_identifier(subaccount.remote_identifier)
    allocation = int(subaccount.allocation_id or 0)
    return f"{int(subaccount.node_id)}:{allocation}:{remote}"


def clear_remote_missing(user: GuardinoUser, subaccount: SubAccount) -> None:
    meta = dict(user.meta) if isinstance(user.meta, dict) else {}
    missing = dict(meta.get("remote_missing") or {}) if isinstance(meta.get("remote_missing"), dict) else {}
    key = remote_missing_key(subaccount)
    if key not in missing:
        return
    missing.pop(key, None)
    if missing:
        meta["remote_missing"] = missing
    else:
        meta.pop("remote_missing", None)
    user.meta = meta


def mark_remote_missing(user: GuardinoUser, subaccount: SubAccount, now: datetime, *, source: str) -> int:
    meta = dict(user.meta) if isinstance(user.meta, dict) else {}
    missing = dict(meta.get("remote_missing") or {}) if isinstance(meta.get("remote_missing"), dict) else {}
    key = remote_missing_key(subaccount)
    current = missing.get(key) if isinstance(missing.get(key), dict) else {}
    count = int(current.get("count") or 0) + 1
    first_seen = str(current.get("first_seen_at") or now.isoformat())
    missing[key] = {
        "count": count,
        "first_seen_at": first_seen,
        "last_seen_at": now.isoformat(),
        "source": source,
        "node_id": int(subaccount.node_id),
        "allocation_id": int(subaccount.allocation_id or 0) or None,
        "remote_identifier": remote_identifier(subaccount.remote_identifier),
    }
    meta["remote_missing"] = missing
    user.meta = meta
    return count


def remote_missing_first_seen_at(user: GuardinoUser, subaccount: SubAccount) -> datetime | None:
    """Return when this subaccount was first reported missing, if recorded."""
    meta = user.meta if isinstance(user.meta, dict) else {}
    missing = meta.get("remote_missing")
    if not isinstance(missing, dict):
        return None
    record = missing.get(remote_missing_key(subaccount))
    if not isinstance(record, dict):
        return None
    raw = record.get("first_seen_at")
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(str(raw))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed
