from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.api.deps import require_admin
from app.models.reseller import Reseller, ResellerStatus
from app.models.user import GuardinoUser
from app.models.node import Node
from app.models.order import Order
from app.models.ledger import LedgerTransaction
from app.schemas.stats import AdminStats

router = APIRouter()


@router.get("", response_model=AdminStats)
async def get_admin_stats(db: AsyncSession = Depends(get_db), admin=Depends(require_admin)):
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=30)

    rq = await db.execute(select(func.count()).select_from(Reseller).where(Reseller.role == "reseller", Reseller.status != ResellerStatus.deleted))
    resellers_total = int(rq.scalar_one() or 0)

    uq = await db.execute(select(func.count()).select_from(GuardinoUser))
    users_total = int(uq.scalar_one() or 0)

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

    ubytes = await db.execute(select(func.coalesce(func.sum(GuardinoUser.used_bytes), 0)))
    used_bytes_total = int(ubytes.scalar_one() or 0)

    sgb = await db.execute(select(func.coalesce(func.sum(GuardinoUser.total_gb), 0)))
    sold_gb_total = int(sgb.scalar_one() or 0)

    return AdminStats(
        resellers_total=resellers_total,
        users_total=users_total,
        nodes_total=nodes_total,
        orders_total=orders_total,
        ledger_entries_total=ledger_entries_total,
        ledger_net_30d=ledger_net_30d,
        price_per_gb_avg=price_per_gb_avg_int,
        used_bytes_total=used_bytes_total,
        sold_gb_total=sold_gb_total,
    )
