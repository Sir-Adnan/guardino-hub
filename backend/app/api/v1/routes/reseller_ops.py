from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime, timedelta, timezone

from app.core.db import get_db
from app.api.deps import block_if_balance_zero
from app.models.reseller import Reseller
from app.models.user import GuardinoUser, UserStatus, NodeSelectionMode
from app.models.subaccount import SubAccount
from app.models.node import Node
from app.models.node_allocation import NodeAllocation
from app.models.order import Order, OrderType, OrderStatus
from app.models.ledger import LedgerTransaction
from app.services.pricing import calculate_price, resolve_allowed_nodes
from app.services.adapters.factory import get_adapter
from app.services.refund import refundable_gb_for_user
from app.schemas.ops import ExtendRequest, AddTrafficRequest, ChangeNodesRequest, RefundRequest, OpResult

router = APIRouter()

def _now():
    return datetime.now(timezone.utc)

@router.post("/{user_id}/extend", response_model=OpResult)
async def extend_user(user_id: int, payload: ExtendRequest, db: AsyncSession = Depends(get_db), reseller: Reseller = Depends(block_if_balance_zero)):
    q = await db.execute(select(GuardinoUser).where(GuardinoUser.id == user_id, GuardinoUser.owner_reseller_id == reseller.id))
    user = q.scalar_one_or_none()
    if not user or user.status != UserStatus.active:
        raise HTTPException(status_code=404, detail="User not found/active")

    # price: only time amount (optional)
    time_amount = 0
    if reseller.price_per_day is not None and reseller.price_per_day > 0:
        time_amount = int(reseller.price_per_day) * int(payload.days)

    if reseller.balance < time_amount:
        raise HTTPException(status_code=400, detail="Insufficient balance")

    order = Order(reseller_id=reseller.id, user_id=user.id, type=OrderType.extend, status=OrderStatus.pending, purchased_gb=None, price_per_gb_snapshot=None)
    db.add(order)
    await db.flush()

    user.expire_at = user.expire_at + timedelta(days=int(payload.days))
    now = _now()
    charged = 0
    if time_amount > 0:
        reseller.balance -= time_amount
        charged = time_amount
        db.add(LedgerTransaction(reseller_id=reseller.id, order_id=order.id, amount=-time_amount, reason="extend", balance_after=reseller.balance, occurred_at=now))

    order.status = OrderStatus.completed
    await db.commit()
    return OpResult(ok=True, charged_amount=charged, refunded_amount=0, new_balance=reseller.balance, user_id=user.id)

@router.post("/{user_id}/add-traffic", response_model=OpResult)
async def add_traffic(user_id: int, payload: AddTrafficRequest, db: AsyncSession = Depends(get_db), reseller: Reseller = Depends(block_if_balance_zero)):
    q = await db.execute(select(GuardinoUser).where(GuardinoUser.id == user_id, GuardinoUser.owner_reseller_id == reseller.id))
    user = q.scalar_one_or_none()
    if not user or user.status != UserStatus.active:
        raise HTTPException(status_code=404, detail="User not found/active")

    qs = await db.execute(select(SubAccount).where(SubAccount.user_id == user.id))
    subs = qs.scalars().all()
    if not subs:
        raise HTTPException(status_code=400, detail="No subaccounts")

    node_ids = [sa.node_id for sa in subs]
    qn = await db.execute(select(Node).where(Node.id.in_(node_ids)))
    nodes = qn.scalars().all()

    total_amount, per_node, _time_amount = await calculate_price(db, reseller, nodes, payload.add_gb, days=0)
    if reseller.balance < total_amount:
        raise HTTPException(status_code=400, detail="Insufficient balance")

    order = Order(reseller_id=reseller.id, user_id=user.id, type=OrderType.add_traffic, status=OrderStatus.pending, purchased_gb=payload.add_gb, price_per_gb_snapshot=reseller.price_per_gb)
    db.add(order)
    await db.flush()

    user.total_gb = int(user.total_gb) + int(payload.add_gb)

    now = _now()
    reseller.balance -= total_amount
    db.add(LedgerTransaction(reseller_id=reseller.id, order_id=order.id, amount=-total_amount, reason="add_traffic", balance_after=reseller.balance, occurred_at=now))

    order.status = OrderStatus.completed
    await db.commit()
    return OpResult(ok=True, charged_amount=total_amount, refunded_amount=0, new_balance=reseller.balance, user_id=user.id)

