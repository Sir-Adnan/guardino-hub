from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc

from app.core.db import get_db
from app.api.deps import require_admin
from app.models.node_allocation import NodeAllocation
from app.models.reseller import Reseller
from app.models.node import Node
from app.schemas.admin import CreateAllocationRequest, UpdateAllocationRequest, AllocationOut

router = APIRouter()

@router.get("", response_model=list[AllocationOut])
async def list_allocations(db: AsyncSession = Depends(get_db), admin=Depends(require_admin)):
    q = await db.execute(select(NodeAllocation).order_by(desc(NodeAllocation.id)))
    items = q.scalars().all()
    return [
        AllocationOut(
            id=a.id,
            reseller_id=a.reseller_id,
            node_id=a.node_id,
            enabled=a.enabled,
            default_for_reseller=a.default_for_reseller,
            price_per_gb_override=a.price_per_gb_override,
        )
        for a in items
    ]

@router.post("", response_model=AllocationOut)
async def create_allocation(payload: CreateAllocationRequest, db: AsyncSession = Depends(get_db), admin=Depends(require_admin)):
    r = (await db.execute(select(Reseller).where(Reseller.id == payload.reseller_id))).scalar_one_or_none()
    if not r:
        raise HTTPException(status_code=404, detail="Reseller not found")

    n = (await db.execute(select(Node).where(Node.id == payload.node_id))).scalar_one_or_none()
    if not n:
        raise HTTPException(status_code=404, detail="Node not found")

    # Enforce single default allocation per reseller
    if payload.default_for_reseller:
        q = await db.execute(select(NodeAllocation).where(NodeAllocation.reseller_id == payload.reseller_id))
        for a in q.scalars().all():
            a.default_for_reseller = False

    a = NodeAllocation(
        reseller_id=payload.reseller_id,
        node_id=payload.node_id,
        enabled=payload.enabled,
        default_for_reseller=payload.default_for_reseller,
        price_per_gb_override=payload.price_per_gb_override,
    )
    db.add(a)
    try:
        await db.commit()
    except Exception as e:
        await db.rollback()
        # Likely uniqueness constraint
        raise HTTPException(status_code=409, detail="Allocation already exists")
    await db.refresh(a)

    return AllocationOut(
        id=a.id,
        reseller_id=a.reseller_id,
        node_id=a.node_id,
        enabled=a.enabled,
        default_for_reseller=a.default_for_reseller,
        price_per_gb_override=a.price_per_gb_override,
    )

@router.patch("/{allocation_id}", response_model=AllocationOut)
async def update_allocation(allocation_id: int, payload: UpdateAllocationRequest, db: AsyncSession = Depends(get_db), admin=Depends(require_admin)):
    a = (await db.execute(select(NodeAllocation).where(NodeAllocation.id == allocation_id))).scalar_one_or_none()
    if not a:
        raise HTTPException(status_code=404, detail="Allocation not found")

    fields = payload.model_fields_set

    if "enabled" in fields:
        a.enabled = bool(payload.enabled)

    if "default_for_reseller" in fields:
        if payload.default_for_reseller:
            q = await db.execute(select(NodeAllocation).where(NodeAllocation.reseller_id == a.reseller_id))
            for other in q.scalars().all():
                other.default_for_reseller = False
        a.default_for_reseller = bool(payload.default_for_reseller)

    if "price_per_gb_override" in fields:
        a.price_per_gb_override = payload.price_per_gb_override

    await db.commit()
    await db.refresh(a)

    return AllocationOut(
        id=a.id,
        reseller_id=a.reseller_id,
        node_id=a.node_id,
        enabled=a.enabled,
        default_for_reseller=a.default_for_reseller,
        price_per_gb_override=a.price_per_gb_override,
    )

@router.delete("/{allocation_id}")
async def delete_allocation(allocation_id: int, db: AsyncSession = Depends(get_db), admin=Depends(require_admin)):
    a = (await db.execute(select(NodeAllocation).where(NodeAllocation.id == allocation_id))).scalar_one_or_none()
    if not a:
        raise HTTPException(status_code=404, detail="Allocation not found")
    await db.delete(a)
    await db.commit()
    return {"ok": True}
