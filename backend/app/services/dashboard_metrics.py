from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Iterable

from sqlalchemy import and_, case, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.dashboard_metric import DashboardDailyMetric
from app.models.user import GuardinoUser, UserStatus

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


def build_daily_snapshot_series(
    rows: Iterable[Any],
    day_getter: Callable[[Any], date | datetime | None],
    value_getter: Callable[[Any], float],
    days: int = 14,
    today: date | None = None,
) -> list[dict[str, float | str]]:
    keys = day_keys(days, today)
    values = {key: 0.0 for key in keys}
    for row in rows:
        value_day = day_getter(row)
        if not value_day:
            continue
        key = value_day.date().isoformat() if isinstance(value_day, datetime) else value_day.isoformat()
        if key in values:
            values[key] += max(0.0, float(value_getter(row) or 0))
    return [{"date": key, "value": round(values[key], 2)} for key in keys]


def set_today_series_value(
    series: list[dict[str, float | str]],
    value: float,
    today: date | None = None,
) -> list[dict[str, float | str]]:
    today_key = (today or datetime.now(timezone.utc).date()).isoformat()
    current_value = round(max(0.0, float(value or 0)), 2)
    return [
        {**point, "value": current_value} if point.get("date") == today_key else point
        for point in series
    ]


def _count_if(condition: Any) -> Any:
    return func.coalesce(func.sum(case((condition, 1), else_=0)), 0)


async def refresh_daily_metrics_for_resellers(
    db: AsyncSession,
    reseller_ids: Iterable[int] | None = None,
    metric_day: date | None = None,
    now: datetime | None = None,
) -> None:
    now = now or _aware_now()
    metric_day = metric_day or now.date()
    clean_ids: list[int] | None = None
    if reseller_ids is not None:
        clean_ids = sorted({int(rid) for rid in reseller_ids if int(rid or 0) > 0})
        if not clean_ids:
            return

    create_status = func.coalesce(GuardinoUser.meta["create_status"].as_string(), "")
    not_deleted = GuardinoUser.status != UserStatus.deleted
    limited = and_(
        not_deleted,
        GuardinoUser.total_gb > 0,
        GuardinoUser.used_bytes >= GuardinoUser.total_gb * BYTES_PER_GB,
    )

    stmt = select(
        GuardinoUser.owner_reseller_id.label("reseller_id"),
        _count_if(not_deleted).label("users_total"),
        _count_if(GuardinoUser.status == UserStatus.active).label("users_active"),
        _count_if(GuardinoUser.status == UserStatus.disabled).label("users_disabled"),
        _count_if(and_(not_deleted, GuardinoUser.expire_at < now)).label("users_expired"),
        _count_if(limited).label("users_limited"),
        _count_if(and_(GuardinoUser.status == UserStatus.active, create_status == "on_hold")).label("users_on_hold"),
        _count_if(GuardinoUser.status == UserStatus.deleted).label("users_deleted"),
        func.coalesce(func.sum(case((not_deleted, GuardinoUser.total_gb), else_=0)), 0).label("sold_gb_total"),
        func.coalesce(func.sum(case((not_deleted, GuardinoUser.used_bytes), else_=0)), 0).label("used_bytes_total"),
    ).group_by(GuardinoUser.owner_reseller_id)
    if clean_ids is not None:
        stmt = stmt.where(GuardinoUser.owner_reseller_id.in_(clean_ids))

    rows = (await db.execute(stmt)).mappings().all()
    table = DashboardDailyMetric.__table__
    for row in rows:
        values = {
            "day": metric_day,
            "reseller_id": int(row["reseller_id"]),
            "users_total": int(row["users_total"] or 0),
            "users_active": int(row["users_active"] or 0),
            "users_disabled": int(row["users_disabled"] or 0),
            "users_expired": int(row["users_expired"] or 0),
            "users_limited": int(row["users_limited"] or 0),
            "users_on_hold": int(row["users_on_hold"] or 0),
            "users_deleted": int(row["users_deleted"] or 0),
            "sold_gb_total": int(row["sold_gb_total"] or 0),
            "used_bytes_total": int(row["used_bytes_total"] or 0),
        }
        update_values = {key: value for key, value in values.items() if key not in {"day", "reseller_id"}}
        update_values["updated_at"] = now
        await db.execute(
            pg_insert(table)
            .values(**values)
            .on_conflict_do_update(
                index_elements=["day", "reseller_id"],
                set_=update_values,
            )
        )
