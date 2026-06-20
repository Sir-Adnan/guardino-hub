from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from datetime import datetime, timedelta, timezone
import math
import secrets

from app.core.db import get_db
from app.api.deps import block_if_balance_zero, require_reseller
from app.models.reseller import Reseller
from app.models.user import GuardinoUser, UserStatus, NodeSelectionMode
from app.models.subaccount import SubAccount
from app.models.node import Node
from app.models.order import Order, OrderType, OrderStatus
from app.models.ledger import LedgerTransaction
from app.services.billing import lock_reseller_for_billing
from app.services.pricing import calculate_price, resolve_allowed_nodes
from app.services.order_replay import existing_op_result
from app.services.panel_access import (
    get_adapter_for_allocation,
    get_adapter_for_subaccount,
    get_enabled_allocation_map,
)
from app.services.refund import BYTES_PER_GB, refundable_gb_for_user
from app.services.reseller_operation_policy import (
    enforce_delete_policy,
    enforce_edit_allowed,
    enforce_policy_days,
    enforce_policy_traffic,
    enforce_renewal_package_policy,
    policy_refund_window_days,
    user_used_gb_float,
)
from app.services.reseller_user_policy import get_effective_user_policy
from app.services.remote_sync import (
    raise_remote_sync_failed,
    raise_remote_sync_failed_with_rollback,
    rollback_limit_changes,
    short_error,
)
from app.services.status_policy import enable_if_needed
from app.services.subscription_tokens import remember_revoked_master_sub_token
from app.services.urls import normalize_url
from urllib.parse import urlparse, parse_qs
from app.services.http_client import build_async_client
from app.schemas.ops import ExtendRequest, DecreaseTimeRequest, AddTrafficRequest, RenewRequest, ChangeNodesRequest, RefundRequest, SetStatusRequest, OpResult

router = APIRouter()

def _now():
    return datetime.now(timezone.utc)


async def _flush_order_or_conflict(db: AsyncSession, request_id: str | None) -> None:
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        if request_id:
            raise HTTPException(status_code=409, detail="request_id is already in use; retry shortly.")
        raise


async def _new_unique_master_sub_token(db: AsyncSession) -> str:
    for _ in range(8):
        candidate = secrets.token_hex(16)
        q = await db.execute(select(GuardinoUser.id).where(GuardinoUser.master_sub_token == candidate))
        if q.scalar_one_or_none() is None:
            return candidate
    return secrets.token_hex(24)


async def _delete_subaccounts_remote_first(
    db: AsyncSession,
    subs: list[SubAccount],
    node_map: dict[int, Node],
) -> tuple[int, list[str]]:
    """Best-effort remote delete for each subaccount, then delete local record."""
    deleted_local = 0
    errors: list[str] = []
    for sa in subs:
        n = node_map.get(sa.node_id)
        if n:
            try:
                adapter = await get_adapter_for_subaccount(db, sa, n)
                await adapter.delete_user(sa.remote_identifier)
            except Exception as e:
                errors.append(f"node#{sa.node_id}: {short_error(e)}")
        await db.delete(sa)
        deleted_local += 1
    return deleted_local, errors

