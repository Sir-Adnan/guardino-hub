from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.db import get_db
from app.api.deps import require_admin
from app.core.security import hash_password
from app.models.reseller import Reseller, ResellerStatus
from app.models.ledger import LedgerTransaction
from app.schemas.admin import CreateResellerRequest, ResellerOut, CreditRequest

router = APIRouter()

@router.post("", response_model=ResellerOut)
async def create_reseller(payload: CreateResellerRequest, db: AsyncSession = Depends(get_db), admin=Depends(require_admin)):
    q = await db.execute(select(Reseller).where(Reseller.username == payload.username))
    if q.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Username already exists")

    r = Reseller(
        parent_id=payload.parent_id,
        username=payload.username,
        password_hash=hash_password(payload.password),
        status=ResellerStatus.active,
        balance=0,
        price_per_gb=payload.price_per_gb,
        bundle_price_per_gb=payload.bundle_price_per_gb,
        price_per_day=payload.price_per_day,
        can_create_subreseller=payload.can_create_subreseller,
    )
    db.add(r)
    await db.commit()
    await db.refresh(r)

    return ResellerOut(
        id=r.id,
        parent_id=r.parent_id,
        username=r.username,
        status=r.status.value,
        balance=r.balance,
        price_per_gb=r.price_per_gb,
        price_per_day=r.price_per_day,
    )

@router.post("/{reseller_id}/credit")
async def credit_reseller(reseller_id: int, payload: CreditRequest, db: AsyncSession = Depends(get_db), admin=Depends(require_admin)):
    q = await db.execute(select(Reseller).where(Reseller.id == reseller_id))
    r = q.scalar_one_or_none()
    if not r:
        raise HTTPException(status_code=404, detail="Reseller not found")

    r.balance += payload.amount
    tx = LedgerTransaction(
        reseller_id=r.id,
        order_id=None,
        amount=payload.amount,
        reason=payload.reason,
        balance_after=r.balance,
    )
    db.add(tx)
    await db.commit()
    return {"ok": True, "balance": r.balance}
