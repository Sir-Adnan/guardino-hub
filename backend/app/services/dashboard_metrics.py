from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Iterable

BYTES_PER_GB = 1024 * 1024 * 1024


def _status_value(status: Any) -> str:
    return str(getattr(status, "value", status) or "").lower()


def _aware_now() -> datetime:
    return datetime.now(timezone.utc)


def _is_expired(expire_at: datetime | None, now: datetime) -> bool:
    if not expire_at:
        return False
    ref = now.astimezone(expire_at.tzinfo) if expire_at.tzinfo else now.replace(tzinfo=None)
    return expire_at < ref


def summarize_users(rows: Iterable[Any], now: datetime | None = None) -> dict[str, int]:
    now = now or _aware_now()
    summary = {
        "total": 0,
        "active": 0,
        "disabled": 0,
        "expired": 0,
        "limited": 0,
        "on_hold": 0,
        "deleted": 0,
    }

    for row in rows:
        status, expire_at, used_bytes, total_gb, meta = row
        status_key = _status_value(status)
        if status_key == "deleted":
            summary["deleted"] += 1
            continue

        summary["total"] += 1
        meta_dict = meta if isinstance(meta, dict) else {}
        create_status = str(meta_dict.get("create_status") or "").lower()
        is_on_hold = status_key == "active" and create_status == "on_hold"
        is_expired = _is_expired(expire_at, now)
        total_bytes = max(0, int(total_gb or 0)) * BYTES_PER_GB
        is_limited = total_bytes > 0 and int(used_bytes or 0) >= total_bytes

        if status_key == "disabled":
            summary["disabled"] += 1
        elif is_on_hold:
            summary["on_hold"] += 1
        elif is_expired:
            summary["expired"] += 1
        elif is_limited:
            summary["limited"] += 1
        elif status_key == "active":
            summary["active"] += 1

    return summary


def day_keys(days: int = 14, today: date | None = None) -> list[str]:
    today = today or datetime.now(timezone.utc).date()
    return [(today - timedelta(days=days - 1 - index)).isoformat() for index in range(days)]


def build_daily_series(
    rows: Iterable[Any],
    date_getter: Callable[[Any], datetime | None],
    value_getter: Callable[[Any], float],
    days: int = 14,
) -> list[dict[str, float | str]]:
    keys = day_keys(days)
    values = {key: 0.0 for key in keys}
    for row in rows:
        value_date = date_getter(row)
        if not value_date:
            continue
        key = value_date.date().isoformat()
        if key in values:
            values[key] += max(0.0, float(value_getter(row) or 0))
    return [{"date": key, "value": round(values[key], 2)} for key in keys]
