from datetime import datetime, timedelta, timezone
import logging
import secrets

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, func

from app.core.db import get_db
from app.api.deps import require_admin
from app.models.node_allocation import NodeAllocation
from app.models.reseller import Reseller
from app.models.node import Node, PanelType
from app.models.subaccount import SubAccount
from app.models.user import GuardinoUser, NodeSelectionMode, UserStatus
from app.schemas.admin import (
    CreateAllocationRequest,
    ImportRemoteUserItem,
    ImportRemoteUsersRequest,
    ImportRemoteUsersResponse,
    UpdateAllocationRequest,
    AllocationOut,
    AllocationList,
)
from app.services.panel_access import get_adapter_for_allocation
from app.services.urls import normalize_url
from app.services.dashboard_metrics import refresh_daily_metrics_for_resellers

router = APIRouter()
logger = logging.getLogger(__name__)


def _validate_allocation_credentials(mode: str, credentials: dict | None) -> dict:
    normalized_mode = str(mode or "shared").strip().lower()
    if normalized_mode == "shared":
        return {}

    data = credentials if isinstance(credentials, dict) else {}
    token = str(data.get("token") or data.get("access_token") or data.get("api_key") or data.get("apikey") or "").strip()
    username = str(data.get("username") or "").strip()
    password = str(data.get("password") or "")
    if token:
        return {"token": token}
    if username and password:
        return {"username": username, "password": password}
    raise HTTPException(status_code=400, detail="Dedicated credentials require token or username/password.")


def allocation_out(a: NodeAllocation) -> AllocationOut:
    return AllocationOut(
        id=a.id,
        reseller_id=a.reseller_id,
        node_id=a.node_id,
        enabled=a.enabled,
        default_for_reseller=a.default_for_reseller,
        price_per_gb_override=a.price_per_gb_override,
        credential_mode=str(a.credential_mode or "shared"),
        credentials=a.credentials or {},
    )


async def _new_unique_master_sub_token(db: AsyncSession) -> str:
    for _ in range(8):
        candidate = secrets.token_hex(16)
        q = await db.execute(select(GuardinoUser.id).where(GuardinoUser.master_sub_token == candidate))
        if q.scalar_one_or_none() is None:
            return candidate
    return secrets.token_hex(24)


def _import_status(remote_status: str | None) -> UserStatus:
    value = str(remote_status or "").strip().lower()
    if value in {"disabled", "limited", "expired"}:
        return UserStatus.disabled
    return UserStatus.active


@router.get("", response_model=AllocationList)
async def list_allocations(
    db: AsyncSession = Depends(get_db),
    admin=Depends(require_admin),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=1000),
):
    base = select(NodeAllocation).order_by(desc(NodeAllocation.id))
    total_q = await db.execute(select(func.count()).select_from(base.subquery()))
    total = int(total_q.scalar_one())
    q = await db.execute(base.limit(limit).offset(offset))
    items = q.scalars().all()
    out = [allocation_out(a) for a in items]
    return AllocationList(items=out, total=total)

@router.post("", response_model=AllocationOut)
async def create_allocation(payload: CreateAllocationRequest, db: AsyncSession = Depends(get_db), admin=Depends(require_admin)):
    r = (await db.execute(select(Reseller).where(Reseller.id == payload.reseller_id))).scalar_one_or_none()
    if not r:
        raise HTTPException(status_code=404, detail="Reseller not found")

    n = (await db.execute(select(Node).where(Node.id == payload.node_id, Node.is_deleted.is_(False)))).scalar_one_or_none()
    if not n:
        raise HTTPException(status_code=404, detail="Node not found")

    a = NodeAllocation(
        reseller_id=payload.reseller_id,
        node_id=payload.node_id,
        enabled=payload.enabled,
        default_for_reseller=payload.default_for_reseller,
        price_per_gb_override=payload.price_per_gb_override,
        credential_mode=payload.credential_mode,
        credentials=_validate_allocation_credentials(payload.credential_mode, payload.credentials),
    )
    db.add(a)
    try:
        await db.commit()
    except Exception as e:
        await db.rollback()
        # Likely uniqueness constraint
        raise HTTPException(status_code=409, detail="Allocation already exists")
    await db.refresh(a)

    return allocation_out(a)