@router.post("/{user_id}/extend", response_model=OpResult)
async def extend_user(user_id: int, payload: ExtendRequest, request: Request, db: AsyncSession = Depends(get_db), reseller: Reseller = Depends(block_if_balance_zero)):
    request_id, replay = await existing_op_result(
        db,
        reseller,
        request,
        payload,
        expected_types={OrderType.extend},
    )
    if replay:
        return replay
    reseller = await lock_reseller_for_billing(db, reseller)

    q = await db.execute(select(GuardinoUser).where(GuardinoUser.id == user_id, GuardinoUser.owner_reseller_id == reseller.id))
    user = q.scalar_one_or_none()
    if not user or user.status != UserStatus.active:
        raise HTTPException(status_code=404, detail="User not found/active")
    policy = await get_effective_user_policy(db, reseller.id)
    enforce_edit_allowed(policy, "Extend")
    enforce_policy_days(policy, payload.days)

    # price: only time amount (optional)
    time_amount = 0
    if reseller.price_per_day is not None and reseller.price_per_day > 0:
        time_amount = int(reseller.price_per_day) * int(payload.days)

    if reseller.balance < time_amount:
        raise HTTPException(status_code=400, detail="Insufficient balance")

    order = Order(reseller_id=reseller.id, user_id=user.id, type=OrderType.extend, status=OrderStatus.pending, purchased_gb=None, price_per_gb_snapshot=None, client_request_id=request_id)
    db.add(order)
    await _flush_order_or_conflict(db, request_id)

    old_total_gb = int(user.total_gb)
    old_expire_at = user.expire_at
    user.expire_at = old_expire_at + timedelta(days=int(payload.days))

    # Update remote panels before local financial commit.
    qs_sub = await db.execute(select(SubAccount).where(SubAccount.user_id == user.id))
    subs = qs_sub.scalars().all()
    remote_sync_errors: list[str] = []
    remote_synced_ok: list[tuple[SubAccount, Node]] = []
    if subs:
        qn = await db.execute(select(Node).where(Node.id.in_([s.node_id for s in subs])))
        node_map = {n.id: n for n in qn.scalars().all()}
        for s in subs:
            n = node_map.get(s.node_id)
            if not n:
                remote_sync_errors.append(f"node#{s.node_id}: node not found")
                continue
            adapter = await get_adapter_for_subaccount(db, s, n, user)
            try:
                await adapter.update_user_limits(s.remote_identifier, total_gb=int(user.total_gb), expire_at=user.expire_at)
            except Exception as e:
                remote_sync_errors.append(f"node#{s.node_id}: {short_error(e)}")
                continue
            remote_synced_ok.append((s, n))
            try:
                await enable_if_needed(n.panel_type, adapter, s.remote_identifier)
            except Exception as e:
                remote_sync_errors.append(f"node#{s.node_id}: {short_error(e)}")
                continue

            # WGDashboard share links (legacy support) - best-effort
            try:
                if (
                    s.panel_sub_url_cached
                    and "sharePeer/get" in s.panel_sub_url_cached
                    and "ShareID=" in s.panel_sub_url_cached
                    and getattr(n, "panel_type", None)
                    and getattr(n.panel_type, "value", "") == "wg_dashboard"
                ):
                    qs = parse_qs(urlparse(s.panel_sub_url_cached).query)
                    sid = (qs.get("ShareID") or [None])[0]
                    if sid:
                        async with build_async_client() as client:
                            await client.post(
                                f"{n.base_url.rstrip('/')}/api/sharePeer/update",
                                headers={"wg-dashboard-apikey": (n.credentials or {}).get("apikey", "")},
                                json={"ShareID": sid, "ExpireDate": user.expire_at.strftime("%Y-%m-%d %H:%M:%S")},
                            )
            except Exception:
                pass
    if remote_sync_errors:
        rollback_errors = await rollback_limit_changes(remote_synced_ok, total_gb=old_total_gb, expire_at=old_expire_at, db=db)
        raise_remote_sync_failed_with_rollback("Extend", remote_sync_errors, rollback_errors)
    now = _now()
    charged = 0
    if time_amount > 0:
        reseller.balance -= time_amount
        charged = time_amount
        db.add(LedgerTransaction(reseller_id=reseller.id, order_id=order.id, amount=-time_amount, reason="extend", balance_after=reseller.balance, occurred_at=now))

    order.status = OrderStatus.completed
    await db.commit()
    return OpResult(ok=True, order_id=order.id, request_id=request_id, charged_amount=charged, refunded_amount=0, new_balance=reseller.balance, user_id=user.id)


