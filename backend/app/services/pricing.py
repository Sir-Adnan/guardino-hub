from __future__ import annotations
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.node_allocation import NodeAllocation
from app.models.node import Node
from app.models.reseller import Reseller

async def resolve_allowed_nodes(db: AsyncSession, reseller_id: int, node_ids: list[int] | None, node_group: str | None) -> list[Node]:
    # If node_ids provided -> must be allocated/enabled for reseller
    # If node_group provided -> select reseller allocations where node tags include group
    if not node_ids and not node_group:
        # default nodes for reseller
        q = await db.execute(
            select(Node).join(NodeAllocation, NodeAllocation.node_id == Node.id)
            .where(NodeAllocation.reseller_id == reseller_id, NodeAllocation.enabled == True, NodeAllocation.default_for_reseller == True, Node.is_enabled == True)
        )
        return q.scalars().all()

    if node_ids:
        q = await db.execute(
            select(Node).join(NodeAllocation, NodeAllocation.node_id == Node.id)
            .where(NodeAllocation.reseller_id == reseller_id, NodeAllocation.enabled == True, Node.is_enabled == True, Node.id.in_(node_ids))
        )
        nodes = q.scalars().all()
        return nodes

    # group
    q = await db.execute(
        select(Node).join(NodeAllocation, NodeAllocation.node_id == Node.id)
        .where(NodeAllocation.reseller_id == reseller_id, NodeAllocation.enabled == True, Node.is_enabled == True)
    )
    nodes = [n for n in q.scalars().all() if node_group in (n.tags or [])]
    return nodes

async def calculate_price(db: AsyncSession, reseller: Reseller, nodes: list[Node], total_gb: int, days: int, pricing_mode: str = "per_node") -> tuple[int, dict[int,int], int]:
    per_node_amount: dict[int,int] = {}
    if pricing_mode == "bundle":
        # Central pricing: charge once for all selected panels
        price_per_gb = reseller.bundle_price_per_gb if getattr(reseller, 'bundle_price_per_gb', None) not in (None, 0) else reseller.price_per_gb
        total = int(price_per_gb) * int(total_gb)
        per_node_amount = {n.id: 0 for n in nodes}
        time_amount = 0
        if reseller.price_per_day is not None and reseller.price_per_day > 0:
            time_amount = int(reseller.price_per_day) * int(days)
            total += time_amount
        return total, per_node_amount, time_amount

    total = 0
    for n in nodes:
        q = await db.execute(select(NodeAllocation).where(NodeAllocation.reseller_id == reseller.id, NodeAllocation.node_id == n.id))
        alloc = q.scalar_one()
        price_per_gb = alloc.price_per_gb_override if alloc.price_per_gb_override is not None else reseller.price_per_gb
        amount = int(price_per_gb) * int(total_gb)
        per_node_amount[n.id] = amount
        total += amount

    # time cost (optional): if reseller.price_per_day is None -> 0
    time_amount = 0
    if reseller.price_per_day is not None and reseller.price_per_day > 0:
        time_amount = int(reseller.price_per_day) * int(days)
        total += time_amount

    return total, per_node_amount, time_amount