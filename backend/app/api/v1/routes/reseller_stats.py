from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import select, func, case
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.api.deps import require_reseller
from app.models.user import GuardinoUser, UserStatus
from app.models.node_allocation import NodeAllocation
from app.models.node import Node
from app.models.order import Order
from app.models.ledger import LedgerTransaction
from app.schemas.stats import ResellerStats

router = APIRouter()


@router.get("", response_model=ResellerStats)
async def get_reseller_stats(db: AsyncSession = Depends(get_db), reseller=Depends(require_reseller)):
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=30)

    # Users
    uq = await db.execute(
        select(
            func.count().label("total"),
            func.coalesce(func.sum(case((GuardinoUser.status == UserStatus.active, 1), else_=0)), 0).label("active"),
            func.coalesce(func.sum(case((GuardinoUser.status == UserStatus.disabled, 1), else_=0)), 0).label("disabled"),
        ).where(GuardinoUser.owner_reseller_id == reseller.id)
    )
    urow = uq.one()
    users_total = int(urow.total or 0)
    users_active = int(urow.active or 0)
    users_disabled = int(urow.disabled or 0)

    # Allowed nodes
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

    # Orders
    oq = await db.execute(select(func.count()).select_from(Order).where(Order.reseller_id == reseller.id))
    orders_total = int(oq.scalar_one() or 0)
    oq30 = await db.execute(
        select(func.count()).select_from(Order).where(Order.reseller_id == reseller.id, Order.created_at >= since)
    )
    orders_30d = int(oq30.scalar_one() or 0)

    # Spent (debits) last 30d
    lq = await db.execute(
        select(func.coalesce(func.sum(-LedgerTransaction.amount), 0))
        .where(
            LedgerTransaction.reseller_id == reseller.id,
            LedgerTransaction.amount < 0,
            LedgerTransaction.occurred_at >= since,
        )
    )
    spent_30d = int(lq.scalar_one() or 0)

    return ResellerStats(
        reseller_id=reseller.id,
        balance=int(reseller.balance or 0),
        status=reseller.status.value,
        price_per_gb=int(reseller.price_per_gb or 0),
        bundle_price_per_gb=int(reseller.bundle_price_per_gb or 0),
        price_per_day=int(reseller.price_per_day or 0),
        users_total=users_total,
        users_active=users_active,
        users_disabled=users_disabled,
        nodes_allowed=nodes_allowed,
        orders_total=orders_total,
        orders_30d=orders_30d,
        spent_30d=spent_30d,
    )