@router.post("/{user_id}/renew", response_model=OpResult)
async def renew_user(user_id: int, payload: RenewRequest, request: Request, db: AsyncSession = Depends(get_db), reseller: Reseller = Depends(block_if_balance_zero)):
    request_id, replay = await existing_op_result(
        db,
        reseller,
        request,
        payload,
        expected_types={OrderType.extend},
    )
    if replay:
        return replay
    reseller = await lock_reseller_for_billing(db, reseller)

    q = await db.execute(select(GuardinoUser).where(GuardinoUser.id == user_id, GuardinoUser.owner_reseller_id == reseller.id))
    user = q.scalar_one_or_none()
    if not user or user.status == UserStatus.deleted:
        raise HTTPException(status_code=404, detail="User not found")

    policy = await get_effective_user_policy(db, reseller.id)
    enforce_policy_days(policy, payload.days)
    enforce_policy_traffic(policy, payload.total_gb)
    enforce_renewal_package_policy(policy, payload.days, payload.total_gb)

    qs = await db.execute(select(SubAccount).where(SubAccount.user_id == user.id))
    subs = qs.scalars().all()
    if not subs:
        raise HTTPException(status_code=400, detail="No subaccounts")

    node_ids = [s.node_id for s in subs]
    qn = await db.execute(select(Node).where(Node.id.in_(node_ids)))
    nodes = qn.scalars().all()
    node_map = {n.id: n for n in nodes}

    total_amount, _per_node, _time_amount = await calculate_price(
        db,
        reseller,
        nodes,
        total_gb=int(payload.total_gb),
        days=int(payload.days),
        pricing_mode=payload.pricing_mode,
    )
    if reseller.balance < total_amount:
        raise HTTPException(status_code=400, detail="Insufficient balance")

    now = _now()
    old_total_gb = int(user.total_gb or 0)
    old_expire_at = user.expire_at
    old_used_bytes = int(user.used_bytes or 0)
    used_gb_float = max(0.0, float(old_used_bytes) / float(BYTES_PER_GB))
    remaining_gb = max(0, int(math.ceil(max(0.0, float(old_total_gb) - used_gb_float))))
    old_expire_for_calc = old_expire_at
    if old_expire_for_calc.tzinfo is None:
        old_expire_for_calc = old_expire_for_calc.replace(tzinfo=timezone.utc)
    remaining_days = max(0, int(math.ceil((old_expire_for_calc - now).total_seconds() / 86400)))
    base_expire = old_expire_for_calc if old_expire_for_calc > now else now

    renewal_policy = str(policy.get("renewal_policy") or "add_time_and_volume")
    reset_usage = renewal_policy in {"reset_time_and_volume", "reset_time_carry_volume", "reset_volume_carry_time"}
    if renewal_policy == "reset_time_and_volume":
        new_expire_at = now + timedelta(days=int(payload.days))
        new_total_gb = int(payload.total_gb)
    elif renewal_policy == "reset_time_carry_volume":
        new_expire_at = now + timedelta(days=int(payload.days))
        new_total_gb = int(payload.total_gb) + remaining_gb
    elif renewal_policy == "reset_volume_carry_time":
        new_expire_at = now + timedelta(days=int(payload.days) + remaining_days)
        new_total_gb = int(payload.total_gb)
    else:
        new_expire_at = base_expire + timedelta(days=int(payload.days))
        new_total_gb = old_total_gb + int(payload.total_gb)

    order = Order(
        reseller_id=reseller.id,
        user_id=user.id,
        type=OrderType.extend,
        status=OrderStatus.pending,
        purchased_gb=int(payload.total_gb),
        price_per_gb_snapshot=reseller.price_per_gb,
        client_request_id=request_id,
    )
    db.add(order)
    await _flush_order_or_conflict(db, request_id)

    remote_sync_errors: list[str] = []
    remote_synced_ok: list[tuple[SubAccount, Node]] = []
    for s in subs:
        n = node_map.get(s.node_id)
        if not n:
            remote_sync_errors.append(f"node#{s.node_id}: node not found")
            continue
        try:
            adapter = await get_adapter_for_subaccount(db, s, n, user)
            await adapter.update_user_limits(s.remote_identifier, total_gb=new_total_gb, expire_at=new_expire_at)
            if reset_usage:
                await adapter.reset_usage(s.remote_identifier)
                s.used_bytes = 0
            await enable_if_needed(n.panel_type, adapter, s.remote_identifier)
        except Exception as e:
            remote_sync_errors.append(f"node#{s.node_id}: {short_error(e)}")
            continue
        remote_synced_ok.append((s, n))

    if remote_sync_errors:
        rollback_errors = await rollback_limit_changes(remote_synced_ok, total_gb=old_total_gb, expire_at=old_expire_at, db=db)
        raise_remote_sync_failed_with_rollback("Renew", remote_sync_errors, rollback_errors)

    user.total_gb = new_total_gb
    user.expire_at = new_expire_at
    user.status = UserStatus.active
    if reset_usage:
        user.used_bytes = 0

    reseller.balance -= total_amount
    db.add(
        LedgerTransaction(
            reseller_id=reseller.id,
            order_id=order.id,
            amount=-total_amount,
            reason=f"renew_{renewal_policy}",
            balance_after=reseller.balance,
            occurred_at=now,
        )
    )
    order.status = OrderStatus.completed
    await db.commit()
    return OpResult(ok=True, order_id=order.id, request_id=request_id, charged_amount=total_amount, refunded_amount=0, new_balance=reseller.balance, user_id=user.id)


