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
from app.services.status_policy import enable_if_needed
from urllib.parse import urlparse, parse_qs
from app.services.http_client import build_async_client
from app.schemas.ops import ExtendRequest, AddTrafficRequest, ChangeNodesRequest, RefundRequest, SetStatusRequest, OpResult

router = APIRouter()

def _now():
    return datetime.now(timezone.utc)


def _short_err(e: Exception, size: int = 140) -> str:
    return str(e).strip().replace("\n", " ")[:size]

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
                adapter = get_adapter(n)
                await adapter.delete_user(sa.remote_identifier)
            except Exception as e:
                errors.append(f"node#{sa.node_id}: {_short_err(e)}")
        await db.delete(sa)
        deleted_local += 1
    return deleted_local, errors

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

    # Update remote panels (best-effort)
    qs_sub = await db.execute(select(SubAccount).where(SubAccount.user_id == user.id))
    subs = qs_sub.scalars().all()
    if subs:
        qn = await db.execute(select(Node).where(Node.id.in_([s.node_id for s in subs])))
        node_map = {n.id: n for n in qn.scalars().all()}
        for s in subs:
            n = node_map.get(s.node_id)
            if not n:
                continue
            try:
                adapter = get_adapter(n)
                await adapter.update_user_limits(s.remote_identifier, total_gb=int(user.total_gb), expire_at=user.expire_at)
            except Exception:
                # best-effort
                pass
            try:
                adapter = get_adapter(n)
                await enable_if_needed(n.panel_type, adapter, s.remote_identifier)
            except Exception:
                pass

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

    # Update remote panels (best-effort)
    qn2 = await db.execute(select(Node).where(Node.id.in_([s.node_id for s in subs])))
    node_map2 = {n.id: n for n in qn2.scalars().all()}
    for s in subs:
        n = node_map2.get(s.node_id)
        if not n:
            continue
        try:
            adapter = get_adapter(n)
            await adapter.update_user_limits(s.remote_identifier, total_gb=int(user.total_gb), expire_at=user.expire_at)
            try:
                await enable_if_needed(n.panel_type, adapter, s.remote_identifier)
            except Exception:
                pass
            # WGDashboard: also update share link ExpireDate if we have ShareID in cached url
            try:
                if s.panel_sub_url_cached and "sharePeer/get" in s.panel_sub_url_cached and "ShareID=" in s.panel_sub_url_cached:
                    qs = parse_qs(urlparse(s.panel_sub_url_cached).query)
                    sid = (qs.get("ShareID") or [None])[0]
                    if sid and getattr(n, 'panel_type', None) and n.panel_type.value == 'wg_dashboard':
                        async with build_async_client() as client:
                            await client.post(f"{n.base_url.rstrip('/')}/api/sharePeer/update", headers={"wg-dashboard-apikey": n.credentials.get("apikey","")}, json={"ShareID": sid, "ExpireDate": user.expire_at.strftime('%Y-%m-%d %H:%M:%S')})
            except Exception:
                pass
        except Exception:
            pass

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
                if n:
                    try:
                        adapter = get_adapter(n)
                        await adapter.delete_user(sa.remote_identifier)
                    except Exception as e:
                        remove_errors.append(f"node#{sa.node_id}: {_short_err(e)}")
                await db.delete(sa)
                removed_count += 1

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
                direct_url = _normalize_url(pr.direct_sub_url, n.base_url)
                db.add(
                    SubAccount(
                        user_id=user.id,
                        node_id=n.id,
                        remote_identifier=pr.remote_identifier,
                        panel_sub_url_cached=direct_url,
                        panel_sub_url_cached_at=now if direct_url else None,
                        used_bytes=0,
                    )
                )

            reseller.balance -= total_amount
            charged = total_amount
            db.add(LedgerTransaction(reseller_id=reseller.id, order_id=order.id, amount=-total_amount, reason="change_nodes_add", balance_after=reseller.balance, occurred_at=now))
            order.status = OrderStatus.completed

    await db.commit()
    detail = None
    if removed_count or remove_errors:
        detail = f"removed_nodes={removed_count}; remote_delete_errors={len(remove_errors)}"
    return OpResult(ok=True, charged_amount=charged, refunded_amount=0, new_balance=reseller.balance, user_id=user.id, detail=detail)

