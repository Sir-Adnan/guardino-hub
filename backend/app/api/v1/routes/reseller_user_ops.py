from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
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
from app.services.user_inputs import resolve_days, sanitize_username, random_username
from app.schemas.reseller_user_ops import CreateUserRequest, CreateUserResponse, PriceQuoteResponse
from urllib.parse import urlparse
from app.services.reseller_user_policy import (
    get_user_policy_setting,
    reseller_user_policy_key,
)

router = APIRouter()

def _panel_username(base_label: str) -> str:
    # Keep panel username as close as possible to user input/random value.
    # No node-id/random suffix is appended.
    safe = sanitize_username(base_label)
    return safe or random_username("u")


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
    policy = await get_user_policy_setting(db, reseller_user_policy_key(reseller.id))
    days_final = _enforce_user_policy(payload, policy)
    nodes = await resolve_allowed_nodes(db, reseller.id, payload.node_ids, payload.node_group)
    if not nodes:
        raise HTTPException(status_code=400, detail="No eligible nodes for this reseller/selection")
    total, per_node, time_amount = await calculate_price(db, reseller, nodes, payload.total_gb, days_final, pricing_mode=payload.pricing_mode)
    return PriceQuoteResponse(total_amount=total, per_node_amount=per_node, time_amount=time_amount)

@router.post("", response_model=CreateUserResponse)
async def create_user(payload: CreateUserRequest, db: AsyncSession = Depends(get_db), reseller: Reseller = Depends(block_if_balance_zero)):
    policy = await get_user_policy_setting(db, reseller_user_policy_key(reseller.id))
    days_final = _enforce_user_policy(payload, policy)
    nodes = await resolve_allowed_nodes(db, reseller.id, payload.node_ids, payload.node_group)
    if not nodes:
        raise HTTPException(status_code=400, detail="No eligible nodes for this reseller/selection")

    total_amount, per_node, time_amount = await calculate_price(db, reseller, nodes, payload.total_gb, days_final, pricing_mode=payload.pricing_mode)

    if reseller.balance < total_amount:
        raise HTTPException(status_code=400, detail="Insufficient balance")

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
    # For "unlimited" we keep a long local expiry timestamp for internal sorting/filters.
    expire_at = now + timedelta(days=36500 if int(days_final) == 0 else int(days_final))
    token = secrets.token_hex(16)

    # username handling
    effective_username: str | None = None
    if payload.randomize_username:
        effective_username = random_username("u")
    elif payload.username:
        effective_username = sanitize_username(payload.username) or None

    remote_label = effective_username or payload.label

    user = GuardinoUser(
        owner_reseller_id=reseller.id,
        label=payload.label,
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
            "no_expire": bool(int(days_final) == 0),
        },
    )
    db.add(user)
    await db.flush()

    provisioned: list[int] = []
    try:
        for n in nodes:
            adapter = get_adapter(n)
            panel_username = _panel_username(remote_label)
            pr = await adapter.provision_user(label=panel_username, total_gb=payload.total_gb, expire_at=expire_at)
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
    except Exception:
        await db.rollback()
        raise