@router.post("/{user_id}/decrease-time", response_model=OpResult)
async def decrease_time(user_id: int, payload: DecreaseTimeRequest, request: Request, db: AsyncSession = Depends(get_db), reseller: Reseller = Depends(block_if_balance_zero)):
    request_id, replay = await existing_op_result(
        db,
        reseller,
        request,
        payload,
        expected_types={OrderType.refund},
    )
    if replay:
        return replay
    reseller = await lock_reseller_for_billing(db, reseller)

    q = await db.execute(select(GuardinoUser).where(GuardinoUser.id == user_id, GuardinoUser.owner_reseller_id == reseller.id))
    user = q.scalar_one_or_none()
    if not user or user.status != UserStatus.active:
        raise HTTPException(status_code=404, detail="User not found/active")
    policy = await get_effective_user_policy(db, reseller.id)
    enforce_edit_allowed(policy, "Decrease time")
    enforce_policy_days(policy, payload.days)

    order = Order(
        reseller_id=reseller.id,
        user_id=user.id,
        type=OrderType.refund,
        status=OrderStatus.pending,
        purchased_gb=None,
        price_per_gb_snapshot=None,
        client_request_id=request_id,
    )
    db.add(order)
    await _flush_order_or_conflict(db, request_id)

    old_total_gb = int(user.total_gb)
    old_expire_at = user.expire_at
    user.expire_at = old_expire_at - timedelta(days=int(payload.days))

    # Update remote panels before local financial commit.
    qs_sub = await db.execute(select(SubAccount).where(SubAccount.user_id == user.id))
    subs = qs_sub.scalars().all()
    remote_sync_errors: list[str] = []
    remote_synced_ok: list[tuple[SubAccount, Node]] = []
    if subs:
        qn = await db.execute(select(Node).where(Node.id.in_([s.node_id for s in subs])))
        node_map = {n.id: n for n in qn.scalars().all()}
        for s in subs:
            n = node_map.get(s.node_id)
            if not n:
                remote_sync_errors.append(f"node#{s.node_id}: node not found")
                continue
            adapter = await get_adapter_for_subaccount(db, s, n, user)
            try:
                await adapter.update_user_limits(s.remote_identifier, total_gb=int(user.total_gb), expire_at=user.expire_at)
            except Exception as e:
                remote_sync_errors.append(f"node#{s.node_id}: {short_error(e)}")
                continue
            remote_synced_ok.append((s, n))
            try:
                await enable_if_needed(n.panel_type, adapter, s.remote_identifier)
            except Exception as e:
                remote_sync_errors.append(f"node#{s.node_id}: {short_error(e)}")
                continue

            # WGDashboard share links (legacy support) - best-effort
            try:
                if (
                    s.panel_sub_url_cached
                    and "sharePeer/get" in s.panel_sub_url_cached
                    and "ShareID=" in s.panel_sub_url_cached
                    and getattr(n, "panel_type", None)
                    and getattr(n.panel_type, "value", "") == "wg_dashboard"
                ):
                    qs = parse_qs(urlparse(s.panel_sub_url_cached).query)
                    sid = (qs.get("ShareID") or [None])[0]
                    if sid:
                        async with build_async_client() as client:
                            await client.post(
                                f"{n.base_url.rstrip('/')}/api/sharePeer/update",
                                headers={"wg-dashboard-apikey": (n.credentials or {}).get("apikey", "")},
                                json={"ShareID": sid, "ExpireDate": user.expire_at.strftime("%Y-%m-%d %H:%M:%S")},
                            )
            except Exception:
                pass
    if remote_sync_errors:
        rollback_errors = await rollback_limit_changes(remote_synced_ok, total_gb=old_total_gb, expire_at=old_expire_at, db=db)
        raise_remote_sync_failed_with_rollback("Decrease time", remote_sync_errors, rollback_errors)

    now = _now()
    refund_amount = 0
    if reseller.price_per_day is not None and reseller.price_per_day > 0:
        refund_amount = int(reseller.price_per_day) * int(payload.days)
        reseller.balance += refund_amount
        db.add(
            LedgerTransaction(
                reseller_id=reseller.id,
                order_id=order.id,
                amount=refund_amount,
                reason="refund_decrease_time",
                balance_after=reseller.balance,
                occurred_at=now,
            )
        )

    order.status = OrderStatus.completed
    await db.commit()
    return OpResult(ok=True, order_id=order.id, request_id=request_id, charged_amount=0, refunded_amount=refund_amount, new_balance=reseller.balance, user_id=user.id)


