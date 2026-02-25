from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.core.db import get_db
from app.api.deps import require_admin
from app.core.security import hash_password
from app.models.reseller import Reseller, ResellerStatus
from app.models.ledger import LedgerTransaction
from app.schemas.admin import (
    CreateResellerRequest,
    ResellerOut,
    ResellerList,
    CreditRequest,
    UpdateResellerRequest,
    SetResellerStatusRequest,
)

router = APIRouter()


def _to_out(r: Reseller) -> ResellerOut:
    return ResellerOut(
        id=r.id,
        parent_id=r.parent_id,
        username=r.username,
        role=(r.role or "reseller"),
        status=r.status.value,
        balance=r.balance,
        price_per_gb=r.price_per_gb,
        bundle_price_per_gb=getattr(r, "bundle_price_per_gb", 0),
        price_per_day=getattr(r, "price_per_day", 0),
        can_create_subreseller=getattr(r, "can_create_subreseller", None),
    )


@router.get("", response_model=ResellerList)
async def list_resellers(
    db: AsyncSession = Depends(get_db),
    admin=Depends(require_admin),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=1000),
):
    base = select(Reseller).order_by(Reseller.id.desc())
    total_q = await db.execute(select(func.count()).select_from(base.subquery()))
    total = int(total_q.scalar_one())
    q = await db.execute(base.limit(limit).offset(offset))
    rows = q.scalars().all()
    return ResellerList(items=[_to_out(r) for r in rows], total=total)


@router.get("/{reseller_id}", response_model=ResellerOut)
async def get_reseller(reseller_id: int, db: AsyncSession = Depends(get_db), admin=Depends(require_admin)):
    q = await db.execute(select(Reseller).where(Reseller.id == reseller_id))
    r = q.scalar_one_or_none()
    if not r:
        raise HTTPException(status_code=404, detail="Reseller not found")
    return _to_out(r)

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

    return _to_out(r)


@router.patch("/{reseller_id}", response_model=ResellerOut)
async def update_reseller(
    reseller_id: int,
    payload: UpdateResellerRequest,
    db: AsyncSession = Depends(get_db),
    admin=Depends(require_admin),
):
    q = await db.execute(select(Reseller).where(Reseller.id == reseller_id))
    r = q.scalar_one_or_none()
    if not r:
        raise HTTPException(status_code=404, detail="Reseller not found")

    fields = payload.model_fields_set
    if "parent_id" in fields:
        r.parent_id = payload.parent_id
    if "price_per_gb" in fields and payload.price_per_gb is not None:
        r.price_per_gb = payload.price_per_gb
    if "bundle_price_per_gb" in fields and payload.bundle_price_per_gb is not None:
        r.bundle_price_per_gb = payload.bundle_price_per_gb
    if "price_per_day" in fields and payload.price_per_day is not None:
        r.price_per_day = payload.price_per_day
    if "can_create_subreseller" in fields and payload.can_create_subreseller is not None:
        r.can_create_subreseller = payload.can_create_subreseller
    if payload.password:
        r.password_hash = hash_password(payload.password)

    await db.commit()
    await db.refresh(r)
    return _to_out(r)


@router.post("/{reseller_id}/set-status", response_model=ResellerOut)
async def set_reseller_status(
    reseller_id: int,
    payload: SetResellerStatusRequest,
    db: AsyncSession = Depends(get_db),
    admin=Depends(require_admin),
):
    if payload.status not in (ResellerStatus.active.value, ResellerStatus.disabled.value):
        raise HTTPException(status_code=400, detail="Invalid status")
    q = await db.execute(select(Reseller).where(Reseller.id == reseller_id))
    r = q.scalar_one_or_none()
    if not r:
        raise HTTPException(status_code=404, detail="Reseller not found")
    r.status = ResellerStatus(payload.status)
    await db.commit()
    await db.refresh(r)
    return _to_out(r)


@router.delete("/{reseller_id}", response_model=ResellerOut)
async def delete_reseller(reseller_id: int, db: AsyncSession = Depends(get_db), admin=Depends(require_admin)):
    q = await db.execute(select(Reseller).where(Reseller.id == reseller_id))
    r = q.scalar_one_or_none()
    if not r:
        raise HTTPException(status_code=404, detail="Reseller not found")
    r.status = ResellerStatus.deleted
    await db.commit()
    await db.refresh(r)
    return _to_out(r)

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