@router.patch("/{allocation_id}", response_model=AllocationOut)
async def update_allocation(allocation_id: int, payload: UpdateAllocationRequest, db: AsyncSession = Depends(get_db), admin=Depends(require_admin)):
    a = (await db.execute(select(NodeAllocation).where(NodeAllocation.id == allocation_id))).scalar_one_or_none()
    if not a:
        raise HTTPException(status_code=404, detail="Allocation not found")

    fields = payload.model_fields_set

    if "enabled" in fields:
        a.enabled = bool(payload.enabled)

    if "default_for_reseller" in fields:
        a.default_for_reseller = bool(payload.default_for_reseller)

    if "price_per_gb_override" in fields:
        a.price_per_gb_override = payload.price_per_gb_override
    next_mode = payload.credential_mode if "credential_mode" in fields else str(a.credential_mode or "shared")
    next_credentials = payload.credentials if "credentials" in fields else (a.credentials or {})
    if "credential_mode" in fields or "credentials" in fields:
        a.credential_mode = next_mode or "shared"
        a.credentials = _validate_allocation_credentials(a.credential_mode, next_credentials)

    await db.commit()
    await db.refresh(a)

    return allocation_out(a)


@router.post("/{allocation_id}/test-connection")
async def test_allocation_connection(allocation_id: int, db: AsyncSession = Depends(get_db), admin=Depends(require_admin)):
    row = (
        await db.execute(
            select(NodeAllocation, Node)
            .join(Node, Node.id == NodeAllocation.node_id)
            .where(NodeAllocation.id == allocation_id, Node.is_deleted.is_(False))
        )
    ).one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Allocation not found")
    allocation, node = row
    adapter = get_adapter_for_allocation(node, allocation)
    result = await adapter.test_connection()
    return {
        "ok": result.ok,
        "detail": result.detail,
        "meta": {
            **(result.meta or {}),
            "credential_mode": str(allocation.credential_mode or "shared"),
            "recommended_pasarguard_role": "operator" if allocation.credential_mode == "dedicated" else "sudo",
        },
    }


