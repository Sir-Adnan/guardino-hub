from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.api.deps import require_reseller
from app.models.user import GuardinoUser
from app.models.node_allocation import NodeAllocation
from app.models.node import Node
from app.models.order import Order, OrderStatus
from app.models.ledger import LedgerTransaction
from app.models.dashboard_metric import DashboardDailyMetric
from app.schemas.stats import ResellerStats
from app.services.dashboard_metrics import (
    BYTES_PER_GB,
    accounted_user_condition,
    build_daily_series,
    build_daily_snapshot_series,
    set_today_series_value,
    summarize_users,
)

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("", response_model=ResellerStats)
async def get_reseller_stats(
    db: AsyncSession = Depends(get_db),
    reseller=Depends(require_reseller),
    days: int = Query(14, ge=7, le=31),
):
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=30)
    series_since = now.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=days - 1)

    user_rows = (
        await db.execute(
            select(
                GuardinoUser.status,
                GuardinoUser.expire_at,
                GuardinoUser.used_bytes,
                GuardinoUser.total_gb,
                GuardinoUser.meta,
                accounted_user_condition().label("is_accounted"),
            ).where(GuardinoUser.owner_reseller_id == reseller.id)
        )
    ).all()
    user_summary = summarize_users(user_rows, now)

    uq = await db.execute(
        select(
            func.coalesce(func.sum(GuardinoUser.used_bytes), 0).label("used_bytes_total"),
            func.coalesce(func.sum(GuardinoUser.total_gb), 0).label("sold_gb_total"),
        ).where(
            GuardinoUser.owner_reseller_id == reseller.id,
            accounted_user_condition(),
        )
    )
    urow = uq.one()
    used_bytes_total = int(urow.used_bytes_total or 0)
    sold_gb_total = int(urow.sold_gb_total or 0)

    nq = await db.execute(
        select(func.count())
        .select_from(NodeAllocation)
        .join(Node, Node.id == NodeAllocation.node_id)
        .where(
            NodeAllocation.reseller_id == reseller.id,
            NodeAllocation.enabled == True,
            Node.is_enabled == True,
        )
    )
    nodes_allowed = int(nq.scalar_one() or 0)

    oq = await db.execute(select(func.count()).select_from(Order).where(Order.reseller_id == reseller.id))
    orders_total = int(oq.scalar_one() or 0)
    oq30 = await db.execute(
        select(func.count()).select_from(Order).where(Order.reseller_id == reseller.id, Order.created_at >= since)
    )
    orders_30d = int(oq30.scalar_one() or 0)

    lq = await db.execute(
        select(func.coalesce(func.sum(-LedgerTransaction.amount), 0)).where(
            LedgerTransaction.reseller_id == reseller.id,
            LedgerTransaction.amount < 0,
            LedgerTransaction.occurred_at >= since,
        )
    )
    spent_30d = int(lq.scalar_one() or 0)

    order_series_rows = (
        await db.execute(
            select(Order.created_at, Order.purchased_gb).where(
                Order.reseller_id == reseller.id,
                Order.created_at >= series_since,
                Order.status == OrderStatus.completed,
            )
        )
    ).all()
    ledger_series_rows = (
        await db.execute(
            select(LedgerTransaction.occurred_at, LedgerTransaction.amount).where(
                LedgerTransaction.reseller_id == reseller.id,
                LedgerTransaction.occurred_at >= series_since,
                LedgerTransaction.amount < 0,
            )
        )
    ).all()
    try:
        metric_series_rows = (
            await db.execute(
                select(DashboardDailyMetric.day, DashboardDailyMetric.used_bytes_total)
                .where(
                    DashboardDailyMetric.reseller_id == reseller.id,
                    DashboardDailyMetric.day >= series_since.date(),
                )
                .order_by(DashboardDailyMetric.day)
            )
        ).all()
    except SQLAlchemyError as exc:
        await db.rollback()
        logger.warning("reseller stats metric series unavailable reseller_id=%s err=%s", reseller.id, str(exc)[:220])
        metric_series_rows = []
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

    return ResellerStats(
        reseller_id=reseller.id,
        balance=int(reseller.balance or 0),
        status=reseller.status.value,
        price_per_gb=int(reseller.price_per_gb or 0),
        bundle_price_per_gb=int(reseller.bundle_price_per_gb or 0),
        price_per_day=int(reseller.price_per_day or 0),
        users_total=user_summary["total"],
        users_active=user_summary["active"],
        users_disabled=user_summary["disabled"],
        users_expired=user_summary["expired"],
        users_limited=user_summary["limited"],
        users_on_hold=user_summary["on_hold"],
        users_deleted=user_summary["deleted"],
        used_bytes_total=used_bytes_total,
        sold_gb_total=sold_gb_total,
        nodes_allowed=nodes_allowed,
        orders_total=orders_total,
        orders_30d=orders_30d,
        spent_30d=spent_30d,
        daily_sales=build_daily_series(ledger_series_rows, lambda row: row.occurred_at, lambda row: abs(row.amount), days),
        daily_traffic_gb=build_daily_series(order_series_rows, lambda row: row.created_at, lambda row: row.purchased_gb or 0, days),
        daily_used_gb=daily_used_gb,
    )
