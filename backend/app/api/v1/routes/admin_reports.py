from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc

from app.core.db import get_db
from app.api.deps import require_admin
from app.models.reseller import Reseller
from app.models.ledger import LedgerTransaction
from app.models.order import Order

router = APIRouter()

@router.get("/resellers")
async def list_resellers(db: AsyncSession = Depends(get_db), admin=Depends(require_admin)):
    q = await db.execute(select(Reseller).order_by(desc(Reseller.id)).limit(200))
    out = []
    for r in q.scalars().all():
        out.append({
            "id": r.id,
            "parent_id": r.parent_id,
            "username": r.username,
            "status": r.status.value,
            "balance": r.balance,
            "price_per_gb": r.price_per_gb,
            "bundle_price_per_gb": getattr(r, "bundle_price_per_gb", None),
            "price_per_day": r.price_per_day,
        })
    return {"items": out}

@router.get("/ledger")
async def ledger(reseller_id: int | None = None, db: AsyncSession = Depends(get_db), admin=Depends(require_admin)):
    stmt = select(LedgerTransaction).order_by(desc(LedgerTransaction.id)).limit(500)
    if reseller_id is not None:
        stmt = select(LedgerTransaction).where(LedgerTransaction.reseller_id == reseller_id).order_by(desc(LedgerTransaction.id)).limit(500)
    q = await db.execute(stmt)
    items = []
    for t in q.scalars().all():
        items.append({
            "id": t.id,
            "reseller_id": t.reseller_id,
            "order_id": t.order_id,
            "amount": t.amount,
            "reason": t.reason,
            "balance_after": t.balance_after,
            "occurred_at": t.occurred_at.isoformat() if t.occurred_at else None,
        })
    return {"items": items}

@router.get("/orders")
async def orders(reseller_id: int | None = None, db: AsyncSession = Depends(get_db), admin=Depends(require_admin)):
    stmt = select(Order).order_by(desc(Order.id)).limit(500)
    if reseller_id is not None:
        stmt = select(Order).where(Order.reseller_id == reseller_id).order_by(desc(Order.id)).limit(500)
    q = await db.execute(stmt)
    items = []
    for o in q.scalars().all():
        items.append({
            "id": o.id,
            "reseller_id": o.reseller_id,
            "user_id": o.user_id,
            "type": o.type.value,
            "status": o.status.value,
            "purchased_gb": o.purchased_gb,
            "price_per_gb_snapshot": o.price_per_gb_snapshot,
            "created_at": o.created_at.isoformat() if o.created_at else None,
        })
    return {"items": items}
