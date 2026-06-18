from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.api.deps import require_admin
from app.models.reseller import Reseller, ResellerStatus
from app.models.user import GuardinoUser, UserStatus
from app.models.node import Node
from app.models.order import Order, OrderStatus
from app.models.ledger import LedgerTransaction
from app.models.dashboard_metric import DashboardDailyMetric
from app.schemas.stats import AdminStats
from app.services.dashboard_metrics import (
    BYTES_PER_GB,
    build_daily_series,
    build_daily_snapshot_series,
    set_today_series_value,
    summarize_users,
)

router = APIRouter()


@router.get("", response_model=AdminStats)
async def get_admin_stats(
    db: AsyncSession = Depends(get_db),
    admin=Depends(require_admin),
    days: int = Query(14, ge=7, le=31),
    reseller_id: int | None = Query(default=None, ge=1),
):
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=30)
    series_since = now.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=days - 1)

    rq = await db.execute(
        select(func.count()).select_from(Reseller).where(
            Reseller.role == "reseller",
            Reseller.status != ResellerStatus.deleted,
        )
    )
    resellers_total = int(rq.scalar_one() or 0)

    user_stmt = select(
        GuardinoUser.status,
        GuardinoUser.expire_at,
        GuardinoUser.used_bytes,
        GuardinoUser.total_gb,
        GuardinoUser.meta,
    )
    used_stmt = select(func.coalesce(func.sum(GuardinoUser.used_bytes), 0)).where(GuardinoUser.status != UserStatus.deleted)
    sold_stmt = select(func.coalesce(func.sum(GuardinoUser.total_gb), 0)).where(GuardinoUser.status != UserStatus.deleted)
    if reseller_id is not None:
        user_stmt = user_stmt.where(GuardinoUser.owner_reseller_id == reseller_id)
        used_stmt = used_stmt.where(GuardinoUser.owner_reseller_id == reseller_id)
        sold_stmt = sold_stmt.where(GuardinoUser.owner_reseller_id == reseller_id)

    user_rows = (await db.execute(user_stmt)).all()
    user_summary = summarize_users(user_rows, now)
    used_bytes_total = int((await db.execute(used_stmt)).scalar_one() or 0)
    sold_gb_total = int((await db.execute(sold_stmt)).scalar_one() or 0)

    nq = await db.execute(select(func.count()).select_from(Node))
    nodes_total = int(nq.scalar_one() or 0)

    orders_total_stmt = select(func.count()).select_from(Order)
    ledger_total_stmt = select(func.count()).select_from(LedgerTransaction)
    ledger_net_stmt = select(func.coalesce(func.sum(LedgerTransaction.amount), 0)).where(
        LedgerTransaction.occurred_at >= since
    )
    order_series_stmt = select(Order.created_at, Order.purchased_gb).where(
        Order.created_at >= series_since,
        Order.status == OrderStatus.completed,
    )
    ledger_series_stmt = select(LedgerTransaction.occurred_at, LedgerTransaction.amount).where(
        LedgerTransaction.occurred_at >= series_since,
        LedgerTransaction.amount < 0,
    )
    if reseller_id is not None:
        orders_total_stmt = orders_total_stmt.where(Order.reseller_id == reseller_id)
        ledger_total_stmt = ledger_total_stmt.where(LedgerTransaction.reseller_id == reseller_id)
        ledger_net_stmt = ledger_net_stmt.where(LedgerTransaction.reseller_id == reseller_id)
        order_series_stmt = order_series_stmt.where(Order.reseller_id == reseller_id)
        ledger_series_stmt = ledger_series_stmt.where(LedgerTransaction.reseller_id == reseller_id)

    orders_total = int((await db.execute(orders_total_stmt)).scalar_one() or 0)
    ledger_entries_total = int((await db.execute(ledger_total_stmt)).scalar_one() or 0)
    ledger_net_30d = int((await db.execute(ledger_net_stmt)).scalar_one() or 0)
    order_series_rows = (await db.execute(order_series_stmt)).all()
    ledger_series_rows = (await db.execute(ledger_series_stmt)).all()
    metric_series_stmt = (
        select(
            DashboardDailyMetric.day,
            func.coalesce(func.sum(DashboardDailyMetric.used_bytes_total), 0).label("used_bytes_total"),
        )
        .where(DashboardDailyMetric.day >= series_since.date())
        .group_by(DashboardDailyMetric.day)
        .order_by(DashboardDailyMetric.day)
    )
    if reseller_id is not None:
        metric_series_stmt = metric_series_stmt.where(DashboardDailyMetric.reseller_id == reseller_id)
    metric_series_rows = (await db.execute(metric_series_stmt)).all()
    daily_used_gb = set_today_series_value(
        build_daily_snapshot_series(
            metric_series_rows,
            lambda row: row.day,
            lambda row: (row.used_bytes_total or 0) / BYTES_PER_GB,
            days,
            now.date(),
        ),
        used_bytes_total / BYTES_PER_GB,
        now.date(),
    )

    if reseller_id is None:
        pavg = await db.execute(
            select(func.avg(Reseller.price_per_gb)).where(
                Reseller.role == "reseller",
                Reseller.status != ResellerStatus.deleted,
            )
        )
    else:
        pavg = await db.execute(select(Reseller.price_per_gb).where(Reseller.id == reseller_id))
    price_per_gb_avg = pavg.scalar_one_or_none()
    price_per_gb_avg_int = int(price_per_gb_avg) if price_per_gb_avg is not None else None

    return AdminStats(
        resellers_total=resellers_total,
        users_total=user_summary["total"],
        users_active=user_summary["active"],
        users_disabled=user_summary["disabled"],
        users_expired=user_summary["expired"],
        users_limited=user_summary["limited"],
        users_on_hold=user_summary["on_hold"],
        users_deleted=user_summary["deleted"],
        nodes_total=nodes_total,
        orders_total=orders_total,
        ledger_entries_total=ledger_entries_total,
        ledger_net_30d=ledger_net_30d,
        price_per_gb_avg=price_per_gb_avg_int,
        used_bytes_total=used_bytes_total,
        sold_gb_total=sold_gb_total,
        daily_sales=build_daily_series(ledger_series_rows, lambda row: row.occurred_at, lambda row: abs(row.amount), days),
        daily_traffic_gb=build_daily_series(order_series_rows, lambda row: row.created_at, lambda row: row.purchased_gb or 0, days),
        daily_used_gb=daily_used_gb,
    )
