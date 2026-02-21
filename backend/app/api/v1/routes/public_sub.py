from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import httpx

from app.core.db import get_db
from app.models.user import GuardinoUser, UserStatus, NodeSelectionMode
from app.models.subaccount import SubAccount
from app.models.node import Node
from app.models.node_allocation import NodeAllocation
from app.services.adapters.factory import get_adapter
from app.services.subscription_merge import merge_subscriptions
from app.services.http_client import build_async_client

router = APIRouter()

@router.get("/sub/{token}")
async def subscription(token: str, db: AsyncSession = Depends(get_db)):
    q = await db.execute(select(GuardinoUser).where(GuardinoUser.master_sub_token == token))
    user = q.scalar_one_or_none()
    if not user or user.status in (UserStatus.deleted,):
        raise HTTPException(status_code=404, detail="Not found")

    # Resolve nodes for this user:
    # - If manual: nodes from subaccounts
    # - If group: ensure subaccounts exist for all enabled, visible nodes tagged with user.node_group AND allocated to reseller
    if user.node_selection_mode == NodeSelectionMode.group and user.node_group:
        # eligible nodes: allocated to reseller + enabled + visible + tag contains node_group
        qn = await db.execute(
            select(Node).join(NodeAllocation, NodeAllocation.node_id == Node.id)
            .where(
                NodeAllocation.reseller_id == user.owner_reseller_id,
                NodeAllocation.enabled == True,
                Node.is_enabled == True,
                Node.is_visible_in_sub == True,
            )
        )
        eligible = [n for n in qn.scalars().all() if user.node_group in (n.tags or [])]
        # existing subaccounts map
        qs = await db.execute(select(SubAccount).where(SubAccount.user_id == user.id))
        existing = {sa.node_id: sa for sa in qs.scalars().all()}
        # lazy provision missing nodes (does NOT touch other nodes; only uses official APIs)
        for n in eligible:
            if n.id in existing:
                continue
            try:
                adapter = get_adapter(n)
                pr = await adapter.provision_user(label=user.label, total_gb=user.total_gb, expire_at=user.expire_at)
                sa = SubAccount(
                    user_id=user.id,
                    node_id=n.id,
                    remote_identifier=pr.remote_identifier,
                    panel_sub_url_cached=pr.direct_sub_url,
                    panel_sub_url_cached_at=user.created_at,
                    used_bytes=0,
                )
                db.add(sa)
            except Exception:
                # If a node fails to provision, we just skip it for now (fail-soft)
                continue
        await db.commit()

    # Now fetch subscription bodies from each subaccount direct url (if any)
    qs2 = await db.execute(select(SubAccount).where(SubAccount.user_id == user.id))
    subs = qs2.scalars().all()

    bodies = []
    async with build_async_client() as client:
        for sa in subs:
            if not sa.panel_sub_url_cached:
                continue
            try:
                resp = await client.get(sa.panel_sub_url_cached)
                if resp.status_code >= 400:
                    continue
                bodies.append(resp.text)
            except httpx.RequestError:
                continue

    merged_b64 = merge_subscriptions(bodies)
    return Response(content=merged_b64, media_type="text/plain")