@router.post("/{user_id}/add-traffic", response_model=OpResult)
async def add_traffic(user_id: int, payload: AddTrafficRequest, request: Request, db: AsyncSession = Depends(get_db), reseller: Reseller = Depends(block_if_balance_zero)):
    request_id, replay = await existing_op_result(
        db,
        reseller,
        request,
        payload,
        expected_types={OrderType.add_traffic},
    )
    if replay:
        return replay
    reseller = await lock_reseller_for_billing(db, reseller)

    q = await db.execute(select(GuardinoUser).where(GuardinoUser.id == user_id, GuardinoUser.owner_reseller_id == reseller.id))
    user = q.scalar_one_or_none()
    if not user or user.status != UserStatus.active:
        raise HTTPException(status_code=404, detail="User not found/active")
    policy = await get_effective_user_policy(db, reseller.id)
    enforce_edit_allowed(policy, "Add traffic")
    enforce_policy_traffic(policy, payload.add_gb)

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

    order = Order(reseller_id=reseller.id, user_id=user.id, type=OrderType.add_traffic, status=OrderStatus.pending, purchased_gb=payload.add_gb, price_per_gb_snapshot=reseller.price_per_gb, client_request_id=request_id)
    db.add(order)
    await _flush_order_or_conflict(db, request_id)

    old_total_gb = int(user.total_gb)
    old_expire_at = user.expire_at
    user.total_gb = old_total_gb + int(payload.add_gb)

    # Update remote panels before local financial commit.
    qn2 = await db.execute(select(Node).where(Node.id.in_([s.node_id for s in subs])))
    node_map2 = {n.id: n for n in qn2.scalars().all()}
    remote_sync_errors: list[str] = []
    remote_synced_ok: list[tuple[SubAccount, Node]] = []
    for s in subs:
        n = node_map2.get(s.node_id)
        if not n:
            remote_sync_errors.append(f"node#{s.node_id}: node not found")
            continue
        adapter = await get_adapter_for_subaccount(db, s, n, user)
        try:
            await adapter.update_user_limits(s.remote_identifier, total_gb=int(user.total_gb), expire_at=user.expire_at)
        except Exception as e:
            remote_sync_errors.append(f"node#{s.node_id}: {short_error(e)}")
            continue
        remote_synced_ok.append((s, n))
        try:
            await enable_if_needed(n.panel_type, adapter, s.remote_identifier)
        except Exception as e:
            remote_sync_errors.append(f"node#{s.node_id}: {short_error(e)}")
            continue
        # WGDashboard: also update share link ExpireDate if we have ShareID in cached url
        try:
            if s.panel_sub_url_cached and "sharePeer/get" in s.panel_sub_url_cached and "ShareID=" in s.panel_sub_url_cached:
                qs = parse_qs(urlparse(s.panel_sub_url_cached).query)
                sid = (qs.get("ShareID") or [None])[0]
                if sid and getattr(n, "panel_type", None) and n.panel_type.value == "wg_dashboard":
                    async with build_async_client() as client:
                        await client.post(
                            f"{n.base_url.rstrip('/')}/api/sharePeer/update",
                            headers={"wg-dashboard-apikey": (n.credentials or {}).get("apikey", "")},
                            json={"ShareID": sid, "ExpireDate": user.expire_at.strftime("%Y-%m-%d %H:%M:%S")},
                        )
        except Exception:
            pass

    if remote_sync_errors:
        rollback_errors = await rollback_limit_changes(remote_synced_ok, total_gb=old_total_gb, expire_at=old_expire_at, db=db)
        raise_remote_sync_failed_with_rollback("Add traffic", remote_sync_errors, rollback_errors)

    now = _now()
    reseller.balance -= total_amount
    db.add(LedgerTransaction(reseller_id=reseller.id, order_id=order.id, amount=-total_amount, reason="add_traffic", balance_after=reseller.balance, occurred_at=now))

    order.status = OrderStatus.completed
    await db.commit()
    return OpResult(ok=True, order_id=order.id, request_id=request_id, charged_amount=total_amount, refunded_amount=0, new_balance=reseller.balance, user_id=user.id)