@router.post("/{user_id}/change-nodes", response_model=OpResult)
async def change_nodes(user_id: int, payload: ChangeNodesRequest, db: AsyncSession = Depends(get_db), reseller: Reseller = Depends(block_if_balance_zero)):
    q = await db.execute(select(GuardinoUser).where(GuardinoUser.id == user_id, GuardinoUser.owner_reseller_id == reseller.id))
    user = q.scalar_one_or_none()
    if not user or user.status != UserStatus.active:
        raise HTTPException(status_code=404, detail="User not found/active")

    if user.node_selection_mode != NodeSelectionMode.manual:
        raise HTTPException(status_code=400, detail="change-nodes only allowed for manual mode users")

    add_ids = list(dict.fromkeys(payload.add_node_ids or []))
    remove_ids = list(dict.fromkeys(payload.remove_node_ids or []))

    # Current subaccounts
    qs = await db.execute(select(SubAccount).where(SubAccount.user_id == user.id))
    subs = qs.scalars().all()
    current_ids = {sa.node_id for sa in subs}

    # Remove: just delete subaccount record (soft behavior); does NOT touch remote panels
    if remove_ids:
        for sa in subs:
            if sa.node_id in remove_ids:
                await db.delete(sa)

    charged = 0
    now = _now()

    # Add: must be allowed nodes for reseller
    if add_ids:
        nodes = await resolve_allowed_nodes(db, reseller.id, add_ids, node_group=None)
        nodes = [n for n in nodes if n.id in add_ids and n.id not in current_ids]
        if nodes:
            # Charge per GB for adding this user to new nodes: price_per_gb * user.total_gb for each added node
            total_amount, per_node, _ = await calculate_price(db, reseller, nodes, total_gb=int(user.total_gb), days=0)
            if reseller.balance < total_amount:
                raise HTTPException(status_code=400, detail="Insufficient balance")
            order = Order(reseller_id=reseller.id, user_id=user.id, type=OrderType.change_nodes, status=OrderStatus.pending, purchased_gb=None, price_per_gb_snapshot=reseller.price_per_gb)
            db.add(order)
            await db.flush()

            # Provision on each added node (real adapters)
            for n in nodes:
                adapter = get_adapter(n)
                pr = await adapter.provision_user(label=user.label, total_gb=int(user.total_gb), expire_at=user.expire_at)
                db.add(SubAccount(user_id=user.id, node_id=n.id, remote_identifier=pr.remote_identifier, panel_sub_url_cached=pr.direct_sub_url, panel_sub_url_cached_at=now, used_bytes=0))

            reseller.balance -= total_amount
            charged = total_amount
            db.add(LedgerTransaction(reseller_id=reseller.id, order_id=order.id, amount=-total_amount, reason="change_nodes_add", balance_after=reseller.balance, occurred_at=now))
            order.status = OrderStatus.completed

    await db.commit()
    return OpResult(ok=True, charged_amount=charged, refunded_amount=0, new_balance=reseller.balance, user_id=user.id)

@router.post("/{user_id}/refund", response_model=OpResult)
async def refund_or_delete(user_id: int, payload: RefundRequest, db: AsyncSession = Depends(get_db), reseller: Reseller = Depends(block_if_balance_zero)):
    q = await db.execute(select(GuardinoUser).where(GuardinoUser.id == user_id, GuardinoUser.owner_reseller_id == reseller.id))
    user = q.scalar_one_or_none()
    if not user or user.status != UserStatus.active:
        raise HTTPException(status_code=404, detail="User not found/active")

    # Determine refundable GB under policy (10 days, remaining GB)
    refundable = refundable_gb_for_user(user)
    if refundable <= 0:
        raise HTTPException(status_code=400, detail="Refund window expired or no remaining volume")

    # Determine how many GB to refund
    if payload.action == "delete":
        refund_gb = refundable
    else:
        if payload.decrease_gb is None:
            raise HTTPException(status_code=400, detail="decrease_gb is required for decrease")
        refund_gb = min(int(payload.decrease_gb), refundable)

    if refund_gb <= 0:
        raise HTTPException(status_code=400, detail="Nothing to refund")

    # Find the create order snapshot price (fallback to reseller current price)
    q1 = await db.execute(select(Order).where(Order.user_id == user.id, Order.type == OrderType.create).order_by(Order.id.asc()))
    create_order = q1.scalars().first()
    price_per_gb = int(create_order.price_per_gb_snapshot) if create_order and create_order.price_per_gb_snapshot is not None else int(reseller.price_per_gb)

    refund_amount = refund_gb * price_per_gb

    order = Order(reseller_id=reseller.id, user_id=user.id, type=OrderType.refund, status=OrderStatus.pending, purchased_gb=refund_gb, price_per_gb_snapshot=price_per_gb)
    db.add(order)
    await db.flush()

    # Apply to user
    user.total_gb = int(user.total_gb) - int(refund_gb)
    if payload.action == "delete":
        user.status = UserStatus.deleted

    now = _now()
    reseller.balance += refund_amount
    db.add(LedgerTransaction(reseller_id=reseller.id, order_id=order.id, amount=refund_amount, reason=f"refund_{payload.action}", balance_after=reseller.balance, occurred_at=now))
    order.status = OrderStatus.completed

    await db.commit()
    return OpResult(ok=True, charged_amount=0, refunded_amount=refund_amount, new_balance=reseller.balance, user_id=user.id, detail=f"refunded_gb={refund_gb}")
