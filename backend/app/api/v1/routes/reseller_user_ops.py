from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from datetime import datetime, timedelta, timezone
import secrets

from app.core.db import get_db
from app.api.deps import block_if_balance_zero
from app.models.reseller import Reseller
from app.models.user import GuardinoUser, NodeSelectionMode
from app.models.subaccount import SubAccount
from app.models.order import Order, OrderType, OrderStatus
from app.models.ledger import LedgerTransaction
from app.services.billing import lock_reseller_for_billing
from app.services.pricing import resolve_allowed_nodes, calculate_price
from app.services.adapters.factory import get_adapter
from app.services.idempotency import find_order_by_request_id, request_id_from
from app.services.user_inputs import resolve_days, sanitize_username, random_username
from app.schemas.reseller_user_ops import CreateUserRequest, CreateUserResponse, PriceQuoteResponse
from urllib.parse import urlparse
from app.services.reseller_user_policy import (
    get_effective_user_policy,
)

router = APIRouter()


async def _create_response_for_order(
    db: AsyncSession,
    request: Request,
    reseller: Reseller,
    order: Order,
    request_id: str | None,
) -> CreateUserResponse:
    try:
        order_type = order.type if isinstance(order.type, OrderType) else OrderType(order.type)
    except Exception:
        order_type = order.type
    if order_type != OrderType.create:
        raise HTTPException(status_code=409, detail="request_id was already used for another operation.")
    if order.status != OrderStatus.completed or not order.user_id:
        raise HTTPException(status_code=409, detail="request_id is already in progress; retry shortly.")

    q_user = await db.execute(select(GuardinoUser).where(GuardinoUser.id == order.user_id))
    user = q_user.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=409, detail="request_id points to a missing user.")

    q_subs = await db.execute(select(SubAccount.node_id).where(SubAccount.user_id == user.id))
    nodes_provisioned = [int(node_id) for node_id in q_subs.scalars().all()]
    q_ledger = await db.execute(select(LedgerTransaction).where(LedgerTransaction.order_id == order.id))
    ledger_rows = q_ledger.scalars().all()
    charged_amount = sum(max(0, -int(tx.amount or 0)) for tx in ledger_rows)
    balance_after = int(ledger_rows[-1].balance_after) if ledger_rows else int(reseller.balance or 0)

    subscription_url = str(request.base_url).rstrip("/") + f"/api/v1/sub/{user.master_sub_token}"
    return CreateUserResponse(
        user_id=user.id,
        label=user.label,
        order_id=order.id,
        request_id=request_id,
        master_sub_token=user.master_sub_token,
        subscription_url=subscription_url,
        expire_at=user.expire_at,
        charged_amount=charged_amount,
        balance_after=balance_after,
        nodes_provisioned=nodes_provisioned,
    )

def _panel_username(base_label: str) -> str:
    # Keep panel username as close as possible to user input/random value.
    # No node-id/random suffix is appended.
    safe = sanitize_username(base_label)
    return safe or random_username("u")


def _canonical_username_from_payload(payload: CreateUserRequest) -> str:
    if payload.randomize_username:
        return random_username("u")
    candidate = sanitize_username(payload.username or payload.label)
    if not candidate:
        raise HTTPException(status_code=400, detail="Username is required unless random is enabled.")
    return candidate


def _normalize_url(direct: str | None, base_url: str | None) -> str | None:
    if not direct:
        return None
    u = direct.strip()
    if not u:
        return None
    if u.startswith("http://") or u.startswith("https://"):
        return u
    if not base_url:
        return u
    b = base_url.strip()
    if not b:
        return u
    try:
        p = urlparse(b)
        if p.scheme and p.netloc:
            origin = f"{p.scheme}://{p.netloc}"
        else:
            origin = b
    except Exception:
        origin = b
    if not u.startswith("/"):
        u = "/" + u
    return origin.rstrip("/") + u


def _enforce_user_policy(payload: CreateUserRequest, policy: dict) -> int:
    days_final = resolve_days(payload.days, payload.duration_preset)
    if not bool(policy.get("enabled")):
        return days_final

    allow_custom_days = bool(policy.get("allow_custom_days", True))
    allow_custom_traffic = bool(policy.get("allow_custom_traffic", True))
    allow_no_expire = bool(policy.get("allow_no_expire", False))

    allowed_presets = [str(x) for x in (policy.get("allowed_duration_presets") or [])]
    allowed_traffic = {int(x) for x in (policy.get("allowed_traffic_gb") or []) if str(x).isdigit()}
    min_days = int(policy.get("min_days", 1) or 1)
    max_days = int(policy.get("max_days", 3650) or 3650)

    if payload.duration_preset:
        if payload.duration_preset not in allowed_presets:
            raise HTTPException(status_code=400, detail="این پکیج زمانی برای حساب شما مجاز نیست.")
    else:
        if not allow_custom_days:
            raise HTTPException(status_code=400, detail="انتخاب دستی روز مجاز نیست. از پکیج‌های زمانی مجاز استفاده کنید.")

    if days_final == 0:
        if not allow_no_expire:
            raise HTTPException(status_code=400, detail="مدت زمان نامحدود برای حساب شما مجاز نیست.")
    else:
        if days_final < min_days or days_final > max_days:
            raise HTTPException(status_code=400, detail=f"مدت زمان مجاز بین {min_days} تا {max_days} روز است.")

    if not allow_custom_traffic and allowed_traffic and int(payload.total_gb) not in allowed_traffic:
        raise HTTPException(status_code=400, detail="این حجم برای حساب شما مجاز نیست.")

    return days_final