@router.post("/{user_id}/change-nodes", response_model=OpResult)
async def change_nodes(user_id: int, payload: ChangeNodesRequest, request: Request, db: AsyncSession = Depends(get_db), reseller: Reseller = Depends(block_if_balance_zero)):
    request_id, replay = await existing_op_result(
        db,
        reseller,
        request,
        payload,
        expected_types={OrderType.change_nodes},
    )
    if replay:
        return replay
    reseller = await lock_reseller_for_billing(db, reseller)

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

    remove_errors: list[str] = []
    removed_count = 0

    # Remove: delete from remote panel first (best-effort), then local subaccount
    if remove_ids:
        remove_targets = [sa for sa in subs if sa.node_id in remove_ids]
        node_ids_for_remove = [sa.node_id for sa in remove_targets]
        qn_remove = await db.execute(select(Node).where(Node.id.in_(node_ids_for_remove)))
        node_map_remove = {n.id: n for n in qn_remove.scalars().all()}
        for sa in subs:
            if sa.node_id in remove_ids:
                n = node_map_remove.get(sa.node_id)
                if not n:
                    remove_errors.append(f"node#{sa.node_id}: node not found")
                    continue
                try:
                    adapter = await get_adapter_for_subaccount(db, sa, n, user)
                    await adapter.delete_user(sa.remote_identifier)
                except Exception as e:
                    remove_errors.append(f"node#{sa.node_id}: {short_error(e)}")
                    continue
                await db.delete(sa)
                removed_count += 1

    raise_remote_sync_failed("Change nodes (remove)", remove_errors)

    charged = 0
    order_id = None
    now = _now()

    # Add: must be allowed nodes for reseller
    if add_ids:
        nodes = await resolve_allowed_nodes(db, reseller.id, add_ids, node_group=None)
        nodes = [n for n in nodes if n.id in add_ids and n.id not in current_ids]
        if nodes:
            allocation_map = await get_enabled_allocation_map(db, reseller_id=reseller.id, node_ids=[n.id for n in nodes])
            # Charge per GB for adding this user to new nodes: price_per_gb * user.total_gb for each added node
            total_amount, per_node, _ = await calculate_price(db, reseller, nodes, total_gb=int(user.total_gb), days=0)
            if reseller.balance < total_amount:
                raise HTTPException(status_code=400, detail="Insufficient balance")
            order = Order(reseller_id=reseller.id, user_id=user.id, type=OrderType.change_nodes, status=OrderStatus.pending, purchased_gb=None, price_per_gb_snapshot=reseller.price_per_gb, client_request_id=request_id)
            db.add(order)
            await _flush_order_or_conflict(db, request_id)
            order_id = order.id

            # Provision on each added node; if partial failure happens, try best-effort cleanup.
            provisioned_remote: list[tuple[Node, object, str]] = []
            try:
                for n in nodes:
                    allocation = allocation_map.get(n.id)
                    adapter = get_adapter_for_allocation(n, allocation)
                    pr = await adapter.provision_user(label=user.label, total_gb=int(user.total_gb), expire_at=user.expire_at)
                    provisioned_remote.append((n, allocation, pr.remote_identifier))
                    direct_url = normalize_url(pr.direct_sub_url, n.base_url)
                    db.add(
                        SubAccount(
                            user_id=user.id,
                            node_id=n.id,
                            allocation_id=allocation.id if allocation else None,
                            remote_identifier=pr.remote_identifier,
                            panel_sub_url_cached=direct_url,
                            panel_sub_url_cached_at=now if direct_url else None,
                            used_bytes=0,
                        )
                    )
            except Exception as e:
                cleanup_errors: list[str] = []
                for pn, allocation, rid in provisioned_remote:
                    try:
                        cleanup_adapter = get_adapter_for_allocation(pn, allocation)
                        await cleanup_adapter.delete_user(rid)
                    except Exception as ce:
                        cleanup_errors.append(f"node#{pn.id}: {short_error(ce)}")
                detail = f"Change nodes provision failed: {short_error(e)}"
                if cleanup_errors:
                    detail = f"{detail}; cleanup_failures={len(cleanup_errors)}"
                raise HTTPException(status_code=502, detail=detail)

            reseller.balance -= total_amount
            charged = total_amount
            db.add(LedgerTransaction(reseller_id=reseller.id, order_id=order.id, amount=-total_amount, reason="change_nodes_add", balance_after=reseller.balance, occurred_at=now))
            order.status = OrderStatus.completed

    await db.commit()
    detail = None
    if removed_count:
        detail = f"removed_nodes={removed_count}"
    return OpResult(ok=True, order_id=order_id, request_id=request_id, charged_amount=charged, refunded_amount=0, new_balance=reseller.balance, user_id=user.id, detail=detail)

