from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_reseller
from app.core.db import get_db
from app.models.ledger import LedgerTransaction
from app.models.order import Order, OrderStatus

router = APIRouter()


async def _ledger_summary(db: AsyncSession, reseller_id: int) -> dict[str, int]:
    in_amount = func.coalesce(
        func.sum(case((LedgerTransaction.amount > 0, LedgerTransaction.amount), else_=0)),
        0,
    )
    out_amount = func.coalesce(
        func.sum(case((LedgerTransaction.amount < 0, -LedgerTransaction.amount), else_=0)),
        0,
    )
    row = (
        await db.execute(
            select(func.count(LedgerTransaction.id), in_amount, out_amount)
            .select_from(LedgerTransaction)
            .where(LedgerTransaction.reseller_id == reseller_id)
        )
    ).one()
    incoming = int(row[1] or 0)
    outgoing = int(row[2] or 0)
    return {
        "count": int(row[0] or 0),
        "in_amount": incoming,
        "out_amount": outgoing,
        "net": incoming - outgoing,
    }


async def _orders_summary(db: AsyncSession, reseller_id: int) -> dict[str, int]:
    completed = func.coalesce(func.sum(case((Order.status == OrderStatus.completed, 1), else_=0)), 0)
    pending = func.coalesce(func.sum(case((Order.status == OrderStatus.pending, 1), else_=0)), 0)
    failed = func.coalesce(
        func.sum(case((Order.status.in_([OrderStatus.failed, OrderStatus.rolled_back]), 1), else_=0)),
        0,
    )
    row = (
        await db.execute(
            select(func.count(Order.id), completed, pending, failed)
            .select_from(Order)
            .where(Order.reseller_id == reseller_id)
        )
    ).one()
    return {
        "total": int(row[0] or 0),
        "completed": int(row[1] or 0),
        "pending": int(row[2] or 0),
        "failed": int(row[3] or 0),
    }


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
    return {"items": items, "total": total, "summary": await _ledger_summary(db, reseller.id)}


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
                "type": getattr(o.type, "value", o.type),
                "status": getattr(o.status, "value", o.status),
                "client_request_id": getattr(o, "client_request_id", None),
                "purchased_gb": o.purchased_gb,
                "price_per_gb_snapshot": o.price_per_gb_snapshot,
                "created_at": o.created_at.isoformat() if o.created_at else None,
            }
        )
    return {"items": items, "total": total, "summary": await _orders_summary(db, reseller.id)}