@router.post("/quote", response_model=PriceQuoteResponse)
async def quote(payload: CreateUserRequest, db: AsyncSession = Depends(get_db), reseller: Reseller = Depends(block_if_balance_zero)):
    policy = await get_effective_user_policy(db, reseller.id)
    days_final = _enforce_user_policy(payload, policy)
    nodes = await resolve_allowed_nodes(db, reseller.id, payload.node_ids, payload.node_group)
    if not nodes:
        raise HTTPException(status_code=400, detail="No eligible nodes for this reseller/selection")
    _canonical_username_from_payload(payload)
    total, per_node, time_amount = await calculate_price(db, reseller, nodes, payload.total_gb, days_final, pricing_mode=payload.pricing_mode)
    return PriceQuoteResponse(total_amount=total, per_node_amount=per_node, time_amount=time_amount)

@router.post("", response_model=CreateUserResponse)
async def create_user(
    payload: CreateUserRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    reseller: Reseller = Depends(block_if_balance_zero),
):
    request_id = request_id_from(request, payload)
    if request_id:
        existing_order = await find_order_by_request_id(db, reseller_id=reseller.id, request_id=request_id)
        if existing_order:
            return await _create_response_for_order(db, request, reseller, existing_order, request_id)
    reseller = await lock_reseller_for_billing(db, reseller)

    policy = await get_effective_user_policy(db, reseller.id)
    days_final = _enforce_user_policy(payload, policy)
    nodes = await resolve_allowed_nodes(db, reseller.id, payload.node_ids, payload.node_group)
    if not nodes:
        raise HTTPException(status_code=400, detail="No eligible nodes for this reseller/selection")
    remote_label = _canonical_username_from_payload(payload)

    estimated_amount, per_node, time_amount = await calculate_price(db, reseller, nodes, payload.total_gb, days_final, pricing_mode=payload.pricing_mode)

    if reseller.balance < estimated_amount:
        raise HTTPException(status_code=400, detail="Insufficient balance")

    order = Order(
        reseller_id=reseller.id,
        user_id=None,
        type=OrderType.create,
        status=OrderStatus.pending,
        purchased_gb=payload.total_gb,
        price_per_gb_snapshot=reseller.price_per_gb,
        client_request_id=request_id,
    )
    db.add(order)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        if request_id:
            existing_order = await find_order_by_request_id(db, reseller_id=reseller.id, request_id=request_id)
            if existing_order:
                return await _create_response_for_order(db, request, reseller, existing_order, request_id)
        raise HTTPException(status_code=409, detail="request_id is already in use.")

    now = datetime.now(timezone.utc)
    # For "unlimited" we keep a long local expiry timestamp for internal sorting/filters.
    expire_at = now + timedelta(days=36500 if int(days_final) == 0 else int(days_final))
    token = secrets.token_hex(16)

    create_status = "on_hold" if str(payload.create_status or "").strip().lower() == "on_hold" else "active"

    user = GuardinoUser(
        owner_reseller_id=reseller.id,
        label=remote_label,
        total_gb=payload.total_gb,
        used_bytes=0,
        expire_at=expire_at,
        master_sub_token=token,
        node_selection_mode=NodeSelectionMode.group if payload.node_group else NodeSelectionMode.manual,
        node_group=payload.node_group,
        meta={
            "requested_node_ids": payload.node_ids,
            "requested_node_group": payload.node_group,
            "remote_label": remote_label,
            "create_status": create_status,
            "no_expire": bool(int(days_final) == 0),
            "request_id": request_id,
        },
    )
    db.add(user)
    await db.flush()

    provisioned: list[int] = []
    provisioned_nodes = []
    provision_errors: list[str] = []
    try:
        for n in nodes:
            try:
                adapter = get_adapter(n)
                panel_username = _panel_username(remote_label)
                pr = await adapter.provision_user(
                    label=panel_username,
                    total_gb=payload.total_gb,
                    expire_at=expire_at,
                    status=create_status,
                )
            except Exception as e:
                provision_errors.append(f"node#{n.id}: {str(e).strip()[:160]}")
                continue
            direct_url = _normalize_url(pr.direct_sub_url, n.base_url)
            sa = SubAccount(
                user_id=user.id,
                node_id=n.id,
                remote_identifier=pr.remote_identifier,
                panel_sub_url_cached=direct_url,
                panel_sub_url_cached_at=now if direct_url else None,
                used_bytes=0,
                last_sync_at=None,
            )
            db.add(sa)
            provisioned.append(n.id)
            provisioned_nodes.append(n)

        if not provisioned_nodes:
            raise HTTPException(status_code=502, detail="Provision failed on all selected nodes")

        total_amount, per_node, time_amount = await calculate_price(
            db,
            reseller,
            provisioned_nodes,
            payload.total_gb,
            days_final,
            pricing_mode=payload.pricing_mode,
        )
        if reseller.balance < total_amount:
            raise HTTPException(status_code=400, detail="Insufficient balance")

        if provision_errors:
            user.meta = {**(user.meta or {}), "provision_errors": provision_errors}

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
        subscription_url = str(request.base_url).rstrip("/") + f"/api/v1/sub/{user.master_sub_token}"
        return CreateUserResponse(
            user_id=user.id,
            label=user.label,
            order_id=order.id,
            request_id=request_id,
            master_sub_token=user.master_sub_token,
            subscription_url=subscription_url,
            expire_at=user.expire_at,
            charged_amount=total_amount,
            balance_after=reseller.balance,
            nodes_provisioned=provisioned,
        )
    except Exception:
        await db.rollback()
        raise
