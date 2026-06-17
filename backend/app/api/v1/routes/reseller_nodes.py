from __future__ import annotations
from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import func, select

from app.core.db import get_db
from app.api.deps import block_if_balance_zero
from app.models.node import Node
from app.models.node_allocation import NodeAllocation
from app.models.subaccount import SubAccount
from app.models.user import GuardinoUser
from app.schemas.nodes import AllowedNodeList

router = APIRouter()

@router.get("", response_model=AllowedNodeList)
async def list_allowed_nodes(request: Request, db: AsyncSession = Depends(get_db), reseller=Depends(block_if_balance_zero)):
    latest_sync = (
        select(SubAccount.node_id, func.max(SubAccount.last_sync_at).label("last_sync_at"))
        .join(GuardinoUser, GuardinoUser.id == SubAccount.user_id)
        .where(GuardinoUser.owner_reseller_id == reseller.id)
        .group_by(SubAccount.node_id)
        .subquery()
    )
    q = await db.execute(
        select(Node, NodeAllocation, latest_sync.c.last_sync_at)
        .join(NodeAllocation, NodeAllocation.node_id == Node.id)
        .outerjoin(latest_sync, latest_sync.c.node_id == Node.id)
        .where(
            NodeAllocation.reseller_id == reseller.id,
            NodeAllocation.enabled == True,
            Node.is_enabled == True,
        )
        .order_by(Node.id.desc())
    )
    items = []
    for node, alloc, last_sync_at in q.all():
        items.append({
            "id": node.id,
            "name": node.name,
            # Security: do not expose raw node base URL in reseller node listing.
            "public_code": f"N-{node.id:04d}",
            "panel_type": node.panel_type.value,
            "tags": node.tags,
            "is_visible_in_sub": node.is_visible_in_sub,
            "default_for_reseller": bool(alloc.default_for_reseller),
            "price_per_gb_override": alloc.price_per_gb_override,
            "last_sync_at": last_sync_at.isoformat() if last_sync_at else None,
        })
    return {"items": items}
