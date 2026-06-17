from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_, case

from app.core.db import get_db
from app.api.deps import require_admin
from app.core.security import hash_password
from app.models.reseller import Reseller, ResellerStatus
from app.models.ledger import LedgerTransaction
from app.models.api_token import ApiToken
from app.schemas.admin import (
    CreateResellerRequest,
    ResellerOut,
    ResellerList,
    CreditRequest,
    AllocationNodeSummary,
    GroupedAllocationItem,
    ResellerAllocationsGroupedList,
    ResellerAllocationsGroup,
    UpdateResellerRequest,
    SetResellerStatusRequest,
)
from app.schemas.api_tokens import ApiTokenCreateRequest, ApiTokenCreated, ApiTokenList
from app.models.node import Node
from app.models.node_allocation import NodeAllocation
from app.schemas.settings import ResellerUserPolicy
from app.services.api_tokens import api_token_to_out, create_api_token
from app.services.reseller_user_policy import (
    delete_user_policy_setting,
    get_user_policy_setting_optional,
    reseller_user_policy_key,
    set_user_policy_setting,
)

router = APIRouter()


def _datetime_in_past(value: datetime | None) -> bool:
    if value is None:
        return False
    now = datetime.now(value.tzinfo) if value.tzinfo else datetime.utcnow()
    return value <= now


def _to_out(r: Reseller, user_policy: dict | None = None) -> ResellerOut:
    return ResellerOut(
        id=r.id,
        parent_id=r.parent_id,
        username=r.username,
        role=(r.role or "reseller"),
        status=r.status.value,
        balance=r.balance,
        price_per_gb=r.price_per_gb,
        bundle_price_per_gb=getattr(r, "bundle_price_per_gb", 0),
        price_per_day=getattr(r, "price_per_day", 0),
        can_create_subreseller=getattr(r, "can_create_subreseller", None),
        user_policy=ResellerUserPolicy(**user_policy) if isinstance(user_policy, dict) else None,
    )


@router.get("", response_model=ResellerList)
async def list_resellers(
    db: AsyncSession = Depends(get_db),
    admin=Depends(require_admin),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=1000),
):
    base = select(Reseller).order_by(Reseller.id.desc())
    total_q = await db.execute(select(func.count()).select_from(base.subquery()))
    total = int(total_q.scalar_one())
    q = await db.execute(base.limit(limit).offset(offset))
    rows = q.scalars().all()
    items: list[ResellerOut] = []
    for r in rows:
        policy = await get_user_policy_setting_optional(db, reseller_user_policy_key(r.id))
        items.append(_to_out(r, policy))
    return ResellerList(items=items, total=total)


@router.get("/allocations/grouped", response_model=ResellerAllocationsGroupedList)
async def list_reseller_allocations_grouped(
    db: AsyncSession = Depends(get_db),
    admin=Depends(require_admin),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=1000),
    q: str | None = Query(default=None, max_length=128),
):
    role_rank = case((Reseller.role == "admin", 0), else_=1)
    base = select(Reseller).where(
        Reseller.role.in_(("admin", "reseller")),
        Reseller.status != ResellerStatus.deleted,
    )
    term = (q or "").strip()
    exact_id = int(term) if term.isdigit() else None
    if term:
        conditions = [Reseller.username.ilike(f"%{term}%")]
        if exact_id is not None:
            conditions.append(Reseller.id == exact_id)
        base = base.where(or_(*conditions))
    if exact_id is not None:
        base = base.order_by((Reseller.id == exact_id).desc(), role_rank, Reseller.id.desc())
    else:
        base = base.order_by(role_rank, Reseller.id.desc())

    total_q = await db.execute(select(func.count()).select_from(base.subquery()))
    total = int(total_q.scalar_one())
    reseller_rows = (await db.execute(base.limit(limit).offset(offset))).scalars().all()
    reseller_ids = [r.id for r in reseller_rows]
    if not reseller_ids:
        return ResellerAllocationsGroupedList(items=[], total=total)

    allocation_rows = (
        await db.execute(
            select(NodeAllocation, Node)
            .join(Node, Node.id == NodeAllocation.node_id)
            .where(NodeAllocation.reseller_id.in_(reseller_ids))
            .order_by(NodeAllocation.reseller_id.asc(), Node.id.asc())
        )
    ).all()

    grouped: dict[int, list[tuple[NodeAllocation, Node]]] = {rid: [] for rid in reseller_ids}
    for allocation, node in allocation_rows:
        grouped.setdefault(allocation.reseller_id, []).append((allocation, node))

    items: list[ResellerAllocationsGroup] = []
    for reseller in reseller_rows:
        rows = grouped.get(reseller.id, [])
        allocations = [
            GroupedAllocationItem(
                id=allocation.id,
                reseller_id=allocation.reseller_id,
                node_id=node.id,
                node_name=node.name,
                panel_type=node.panel_type.value,
                node_is_enabled=node.is_enabled,
                enabled=allocation.enabled,
                default_for_reseller=allocation.default_for_reseller,
                price_per_gb_override=allocation.price_per_gb_override,
            )
            for allocation, node in rows
        ]
        nodes = [
            AllocationNodeSummary(
                id=node.id,
                name=node.name,
                panel_type=node.panel_type.value,
                is_enabled=node.is_enabled,
            )
            for _allocation, node in rows
        ]
        active_panels_count = sum(1 for allocation, node in rows if allocation.enabled and node.is_enabled)
        items.append(
            ResellerAllocationsGroup(
                reseller_id=reseller.id,
                reseller_name=reseller.username,
                reseller_role=(reseller.role or "reseller"),
                reseller_status=reseller.status.value,
                allocations=allocations,
                nodes=nodes,
                active_panels_count=active_panels_count,
            )
        )

    return ResellerAllocationsGroupedList(items=items, total=total)