@router.post("/{allocation_id}/import-users", response_model=ImportRemoteUsersResponse)
async def import_remote_users(
    allocation_id: int,
    payload: ImportRemoteUsersRequest,
    db: AsyncSession = Depends(get_db),
    admin=Depends(require_admin),
):
    row = (
        await db.execute(
            select(NodeAllocation, Node, Reseller)
            .join(Node, Node.id == NodeAllocation.node_id)
            .join(Reseller, Reseller.id == NodeAllocation.reseller_id)
            .where(NodeAllocation.id == allocation_id, Node.is_deleted.is_(False))
        )
    ).one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Allocation not found")
    allocation, node, reseller = row
    if node.panel_type not in (PanelType.pasarguard, PanelType.marzban):
        raise HTTPException(status_code=400, detail="Remote user import is currently supported for PasarGuard and Marzban allocations.")

    adapter = get_adapter_for_allocation(node, allocation)
    if not hasattr(adapter, "list_users"):
        raise HTTPException(status_code=501, detail="Adapter does not support user import.")

    remote_admin = payload.remote_admin if node.panel_type == PanelType.pasarguard else None
    try:
        result = await adapter.list_users(offset=payload.offset, limit=payload.limit, admin=remote_admin)  # type: ignore[attr-defined]
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning(
            "allocation import remote list failed allocation_id=%s reseller_id=%s node_id=%s err=%s",
            allocation.id,
            reseller.id,
            node.id,
            str(exc)[:220],
        )
        raise HTTPException(status_code=502, detail=f"Remote user import failed: {str(exc)[:220]}")
    now = datetime.now(timezone.utc)
    imported = 0
    skipped_existing = 0
    errors = 0
    out_items: list[ImportRemoteUserItem] = []

    for remote_user in result.items:
        existing_row = (
            await db.execute(
                select(SubAccount, GuardinoUser)
                .join(GuardinoUser, GuardinoUser.id == SubAccount.user_id)
                .where(
                    SubAccount.node_id == node.id,
                    SubAccount.remote_identifier == remote_user.remote_identifier,
                )
            )
        ).first()
        expire_at = remote_user.expire_at or (now + timedelta(days=36500))
        base_item = {
            "username": remote_user.username,
            "remote_identifier": remote_user.remote_identifier,
            "total_gb": int(remote_user.total_gb or 0),
            "used_bytes": int(remote_user.used_bytes or 0),
            "expire_at": expire_at.isoformat(),
            "status": str(remote_user.status or "active"),
        }
        if existing_row:
            existing_subaccount, existing_user = existing_row
            if payload.skip_existing or int(existing_user.owner_reseller_id) != int(reseller.id):
                detail = "Already imported."
                if int(existing_user.owner_reseller_id) != int(reseller.id):
                    detail = "Already exists on this node under another reseller."
                    errors += 1
                else:
                    skipped_existing += 1
                out_items.append(ImportRemoteUserItem(**base_item, action="skip_existing", detail=detail))
                continue

            if payload.dry_run:
                out_items.append(ImportRemoteUserItem(**base_item, action="would_update_existing"))
                continue

            direct_url = normalize_url(remote_user.direct_sub_url, node.base_url)
            existing_user.total_gb = int(remote_user.total_gb or 0)
            existing_user.used_bytes = int(remote_user.used_bytes or 0)
            existing_user.expire_at = expire_at
            existing_user.status = _import_status(remote_user.status)
            existing_user.meta = {
                **(existing_user.meta if isinstance(existing_user.meta, dict) else {}),
                "billing_origin": "external_import",
                "imported_from": node.panel_type.value,
                "imported_at": now.isoformat(),
                "remote_admin": remote_admin or (allocation.credentials or {}).get("username"),
                "remote_raw": remote_user.raw,
                "no_expire": remote_user.expire_at is None,
            }
            existing_subaccount.allocation_id = allocation.id
            existing_subaccount.panel_sub_url_cached = direct_url
            existing_subaccount.panel_sub_url_cached_at = now if direct_url else None
            existing_subaccount.used_bytes = int(remote_user.used_bytes or 0)
            existing_subaccount.last_sync_at = now
            out_items.append(ImportRemoteUserItem(**base_item, action="updated_existing"))
            continue

        if payload.dry_run:
            out_items.append(ImportRemoteUserItem(**base_item, action="would_import"))
            continue

        try:
            user = GuardinoUser(
                owner_reseller_id=reseller.id,
                label=remote_user.username,
                total_gb=int(remote_user.total_gb or 0),
                used_bytes=int(remote_user.used_bytes or 0),
                expire_at=expire_at,
                status=_import_status(remote_user.status),
                master_sub_token=await _new_unique_master_sub_token(db),
                node_selection_mode=NodeSelectionMode.manual,
                node_group=None,
                meta={
                    "billing_origin": "external_import",
                    "imported_from": node.panel_type.value,
                    "imported_at": now.isoformat(),
                    "remote_admin": remote_admin or (allocation.credentials or {}).get("username"),
                    "remote_raw": remote_user.raw,
                    "no_expire": remote_user.expire_at is None,
                },
            )
            db.add(user)
            await db.flush()
            direct_url = normalize_url(remote_user.direct_sub_url, node.base_url)
            db.add(
                SubAccount(
                    user_id=user.id,
                    node_id=node.id,
                    allocation_id=allocation.id,
                    remote_identifier=remote_user.remote_identifier,
                    panel_sub_url_cached=direct_url,
                    panel_sub_url_cached_at=now if direct_url else None,
                    used_bytes=int(remote_user.used_bytes or 0),
                    last_sync_at=now,
                )
            )
            imported += 1
            out_items.append(ImportRemoteUserItem(**base_item, action="imported"))
        except Exception as exc:
            errors += 1
            out_items.append(ImportRemoteUserItem(**base_item, action="error", detail=str(exc)[:180]))

    if payload.dry_run:
        await db.rollback()
    else:
        await db.commit()
        try:
            await refresh_daily_metrics_for_resellers(db, [reseller.id], metric_day=now.date(), now=now)
            await db.commit()
        except Exception as exc:
            await db.rollback()
            logger.warning(
                "allocation import metrics refresh failed allocation_id=%s reseller_id=%s err=%s",
                allocation.id,
                reseller.id,
                str(exc)[:220],
            )

    return ImportRemoteUsersResponse(
        dry_run=payload.dry_run,
        allocation_id=allocation.id,
        reseller_id=reseller.id,
        node_id=node.id,
        scanned=len(result.items),
        imported=imported,
        skipped_existing=skipped_existing,
        errors=errors,
        total_remote=result.total,
        items=out_items,
    )

@router.delete("/{allocation_id}")
async def delete_allocation(allocation_id: int, db: AsyncSession = Depends(get_db), admin=Depends(require_admin)):
    a = (await db.execute(select(NodeAllocation).where(NodeAllocation.id == allocation_id))).scalar_one_or_none()
    if not a:
        raise HTTPException(status_code=404, detail="Allocation not found")
    await db.delete(a)
    await db.commit()
    return {"ok": True}
