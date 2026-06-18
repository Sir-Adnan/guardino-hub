from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin
from app.core.db import get_db
from app.models.ledger import LedgerTransaction
from app.models.order import Order, OrderStatus
from app.models.reseller import Reseller

router = APIRouter()


async def _ledger_summary(db: AsyncSession, reseller_id: int | None = None) -> dict[str, int]:
    in_amount = func.coalesce(
        func.sum(case((LedgerTransaction.amount > 0, LedgerTransaction.amount), else_=0)),
        0,
    )
    out_amount = func.coalesce(
        func.sum(case((LedgerTransaction.amount < 0, -LedgerTransaction.amount), else_=0)),
        0,
    )
    stmt = select(func.count(LedgerTransaction.id), in_amount, out_amount).select_from(LedgerTransaction)
    if reseller_id is not None:
        stmt = stmt.where(LedgerTransaction.reseller_id == reseller_id)
    row = (await db.execute(stmt)).one()
    incoming = int(row[1] or 0)
    outgoing = int(row[2] or 0)
    return {
        "count": int(row[0] or 0),
        "in_amount": incoming,
        "out_amount": outgoing,
        "net": incoming - outgoing,
    }


async def _orders_summary(db: AsyncSession, reseller_id: int | None = None) -> dict[str, int]:
    completed = func.coalesce(func.sum(case((Order.status == OrderStatus.completed, 1), else_=0)), 0)
    pending = func.coalesce(func.sum(case((Order.status == OrderStatus.pending, 1), else_=0)), 0)
    failed = func.coalesce(
        func.sum(case((Order.status.in_([OrderStatus.failed, OrderStatus.rolled_back]), 1), else_=0)),
        0,
    )
    stmt = select(func.count(Order.id), completed, pending, failed).select_from(Order)
    if reseller_id is not None:
        stmt = stmt.where(Order.reseller_id == reseller_id)
    row = (await db.execute(stmt)).one()
    return {
        "total": int(row[0] or 0),
        "completed": int(row[1] or 0),
        "pending": int(row[2] or 0),
        "failed": int(row[3] or 0),
    }


@router.get("/resellers")
async def list_resellers(
    db: AsyncSession = Depends(get_db),
    admin=Depends(require_admin),
    offset: int = Query(0, ge=0),
    limit: int = Query(200, ge=1, le=1000),
):
    total_q = await db.execute(select(func.count()).select_from(Reseller))
    total = int(total_q.scalar_one())
    q = await db.execute(select(Reseller).order_by(desc(Reseller.id)).limit(limit).offset(offset))
    out = []
    for r in q.scalars().all():
        out.append(
            {
                "id": r.id,
                "parent_id": r.parent_id,
                "username": r.username,
                "status": r.status.value,
                "balance": r.balance,
                "price_per_gb": r.price_per_gb,
                "bundle_price_per_gb": getattr(r, "bundle_price_per_gb", None),
                "price_per_day": r.price_per_day,
            }
        )
    return {"items": out, "total": total}


@router.get("/ledger")
async def ledger(
    reseller_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    admin=Depends(require_admin),
    offset: int = Query(0, ge=0),
    limit: int = Query(200, ge=1, le=1000),
):
    stmt = select(LedgerTransaction)
    total_stmt = select(func.count()).select_from(LedgerTransaction)
    if reseller_id is not None:
        stmt = stmt.where(LedgerTransaction.reseller_id == reseller_id)
        total_stmt = total_stmt.where(LedgerTransaction.reseller_id == reseller_id)

    total_q = await db.execute(total_stmt)
    total = int(total_q.scalar_one())
    q = await db.execute(stmt.order_by(desc(LedgerTransaction.id)).limit(limit).offset(offset))

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
    return {"items": items, "total": total, "summary": await _ledger_summary(db, reseller_id)}


@router.get("/orders")
async def orders(
    reseller_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    admin=Depends(require_admin),
    offset: int = Query(0, ge=0),
    limit: int = Query(200, ge=1, le=1000),
):
    stmt = select(Order)
    total_stmt = select(func.count()).select_from(Order)
    if reseller_id is not None:
        stmt = stmt.where(Order.reseller_id == reseller_id)
        total_stmt = total_stmt.where(Order.reseller_id == reseller_id)

    total_q = await db.execute(total_stmt)
    total = int(total_q.scalar_one())
    q = await db.execute(stmt.order_by(desc(Order.id)).limit(limit).offset(offset))

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
    return {"items": items, "total": total, "summary": await _orders_summary(db, reseller_id)}