@router.get("/{reseller_id}", response_model=ResellerOut)
async def get_reseller(reseller_id: int, db: AsyncSession = Depends(get_db), admin=Depends(require_admin)):
    q = await db.execute(select(Reseller).where(Reseller.id == reseller_id))
    r = q.scalar_one_or_none()
    if not r:
        raise HTTPException(status_code=404, detail="Reseller not found")
    policy = await get_user_policy_setting_optional(db, reseller_user_policy_key(r.id))
    return _to_out(r, policy)


@router.get("/{reseller_id}/api-tokens", response_model=ApiTokenList)
async def list_reseller_api_tokens(
    reseller_id: int,
    db: AsyncSession = Depends(get_db),
    admin=Depends(require_admin),
):
    r = (await db.execute(select(Reseller).where(Reseller.id == reseller_id))).scalar_one_or_none()
    if not r:
        raise HTTPException(status_code=404, detail="Reseller not found")
    q = await db.execute(
        select(ApiToken)
        .where(ApiToken.reseller_id == reseller_id)
        .order_by(ApiToken.id.desc())
    )
    items = [api_token_to_out(t) for t in q.scalars().all()]
    return ApiTokenList(items=items, total=len(items))


@router.post("/{reseller_id}/api-tokens", response_model=ApiTokenCreated)
async def create_reseller_api_token(
    reseller_id: int,
    payload: ApiTokenCreateRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin=Depends(require_admin),
):
    if getattr(request.state, "auth_type", "") == "api_token":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="API tokens cannot create new API tokens.")
    r = (await db.execute(select(Reseller).where(Reseller.id == reseller_id))).scalar_one_or_none()
    if not r:
        raise HTTPException(status_code=404, detail="Reseller not found")
    if r.status == ResellerStatus.deleted:
        raise HTTPException(status_code=400, detail="Cannot create API token for a deleted reseller")
    if _datetime_in_past(payload.expires_at):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="expires_at must be in the future.")
    record, raw_token = await create_api_token(
        db,
        reseller=r,
        name=payload.name,
        created_by=admin,
        expires_at=payload.expires_at,
    )
    return ApiTokenCreated(**api_token_to_out(record).model_dump(), token=raw_token)


@router.delete("/{reseller_id}/api-tokens/{token_id}")
async def revoke_reseller_api_token(
    reseller_id: int,
    token_id: int,
    db: AsyncSession = Depends(get_db),
    admin=Depends(require_admin),
):
    q = await db.execute(
        select(ApiToken).where(
            ApiToken.id == token_id,
            ApiToken.reseller_id == reseller_id,
        )
    )
    token = q.scalar_one_or_none()
    if not token:
        raise HTTPException(status_code=404, detail="API token not found")
    token.revoked_at = datetime.now(timezone.utc)
    await db.commit()
    return {"ok": True}

