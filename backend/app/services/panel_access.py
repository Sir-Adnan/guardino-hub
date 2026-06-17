from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.node import Node
from app.models.node_allocation import NodeAllocation
from app.models.subaccount import SubAccount
from app.models.user import GuardinoUser
from app.services.adapters.factory import get_adapter

_AUTH_KEYS = {
    "username",
    "password",
    "token",
    "access_token",
    "apikey",
    "api_key",
}


def allocation_uses_dedicated_credentials(allocation: NodeAllocation | None) -> bool:
    return bool(
        allocation
        and str(allocation.credential_mode or "shared").strip().lower() == "dedicated"
        and isinstance(allocation.credentials, dict)
        and bool(allocation.credentials)
    )


def effective_credentials(node: Node, allocation: NodeAllocation | None = None) -> dict:
    base = dict(node.credentials or {})
    if not allocation_uses_dedicated_credentials(allocation):
        return base

    inherited = dict(base)
    for key in _AUTH_KEYS:
        inherited.pop(key, None)
    inherited.update(dict(allocation.credentials or {}))
    return inherited


def get_adapter_for_allocation(node: Node, allocation: NodeAllocation | None = None):
    return get_adapter(node, credentials=effective_credentials(node, allocation))


async def get_enabled_allocation_map(
    db: AsyncSession,
    *,
    reseller_id: int,
    node_ids: list[int],
) -> dict[int, NodeAllocation]:
    if not node_ids:
        return {}
    q = await db.execute(
        select(NodeAllocation).where(
            NodeAllocation.reseller_id == reseller_id,
            NodeAllocation.node_id.in_(list(set(int(x) for x in node_ids))),
            NodeAllocation.enabled.is_(True),
        )
    )
    return {int(a.node_id): a for a in q.scalars().all()}


async def get_allocation_for_reseller_node(
    db: AsyncSession,
    *,
    reseller_id: int,
    node_id: int,
    enabled_only: bool = True,
) -> NodeAllocation | None:
    stmt = select(NodeAllocation).where(
        NodeAllocation.reseller_id == reseller_id,
        NodeAllocation.node_id == node_id,
    )
    if enabled_only:
        stmt = stmt.where(NodeAllocation.enabled.is_(True))
    q = await db.execute(stmt)
    return q.scalar_one_or_none()


async def get_adapter_for_subaccount(
    db: AsyncSession,
    subaccount: SubAccount,
    node: Node,
    user: GuardinoUser | None = None,
):
    allocation: NodeAllocation | None = None
    if subaccount.allocation_id:
        q = await db.execute(select(NodeAllocation).where(NodeAllocation.id == subaccount.allocation_id))
        allocation = q.scalar_one_or_none()
    elif user is not None:
        allocation = await get_allocation_for_reseller_node(
            db,
            reseller_id=int(user.owner_reseller_id),
            node_id=int(subaccount.node_id),
            enabled_only=False,
        )
    else:
        q = await db.execute(select(GuardinoUser.owner_reseller_id).where(GuardinoUser.id == subaccount.user_id))
        reseller_id = q.scalar_one_or_none()
        if reseller_id is not None:
            allocation = await get_allocation_for_reseller_node(
                db,
                reseller_id=int(reseller_id),
                node_id=int(subaccount.node_id),
                enabled_only=False,
            )
    return get_adapter_for_allocation(node, allocation)