@router.post("/{user_id}/refund", response_model=OpResult)
async def refund_or_delete(user_id: int, payload: RefundRequest, db: AsyncSession = Depends(get_db), reseller: Reseller = Depends(block_if_balance_zero)):
    q = await db.execute(select(GuardinoUser).where(GuardinoUser.id == user_id, GuardinoUser.owner_reseller_id == reseller.id))
    user = q.scalar_one_or_none()
    if not user or user.status != UserStatus.active:
        raise HTTPException(status_code=404, detail="User not found/active")

    # Determine refundable GB under policy (10 days, remaining GB)
    refundable = refundable_gb_for_user(user)
    if payload.action == "delete":
        # Delete is always allowed; refund is optional and policy-based.
        refund_gb = max(0, int(refundable))
    else:
        if refundable <= 0:
            raise HTTPException(status_code=400, detail="Refund window expired or no remaining volume")
        if payload.decrease_gb is None:
            raise HTTPException(status_code=400, detail="decrease_gb is required for decrease")
        refund_gb = min(int(payload.decrease_gb), int(refundable))
        if refund_gb <= 0:
            raise HTTPException(status_code=400, detail="Nothing to refund")

    # Find the create order snapshot price (fallback to reseller current price)
    q1 = await db.execute(select(Order).where(Order.user_id == user.id, Order.type == OrderType.create).order_by(Order.id.asc()))
    create_order = q1.scalars().first()
    price_per_gb = int(create_order.price_per_gb_snapshot) if create_order and create_order.price_per_gb_snapshot is not None else int(reseller.price_per_gb)

    refund_amount = int(refund_gb) * int(price_per_gb)

    order_type = OrderType.delete if payload.action == "delete" else OrderType.refund
    order = Order(
        reseller_id=reseller.id,
        user_id=user.id,
        type=order_type,
        status=OrderStatus.pending,
        purchased_gb=refund_gb if refund_gb > 0 else None,
        price_per_gb_snapshot=price_per_gb,
    )
    db.add(order)
    await db.flush()

    # Apply to user
    user.total_gb = max(0, int(user.total_gb) - int(refund_gb))

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
        if remote_delete_errors:
            sample = " | ".join(remote_delete_errors[:3])
            raise HTTPException(
                status_code=502,
                detail=f"Delete sync failed on {len(remote_delete_errors)} node(s): {sample}",
            )
        user.status = UserStatus.deleted
        user.used_bytes = 0
    else:
        # For partial refund, keep user and sync reduced limits to remote panels.
        for sa in subs:
            n = node_map.get(sa.node_id)
            if not n:
                continue
            try:
                adapter = get_adapter(n)
                await adapter.update_user_limits(sa.remote_identifier, total_gb=int(user.total_gb), expire_at=user.expire_at)
            except Exception as e:
                remote_limit_errors.append(f"node#{sa.node_id}: {_short_err(e)}")

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
    if remote_delete_errors:
        detail_parts.append(f"remote_delete_errors={len(remote_delete_errors)}")
    if remote_limit_errors:
        detail_parts.append(f"remote_limit_errors={len(remote_limit_errors)}")
    return OpResult(
        ok=True,
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
    if subs:
        qn = await db.execute(select(Node).where(Node.id.in_([s.node_id for s in subs])))
        node_map = {n.id: n for n in qn.scalars().all()}
        for s in subs:
            n = node_map.get(s.node_id)
            if not n:
                continue
            try:
                adapter = get_adapter(n)
                if new_status == UserStatus.active:
                    await adapter.enable_user(s.remote_identifier)
                else:
                    await adapter.disable_user(s.remote_identifier)
            except Exception:
                pass

    await db.commit()
    return OpResult(ok=True, charged_amount=0, refunded_amount=0, new_balance=reseller.balance, user_id=user.id)


@router.post("/{user_id}/reset-usage", response_model=OpResult)
async def reset_user_usage(user_id: int, db: AsyncSession = Depends(get_db), reseller: Reseller = Depends(block_if_balance_zero)):
    q = await db.execute(select(GuardinoUser).where(GuardinoUser.id == user_id, GuardinoUser.owner_reseller_id == reseller.id))
    user = q.scalar_one_or_none()
    if not user or user.status == UserStatus.deleted:
        raise HTTPException(status_code=404, detail="User not found")

    qs_sub = await db.execute(select(SubAccount).where(SubAccount.user_id == user.id))
    subs = qs_sub.scalars().all()
    if subs:
        qn = await db.execute(select(Node).where(Node.id.in_([s.node_id for s in subs])))
        node_map = {n.id: n for n in qn.scalars().all()}
        for s in subs:
            n = node_map.get(s.node_id)
            if not n:
                continue
            try:
                adapter = get_adapter(n)
                await adapter.reset_usage(s.remote_identifier)
            except Exception:
                pass
            s.used_bytes = 0

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

    # Best-effort across nodes. For WGDashboard: delete & recreate (link changes).
    for s in subs:
        n = node_map.get(s.node_id)
        if not n:
            continue
        try:
            adapter = get_adapter(n)
            pr = await adapter.revoke_subscription(label=user.label, remote_identifier=s.remote_identifier, total_gb=int(user.total_gb), expire_at=user.expire_at)
            # WGDashboard may return a NEW identifier.
            s.remote_identifier = pr.remote_identifier
            if pr.direct_sub_url:
                s.panel_sub_url_cached = _normalize_url(pr.direct_sub_url, n.base_url) or pr.direct_sub_url
                s.panel_sub_url_cached_at = now
        except Exception:
            pass

    await db.commit()
    return OpResult(ok=True, charged_amount=0, refunded_amount=0, new_balance=reseller.balance, user_id=user.id)