@router.post("", response_model=ResellerOut)
async def create_reseller(payload: CreateResellerRequest, db: AsyncSession = Depends(get_db), admin=Depends(require_admin)):
    q = await db.execute(select(Reseller).where(Reseller.username == payload.username))
    if q.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Username already exists")

    r = Reseller(
        parent_id=payload.parent_id,
        username=payload.username,
        password_hash=hash_password(payload.password),
        status=ResellerStatus.active,
        balance=0,
        price_per_gb=payload.price_per_gb,
        bundle_price_per_gb=payload.bundle_price_per_gb,
        price_per_day=payload.price_per_day,
        can_create_subreseller=payload.can_create_subreseller,
    )
    db.add(r)
    await db.commit()
    await db.refresh(r)
    if payload.user_policy is not None:
        await set_user_policy_setting(db, reseller_user_policy_key(r.id), payload.user_policy.model_dump())

    policy = await get_user_policy_setting_optional(db, reseller_user_policy_key(r.id))
    return _to_out(r, policy)


@router.patch("/{reseller_id}", response_model=ResellerOut)
async def update_reseller(
    reseller_id: int,
    payload: UpdateResellerRequest,
    db: AsyncSession = Depends(get_db),
    admin=Depends(require_admin),
):
    q = await db.execute(select(Reseller).where(Reseller.id == reseller_id))
    r = q.scalar_one_or_none()
    if not r:
        raise HTTPException(status_code=404, detail="Reseller not found")

    fields = payload.model_fields_set
    if "parent_id" in fields:
        r.parent_id = payload.parent_id
    if "price_per_gb" in fields and payload.price_per_gb is not None:
        r.price_per_gb = payload.price_per_gb
    if "bundle_price_per_gb" in fields and payload.bundle_price_per_gb is not None:
        r.bundle_price_per_gb = payload.bundle_price_per_gb
    if "price_per_day" in fields and payload.price_per_day is not None:
        r.price_per_day = payload.price_per_day
    if "can_create_subreseller" in fields and payload.can_create_subreseller is not None:
        r.can_create_subreseller = payload.can_create_subreseller
    if payload.password:
        r.password_hash = hash_password(payload.password)
    user_policy_payload = payload.user_policy
    await db.commit()
    await db.refresh(r)
    if "user_policy" in fields:
        if user_policy_payload is None:
            await delete_user_policy_setting(db, reseller_user_policy_key(r.id))
        else:
            await set_user_policy_setting(db, reseller_user_policy_key(r.id), user_policy_payload.model_dump())
    policy = await get_user_policy_setting_optional(db, reseller_user_policy_key(r.id))
    return _to_out(r, policy)


@router.post("/{reseller_id}/set-status", response_model=ResellerOut)
async def set_reseller_status(
    reseller_id: int,
    payload: SetResellerStatusRequest,
    db: AsyncSession = Depends(get_db),
    admin=Depends(require_admin),
):
    if payload.status not in (ResellerStatus.active.value, ResellerStatus.disabled.value):
        raise HTTPException(status_code=400, detail="Invalid status")
    q = await db.execute(select(Reseller).where(Reseller.id == reseller_id))
    r = q.scalar_one_or_none()
    if not r:
        raise HTTPException(status_code=404, detail="Reseller not found")
    r.status = ResellerStatus(payload.status)
    await db.commit()
    await db.refresh(r)
    return _to_out(r)


@router.delete("/{reseller_id}", response_model=ResellerOut)
async def delete_reseller(reseller_id: int, db: AsyncSession = Depends(get_db), admin=Depends(require_admin)):
    q = await db.execute(select(Reseller).where(Reseller.id == reseller_id))
    r = q.scalar_one_or_none()
    if not r:
        raise HTTPException(status_code=404, detail="Reseller not found")
    r.status = ResellerStatus.deleted
    await db.commit()
    await db.refresh(r)
    return _to_out(r)

@router.post("/{reseller_id}/credit")
async def credit_reseller(reseller_id: int, payload: CreditRequest, db: AsyncSession = Depends(get_db), admin=Depends(require_admin)):
    q = await db.execute(select(Reseller).where(Reseller.id == reseller_id))
    r = q.scalar_one_or_none()
    if not r:
        raise HTTPException(status_code=404, detail="Reseller not found")

    amount = int(payload.amount)
    if amount == 0:
        raise HTTPException(status_code=400, detail="Amount cannot be zero")
    if r.balance + amount < 0:
        raise HTTPException(status_code=400, detail="Balance cannot become negative")

    reason = (payload.reason or "").strip()
    if not reason or (amount < 0 and reason == "manual_credit"):
        reason = "manual_debit" if amount < 0 else "manual_credit"

    r.balance += amount
    tx = LedgerTransaction(
        reseller_id=r.id,
        order_id=None,
        amount=amount,
        reason=reason,
        balance_after=r.balance,
    )
    db.add(tx)
    await db.commit()
    return {"ok": True, "balance": r.balance}
