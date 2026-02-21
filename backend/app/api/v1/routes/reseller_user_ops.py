from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime, timedelta, timezone
import secrets

from app.core.db import get_db
from app.api.deps import block_if_balance_zero
from app.models.reseller import Reseller
from app.models.user import GuardinoUser, NodeSelectionMode
from app.models.subaccount import SubAccount
from app.models.order import Order, OrderType, OrderStatus
from app.models.ledger import LedgerTransaction
from app.services.pricing import resolve_allowed_nodes, calculate_price
from app.services.adapters.factory import get_adapter
from app.schemas.reseller_user_ops import CreateUserRequest, CreateUserResponse, PriceQuoteResponse

router = APIRouter()

@router.post("/quote", response_model=PriceQuoteResponse)
async def quote(payload: CreateUserRequest, db: AsyncSession = Depends(get_db), reseller: Reseller = Depends(block_if_balance_zero)):
    nodes = await resolve_allowed_nodes(db, reseller.id, payload.node_ids, payload.node_group)
    if not nodes:
        raise HTTPException(status_code=400, detail="No eligible nodes for this reseller/selection")
    total, per_node, time_amount = await calculate_price(db, reseller, nodes, payload.total_gb, payload.days)
    return PriceQuoteResponse(total_amount=total, per_node_amount=per_node, time_amount=time_amount)

@router.post("", response_model=CreateUserResponse)
async def create_user(payload: CreateUserRequest, db: AsyncSession = Depends(get_db), reseller: Reseller = Depends(block_if_balance_zero)):
    nodes = await resolve_allowed_nodes(db, reseller.id, payload.node_ids, payload.node_group)
    if not nodes:
        raise HTTPException(status_code=400, detail="No eligible nodes for this reseller/selection")

    total_amount, per_node, time_amount = await calculate_price(db, reseller, nodes, payload.total_gb, payload.days)

    # Must have enough balance; balance must never go negative
    if reseller.balance < total_amount:
        raise HTTPException(status_code=400, detail="Insufficient balance")

    # Create order (pending)
    order = Order(
        reseller_id=reseller.id,
        user_id=None,
        type=OrderType.create,
        status=OrderStatus.pending,
        purchased_gb=payload.total_gb,
        price_per_gb_snapshot=reseller.price_per_gb,
    )
    db.add(order)
    await db.flush()

    now = datetime.now(timezone.utc)
    expire_at = now + timedelta(days=int(payload.days))
    token = secrets.token_hex(16)

    user = GuardinoUser(
        owner_reseller_id=reseller.id,
        label=payload.label,
        total_gb=payload.total_gb,
        used_bytes=0,
        expire_at=expire_at,
        master_sub_token=token,
        node_selection_mode=NodeSelectionMode.group if payload.node_group else NodeSelectionMode.manual,
        node_group=payload.node_group,
        metadata={"requested_node_ids": payload.node_ids, "requested_node_group": payload.node_group},
    )
    db.add(user)
    await db.flush()

    # Provision on each node (mock-only for now in adapters)
    provisioned = []
    try:
        for n in nodes:
            adapter = get_adapter(n)
            pr = await adapter.provision_user(label=payload.label, total_gb=payload.total_gb, expire_at=expire_at)
            sa = SubAccount(
                user_id=user.id,
                node_id=n.id,
                remote_identifier=pr.remote_identifier,
                panel_sub_url_cached=pr.direct_sub_url,
                panel_sub_url_cached_at=now if pr.direct_sub_url else None,
                used_bytes=0,
                last_sync_at=None,
            )
            db.add(sa)
            provisioned.append(n.id)

        # Deduct balance & ledger
        reseller.balance -= total_amount
        ledger = LedgerTransaction(
            reseller_id=reseller.id,
            order_id=order.id,
            amount=-total_amount,
            reason="user_create",
            balance_after=reseller.balance,
            occurred_at=now,
        )
        db.add(ledger)

        order.user_id = user.id
        order.status = OrderStatus.completed

        await db.commit()
        return CreateUserResponse(user_id=user.id, master_sub_token=user.master_sub_token, charged_amount=total_amount, nodes_provisioned=provisioned)
    except Exception as e:
        # Rollback DB changes (no remote rollback yet; will implement later when real provisioning is in place)
        await db.rollback()
        raise
