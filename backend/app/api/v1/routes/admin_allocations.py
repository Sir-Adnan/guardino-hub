from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.db import get_db
from app.api.deps import require_admin
from app.models.node_allocation import NodeAllocation
from app.models.reseller import Reseller
from app.models.node import Node
from app.schemas.admin import CreateAllocationRequest, AllocationOut

router = APIRouter()

@router.post("", response_model=AllocationOut)
async def create_allocation(payload: CreateAllocationRequest, db: AsyncSession = Depends(get_db), admin=Depends(require_admin)):
    r = (await db.execute(select(Reseller).where(Reseller.id == payload.reseller_id))).scalar_one_or_none()
    if not r:
        raise HTTPException(status_code=404, detail="Reseller not found")

    n = (await db.execute(select(Node).where(Node.id == payload.node_id))).scalar_one_or_none()
    if not n:
        raise HTTPException(status_code=404, detail="Node not found")

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
