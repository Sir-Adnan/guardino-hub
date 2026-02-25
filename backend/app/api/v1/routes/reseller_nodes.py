from __future__ import annotations
from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.db import get_db
from app.api.deps import block_if_balance_zero
from app.models.node import Node
from app.models.node_allocation import NodeAllocation

router = APIRouter()

@router.get("")
async def list_allowed_nodes(request: Request, db: AsyncSession = Depends(get_db), reseller=Depends(block_if_balance_zero)):
    q = await db.execute(
        select(Node, NodeAllocation)
        .join(NodeAllocation, NodeAllocation.node_id == Node.id)
        .where(
            NodeAllocation.reseller_id == reseller.id,
            NodeAllocation.enabled == True,
            Node.is_enabled == True,
        )
        .order_by(Node.id.desc())
    )
    items = []
    for node, alloc in q.all():
        items.append({
            "id": node.id,
            "name": node.name,
            "panel_type": node.panel_type.value,
            "tags": node.tags,
            "base_url": node.base_url,
            "is_visible_in_sub": node.is_visible_in_sub,
            "default_for_reseller": bool(alloc.default_for_reseller),
            "price_per_gb_override": alloc.price_per_gb_override,
        })
    return {"items": items}
