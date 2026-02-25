from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_reseller
from app.core.db import get_db
from app.models.ledger import LedgerTransaction
from app.models.order import Order

router = APIRouter()


@router.get("/ledger")
async def reseller_ledger(
    db: AsyncSession = Depends(get_db),
    reseller=Depends(require_reseller),
    offset: int = Query(0, ge=0),
    limit: int = Query(200, ge=1, le=1000),
):
    stmt = (
        select(LedgerTransaction)
        .where(LedgerTransaction.reseller_id == reseller.id)
        .order_by(desc(LedgerTransaction.id))
    )
    total_q = await db.execute(select(func.count()).select_from(stmt.subquery()))
    total = int(total_q.scalar_one())
    q = await db.execute(stmt.limit(limit).offset(offset))

    items = []
    for t in q.scalars().all():
        items.append(
            {
                "id": t.id,
                "reseller_id": t.reseller_id,
                "order_id": t.order_id,
                "amount": t.amount,
                "reason": t.reason,
                "balance_after": t.balance_after,
                "occurred_at": t.occurred_at.isoformat() if t.occurred_at else None,
            }
        )
    return {"items": items, "total": total}


@router.get("/orders")
async def reseller_orders(
    db: AsyncSession = Depends(get_db),
    reseller=Depends(require_reseller),
    offset: int = Query(0, ge=0),
    limit: int = Query(200, ge=1, le=1000),
):
    stmt = (
        select(Order)
        .where(Order.reseller_id == reseller.id)
        .order_by(desc(Order.id))
    )
    total_q = await db.execute(select(func.count()).select_from(stmt.subquery()))
    total = int(total_q.scalar_one())
    q = await db.execute(stmt.limit(limit).offset(offset))

    items = []
    for o in q.scalars().all():
        items.append(
            {
                "id": o.id,
                "reseller_id": o.reseller_id,
                "user_id": o.user_id,
                "type": o.type.value,
                "status": o.status.value,
                "purchased_gb": o.purchased_gb,
                "price_per_gb_snapshot": o.price_per_gb_snapshot,
                "created_at": o.created_at.isoformat() if o.created_at else None,
            }
        )
    return {"items": items, "total": total}
