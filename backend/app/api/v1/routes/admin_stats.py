from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.api.deps import require_admin
from app.models.reseller import Reseller, ResellerStatus
from app.models.user import GuardinoUser, UserStatus
from app.models.node import Node
from app.models.order import Order, OrderStatus
from app.models.ledger import LedgerTransaction
from app.schemas.stats import AdminStats
from app.services.dashboard_metrics import build_daily_series, summarize_users

router = APIRouter()
SERIES_DAYS = 14


@router.get("", response_model=AdminStats)
async def get_admin_stats(db: AsyncSession = Depends(get_db), admin=Depends(require_admin)):
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=30)
    series_since = now.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=SERIES_DAYS - 1)

    rq = await db.execute(select(func.count()).select_from(Reseller).where(Reseller.role == "reseller", Reseller.status != ResellerStatus.deleted))
    resellers_total = int(rq.scalar_one() or 0)

    user_rows = (
        await db.execute(
            select(
                GuardinoUser.status,
                GuardinoUser.expire_at,
                GuardinoUser.used_bytes,
                GuardinoUser.total_gb,
                GuardinoUser.meta,
            )
        )
    ).all()
    user_summary = summarize_users(user_rows, now)

    nq = await db.execute(select(func.count()).select_from(Node))
    nodes_total = int(nq.scalar_one() or 0)

    oq = await db.execute(select(func.count()).select_from(Order))
    orders_total = int(oq.scalar_one() or 0)

    lq = await db.execute(select(func.count()).select_from(LedgerTransaction))
    ledger_entries_total = int(lq.scalar_one() or 0)

    lnet = await db.execute(select(func.coalesce(func.sum(LedgerTransaction.amount), 0)).where(LedgerTransaction.occurred_at >= since))
    ledger_net_30d = int(lnet.scalar_one() or 0)

    pavg = await db.execute(select(func.avg(Reseller.price_per_gb)).where(Reseller.role == "reseller", Reseller.status != ResellerStatus.deleted))
    price_per_gb_avg = pavg.scalar_one()
    price_per_gb_avg_int = int(price_per_gb_avg) if price_per_gb_avg is not None else None

    ubytes = await db.execute(
        select(func.coalesce(func.sum(GuardinoUser.used_bytes), 0)).where(GuardinoUser.status != UserStatus.deleted)
    )
    used_bytes_total = int(ubytes.scalar_one() or 0)

    sgb = await db.execute(
        select(func.coalesce(func.sum(GuardinoUser.total_gb), 0)).where(GuardinoUser.status != UserStatus.deleted)
    )
    sold_gb_total = int(sgb.scalar_one() or 0)

    order_series_rows = (
        await db.execute(
            select(Order.created_at, Order.purchased_gb).where(
                Order.created_at >= series_since,
                Order.status == OrderStatus.completed,
            )
        )
    ).all()
    ledger_series_rows = (
        await db.execute(
            select(LedgerTransaction.occurred_at, LedgerTransaction.amount).where(
                LedgerTransaction.occurred_at >= series_since,
                LedgerTransaction.amount < 0,
            )
        )
    ).all()

    return AdminStats(
        resellers_total=resellers_total,
        users_total=user_summary["total"],
        users_active=user_summary["active"],
        users_disabled=user_summary["disabled"],
        users_expired=user_summary["expired"],
        users_limited=user_summary["limited"],
        users_on_hold=user_summary["on_hold"],
        nodes_total=nodes_total,
        orders_total=orders_total,
        ledger_entries_total=ledger_entries_total,
        ledger_net_30d=ledger_net_30d,
        price_per_gb_avg=price_per_gb_avg_int,
        used_bytes_total=used_bytes_total,
        sold_gb_total=sold_gb_total,
        daily_sales=build_daily_series(ledger_series_rows, lambda row: row.occurred_at, lambda row: abs(row.amount), SERIES_DAYS),
        daily_traffic_gb=build_daily_series(order_series_rows, lambda row: row.created_at, lambda row: row.purchased_gb or 0, SERIES_DAYS),
    )