@router.post("/{user_id}/refund", response_model=OpResult)
async def refund_or_delete(user_id: int, payload: RefundRequest, request: Request, db: AsyncSession = Depends(get_db), reseller: Reseller = Depends(require_reseller)):
    expected_type = OrderType.delete if payload.action == "delete" else OrderType.refund
    request_id, replay = await existing_op_result(
        db,
        reseller,
        request,
        payload,
        expected_types={expected_type},
    )
    if replay:
        return replay
    reseller = await lock_reseller_for_billing(db, reseller)

    if reseller.balance <= 0 and payload.action != "delete":
        raise HTTPException(status_code=403, detail="Balance is zero; only delete is allowed from this endpoint.")

    q = await db.execute(select(GuardinoUser).where(GuardinoUser.id == user_id, GuardinoUser.owner_reseller_id == reseller.id))
    user = q.scalar_one_or_none()
    if not user or user.status != UserStatus.active:
        raise HTTPException(status_code=404, detail="User not found/active")
    policy = await get_effective_user_policy(db, reseller.id)

    # Determine refundable GB under policy (window + remaining GB).
    refundable = refundable_gb_for_user(user, window_days=policy_refund_window_days(policy))
    delete_refund_allowed = True
    if payload.action == "delete":
        try:
            enforce_delete_policy(user, policy)
        except HTTPException as exc:
            if exc.status_code == 403:
                raise
            delete_refund_allowed = False
        refund_gb = 0
    else:
        enforce_edit_allowed(policy, "Decrease traffic")
        if refundable <= 0:
            raise HTTPException(status_code=400, detail="Refund window expired or no remaining volume")
        if payload.decrease_gb is None:
            raise HTTPException(status_code=400, detail="decrease_gb is required for decrease")
        enforce_policy_traffic(policy, payload.decrease_gb)
        refund_gb = min(int(payload.decrease_gb), int(refundable))
        if refund_gb <= 0:
            raise HTTPException(status_code=400, detail="Nothing to refund")

    # Find the create order snapshot price (fallback to reseller current price)
    q1 = await db.execute(select(Order).where(Order.user_id == user.id, Order.type == OrderType.create).order_by(Order.id.asc()))
    create_order = q1.scalars().first()
    user_meta = user.meta if isinstance(user.meta, dict) else {}
    if create_order and create_order.price_per_gb_snapshot is not None:
        price_per_gb = int(create_order.price_per_gb_snapshot)
    elif user_meta.get("billing_origin") == "external_import":
        price_per_gb = 0
    else:
        price_per_gb = int(reseller.price_per_gb)

    if payload.action == "delete" and delete_refund_allowed:
        used_float = min(float(user.total_gb or 0), user_used_gb_float(user))
        gross_amount = int(user.total_gb or 0) * int(price_per_gb)
        used_amount = 0 if used_float < 1.0 else int(round(used_float * int(price_per_gb)))
        refund_amount = max(0, gross_amount - used_amount)
        refund_gb = max(0, int(math.floor(refund_amount / int(price_per_gb)))) if int(price_per_gb) > 0 else 0
    elif payload.action == "delete":
        refund_amount = 0
        refund_gb = 0
    else:
        refund_amount = int(refund_gb) * int(price_per_gb)

    order_type = OrderType.delete if payload.action == "delete" else OrderType.refund
    order = Order(
        reseller_id=reseller.id,
        user_id=user.id,
        type=order_type,
        status=OrderStatus.pending,
        purchased_gb=refund_gb if refund_gb > 0 else None,
        price_per_gb_snapshot=price_per_gb,
        client_request_id=request_id,
    )
    db.add(order)
    await _flush_order_or_conflict(db, request_id)

    # Apply to user
    old_total_gb = int(user.total_gb)
    old_expire_at = user.expire_at
    user.total_gb = max(0, old_total_gb - int(refund_gb))

    remote_delete_errors: list[str] = []
    remote_limit_errors: list[str] = []

    qs_sub = await db.execute(select(SubAccount).where(SubAccount.user_id == user.id))
    subs = qs_sub.scalars().all()
    node_ids = [s.node_id for s in subs]
    node_map: dict[int, Node] = {}
    if node_ids:
        qn = await db.execute(select(Node).where(Node.id.in_(node_ids)))
        node_map = {n.id: n for n in qn.scalars().all()}

    if payload.action == "delete":
        _removed, remote_delete_errors = await _delete_subaccounts_remote_first(db, subs, node_map)
        raise_remote_sync_failed("Delete", remote_delete_errors)
        user.status = UserStatus.deleted
    else:
        # For partial refund, keep user and sync reduced limits to remote panels.
        remote_synced_ok: list[tuple[SubAccount, Node]] = []
        for sa in subs:
            n = node_map.get(sa.node_id)
            if not n:
                remote_limit_errors.append(f"node#{sa.node_id}: node not found")
                continue
            try:
                adapter = await get_adapter_for_subaccount(db, sa, n, user)
                await adapter.update_user_limits(sa.remote_identifier, total_gb=int(user.total_gb), expire_at=user.expire_at)
            except Exception as e:
                remote_limit_errors.append(f"node#{sa.node_id}: {short_error(e)}")
                continue
            remote_synced_ok.append((sa, n))
        if remote_limit_errors:
            rollback_errors = await rollback_limit_changes(remote_synced_ok, total_gb=old_total_gb, expire_at=old_expire_at, db=db)
            raise_remote_sync_failed_with_rollback("Refund/decrease", remote_limit_errors, rollback_errors)

    now = _now()
    if refund_amount > 0:
        reseller.balance += refund_amount
        db.add(
            LedgerTransaction(
                reseller_id=reseller.id,
                order_id=order.id,
                amount=refund_amount,
                reason=f"refund_{payload.action}",
                balance_after=reseller.balance,
                occurred_at=now,
            )
        )
    order.status = OrderStatus.completed

    await db.commit()
    detail_parts = [f"refunded_gb={refund_gb}"]
    return OpResult(
        ok=True,
        order_id=order.id,
        request_id=request_id,
        charged_amount=0,
        refunded_amount=refund_amount,
        new_balance=reseller.balance,
        user_id=user.id,
        detail="; ".join(detail_parts),
    )


@router.post("/{user_id}/set-status", response_model=OpResult)
async def set_user_status(user_id: int, payload: SetStatusRequest, db: AsyncSession = Depends(get_db), reseller: Reseller = Depends(block_if_balance_zero)):
    q = await db.execute(select(GuardinoUser).where(GuardinoUser.id == user_id, GuardinoUser.owner_reseller_id == reseller.id))
    user = q.scalar_one_or_none()
    if not user or user.status == UserStatus.deleted:
        raise HTTPException(status_code=404, detail="User not found")

    new_status = UserStatus(payload.status)
    user.status = new_status

    qs_sub = await db.execute(select(SubAccount).where(SubAccount.user_id == user.id))
    subs = qs_sub.scalars().all()
    remote_sync_errors: list[str] = []
    if subs:
        qn = await db.execute(select(Node).where(Node.id.in_([s.node_id for s in subs])))
        node_map = {n.id: n for n in qn.scalars().all()}
        for s in subs:
            n = node_map.get(s.node_id)
            if not n:
                remote_sync_errors.append(f"node#{s.node_id}: node not found")
                continue
            try:
                adapter = await get_adapter_for_subaccount(db, s, n, user)
                if new_status == UserStatus.active:
                    await adapter.enable_user(s.remote_identifier)
                else:
                    await adapter.disable_user(s.remote_identifier)
            except Exception as e:
                remote_sync_errors.append(f"node#{s.node_id}: {short_error(e)}")

    raise_remote_sync_failed("Set status", remote_sync_errors)

    await db.commit()
    return OpResult(ok=True, charged_amount=0, refunded_amount=0, new_balance=reseller.balance, user_id=user.id)


