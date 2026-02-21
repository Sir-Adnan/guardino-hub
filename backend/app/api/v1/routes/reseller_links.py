from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime, timezone

from app.core.db import get_db
from app.api.deps import block_if_balance_zero
from app.models.user import GuardinoUser
from app.models.subaccount import SubAccount
from app.models.node import Node
from app.services.adapters.factory import get_adapter
from app.schemas.links import UserLinksResponse, NodeLink

router = APIRouter()

@router.get("/{user_id}/links", response_model=UserLinksResponse)
async def get_links(user_id: int, request: Request, refresh: bool = False, db: AsyncSession = Depends(get_db), reseller = Depends(block_if_balance_zero)):
    q = await db.execute(select(GuardinoUser).where(GuardinoUser.id == user_id, GuardinoUser.owner_reseller_id == reseller.id))
    user = q.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    qs = await db.execute(select(SubAccount).where(SubAccount.user_id == user.id))
    subs = qs.scalars().all()
    if not subs:
        raise HTTPException(status_code=400, detail="No subaccounts")

    # Load nodes
    node_ids = [sa.node_id for sa in subs]
    qn = await db.execute(select(Node).where(Node.id.in_(node_ids)))
    node_map = {n.id: n for n in qn.scalars().all()}

    node_links: list[NodeLink] = []
    now = datetime.now(timezone.utc)

    for sa in subs:
        direct = sa.panel_sub_url_cached
        status = "ok" if direct else "missing"
        detail = None

        if refresh and sa.node_id in node_map:
            try:
                adapter = get_adapter(node_map[sa.node_id])
                direct_new = await adapter.get_direct_subscription_url(sa.remote_identifier)
                if direct_new:
                    sa.panel_sub_url_cached = direct_new
                    sa.panel_sub_url_cached_at = now
                    direct = direct_new
                    status = "ok"
                else:
                    status = "missing"
            except Exception as e:
                status = "error"
                detail = str(e)[:160]

        node_links.append(NodeLink(node_id=sa.node_id, direct_url=direct, status=status, detail=detail))

    if refresh:
        await db.commit()

    master = str(request.base_url).rstrip("/") + f"/api/v1/sub/{user.master_sub_token}"
    return UserLinksResponse(user_id=user.id, master_link=master, node_links=node_links)