@router.post("/{user_id}/reset-usage", response_model=OpResult)
async def reset_user_usage(user_id: int, db: AsyncSession = Depends(get_db), reseller: Reseller = Depends(block_if_balance_zero)):
    q = await db.execute(select(GuardinoUser).where(GuardinoUser.id == user_id, GuardinoUser.owner_reseller_id == reseller.id))
    user = q.scalar_one_or_none()
    if not user or user.status == UserStatus.deleted:
        raise HTTPException(status_code=404, detail="User not found")
    policy = await get_effective_user_policy(db, reseller.id)
    if not bool(policy.get("allow_reset_usage", True)):
        raise HTTPException(status_code=403, detail="Usage reset is disabled for your account.")

    qs_sub = await db.execute(select(SubAccount).where(SubAccount.user_id == user.id))
    subs = qs_sub.scalars().all()
    remote_sync_errors: list[str] = []
    if subs:
        qn = await db.execute(select(Node).where(Node.id.in_([s.node_id for s in subs])))
        node_map = {n.id: n for n in qn.scalars().all()}
        for s in subs:
            n = node_map.get(s.node_id)
            if not n:
                remote_sync_errors.append(f"node#{s.node_id}: node not found")
                continue
            try:
                adapter = await get_adapter_for_subaccount(db, s, n, user)
                await adapter.reset_usage(s.remote_identifier)
            except Exception as e:
                remote_sync_errors.append(f"node#{s.node_id}: {short_error(e)}")
                continue
            s.used_bytes = 0

    raise_remote_sync_failed("Reset usage", remote_sync_errors)

    user.used_bytes = 0
    await db.commit()
    return OpResult(ok=True, charged_amount=0, refunded_amount=0, new_balance=reseller.balance, user_id=user.id)


@router.post("/{user_id}/revoke", response_model=OpResult)
async def revoke_user_subscription(user_id: int, db: AsyncSession = Depends(get_db), reseller: Reseller = Depends(block_if_balance_zero)):
    q = await db.execute(select(GuardinoUser).where(GuardinoUser.id == user_id, GuardinoUser.owner_reseller_id == reseller.id))
    user = q.scalar_one_or_none()
    if not user or user.status == UserStatus.deleted:
        raise HTTPException(status_code=404, detail="User not found")

    qs_sub = await db.execute(select(SubAccount).where(SubAccount.user_id == user.id))
    subs = qs_sub.scalars().all()
    if not subs:
        raise HTTPException(status_code=400, detail="No subaccounts")

    qn = await db.execute(select(Node).where(Node.id.in_([s.node_id for s in subs])))
    node_map = {n.id: n for n in qn.scalars().all()}
    now = _now()
    remote_sync_errors: list[str] = []

    # Revoke across all nodes and fail if any remote call fails.
    for s in subs:
        n = node_map.get(s.node_id)
        if not n:
            remote_sync_errors.append(f"node#{s.node_id}: node not found")
            continue
        try:
            adapter = await get_adapter_for_subaccount(db, s, n, user)
            pr = await adapter.revoke_subscription(label=user.label, remote_identifier=s.remote_identifier, total_gb=int(user.total_gb), expire_at=user.expire_at)
            # WGDashboard may return a NEW identifier.
            s.remote_identifier = pr.remote_identifier
            if pr.direct_sub_url:
                s.panel_sub_url_cached = normalize_url(pr.direct_sub_url, n.base_url) or pr.direct_sub_url
                s.panel_sub_url_cached_at = now
        except Exception as e:
            remote_sync_errors.append(f"node#{s.node_id}: {short_error(e)}")

    raise_remote_sync_failed("Revoke subscription", remote_sync_errors)

    # Rotate master subscription token as well so old central link is invalidated.
    old_master_sub_token = user.master_sub_token
    user.master_sub_token = await _new_unique_master_sub_token(db)
    await remember_revoked_master_sub_token(db, old_master_sub_token)

    await db.commit()
    return OpResult(ok=True, charged_amount=0, refunded_amount=0, new_balance=reseller.balance, user_id=user.id, detail="master_sub_rotated=1")
