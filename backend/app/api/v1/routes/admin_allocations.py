from datetime import datetime, timedelta, timezone
import logging
import secrets

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import and_, desc, func, or_, select

from app.core.db import get_db
from app.api.deps import require_admin
from app.models.node_allocation import NodeAllocation
from app.models.order import Order, OrderType
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
from app.services.local_detach import detach_subaccounts_locally

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


def _clean_restore_meta(meta: dict, now: datetime) -> dict:
    next_meta = dict(meta)
    for key in (
        "remote_deleted_at",
        "remote_deleted_reason",
        "local_hidden_at",
        "local_hidden_reason",
        "local_hidden_previous_status",
        "remote_missing",
    ):
        next_meta.pop(key, None)
    next_meta["restored_from_remote_at"] = now.isoformat()
    return next_meta


def _can_restore_import_candidate(user: GuardinoUser) -> bool:
    meta = user.meta if isinstance(user.meta, dict) else {}
    if user.status == UserStatus.deleted:
        reason = str(meta.get("remote_deleted_reason") or meta.get("local_hidden_reason") or "").strip()
        return reason in {"missing_in_panel", "allocation_removed", "node_deleted", "node_removed"}
    return False


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

    allocation_id_value = int(allocation.id)
    reseller_id_value = int(reseller.id)
    node_id_value = int(node.id)
    node_panel_value = node.panel_type.value
    node_base_url = node.base_url
    allocation_username = (allocation.credentials or {}).get("username")

    adapter = get_adapter_for_allocation(node, allocation)
    if not hasattr(adapter, "list_users"):
        raise HTTPException(status_code=501, detail="Adapter does not support user import.")

    remote_admin = payload.remote_admin if node.panel_type == PanelType.pasarguard else None
    remote_items = []
    seen_remote_keys: set[str] = set()
    total_remote: int | None = None
    next_offset = int(payload.offset)
    page_size = int(payload.limit)
    max_pages = int(payload.max_pages) if payload.all_pages else 1
    try:
        for _page in range(max_pages):
            result = await adapter.list_users(offset=next_offset, limit=page_size, admin=remote_admin)  # type: ignore[attr-defined]
            page_items = list(result.items or [])
            if result.total is not None:
                total_remote = int(result.total)
            new_items_on_page = 0
            for remote_user in page_items:
                remote_key = str(remote_user.remote_identifier or remote_user.username or "").strip()
                if not remote_key or remote_key in seen_remote_keys:
                    continue
                seen_remote_keys.add(remote_key)
                remote_items.append(remote_user)
                new_items_on_page += 1
            if not payload.all_pages or not page_items:
                break
            if new_items_on_page == 0:
                break
            next_offset += page_size
            if total_remote is not None and next_offset >= total_remote:
                break
            if len(page_items) < page_size:
                break
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning(
            "allocation import remote list failed allocation_id=%s reseller_id=%s node_id=%s offset=%s scanned=%s err=%s",
            allocation_id_value,
            reseller_id_value,
            node_id_value,
            next_offset,
            len(remote_items),
            str(exc)[:220],
        )
        raise HTTPException(status_code=502, detail=f"Remote user import failed after {len(remote_items)} users: {str(exc)[:220]}")
    now = datetime.now(timezone.utc)
    imported = 0
    skipped_existing = 0
    errors = 0
    out_items: list[ImportRemoteUserItem] = []
    item_response_limit = 300

    def add_out_item(item: ImportRemoteUserItem) -> None:
        if len(out_items) < item_response_limit:
            out_items.append(item)

    remote_identifiers = sorted(
        {
            str(remote_user.remote_identifier or remote_user.username or "").strip()
            for remote_user in remote_items
            if str(remote_user.remote_identifier or remote_user.username or "").strip()
        }
    )
    remote_usernames = sorted(
        {
            str(remote_user.username or "").strip()
            for remote_user in remote_items
            if str(remote_user.username or "").strip()
        }
    )

    existing_by_remote: dict[str, tuple[SubAccount, GuardinoUser]] = {}
    if remote_identifiers:
        existing_rows = (
            await db.execute(
                select(SubAccount, GuardinoUser)
                .join(GuardinoUser, GuardinoUser.id == SubAccount.user_id)
                .where(
                    SubAccount.node_id == node_id_value,
                    SubAccount.remote_identifier.in_(remote_identifiers),
                )
            )
        ).all()
        for existing_subaccount, existing_user in existing_rows:
            key = str(existing_subaccount.remote_identifier or "").strip()
            if key:
                existing_by_remote[key] = (existing_subaccount, existing_user)

    users_by_label: dict[str, list[GuardinoUser]] = {}
    if remote_usernames:
        candidate_users = (
            await db.execute(
                select(GuardinoUser).where(
                    GuardinoUser.owner_reseller_id == reseller_id_value,
                    GuardinoUser.label.in_(remote_usernames),
                )
            )
        ).scalars().all()
        for candidate in candidate_users:
            users_by_label.setdefault(str(candidate.label or "").strip(), []).append(candidate)

    create_order_user_ids: set[int] = set()
    candidate_user_ids = {
        int(user.id)
        for users_for_label in users_by_label.values()
        for user in users_for_label
        if user.id is not None
    }
    candidate_user_ids.update(int(user.id) for _subaccount, user in existing_by_remote.values() if user.id is not None)
    if candidate_user_ids:
        order_rows = await db.execute(
            select(Order.user_id).where(
                Order.user_id.in_(sorted(candidate_user_ids)),
                Order.type == OrderType.create,
            )
        )
        create_order_user_ids = {int(row[0]) for row in order_rows.all() if row[0] is not None}

    def has_guardino_billing(user: GuardinoUser) -> bool:
        meta = user.meta if isinstance(user.meta, dict) else {}
        return int(user.id) in create_order_user_ids or bool(meta.get("request_id")) or meta.get("billing_origin") == "guardino"

    def import_meta(user: GuardinoUser | None, remote_user, *, is_new: bool) -> dict:
        meta = dict(user.meta) if user is not None and isinstance(user.meta, dict) else {}
        if user is not None:
            meta = _clean_restore_meta(meta, now)
        preserve_billing = user is not None and has_guardino_billing(user)
        if is_new or not preserve_billing:
            meta.setdefault("billing_origin", "external_import")
        meta.update(
            {
                "last_imported_from": node_panel_value,
                "last_imported_at": now.isoformat(),
                "remote_admin": remote_admin or allocation_username,
                "remote_raw": remote_user.raw,
                "no_expire": remote_user.expire_at is None,
            }
        )
        if is_new:
            meta.update(
                {
                    "imported_from": node_panel_value,
                    "imported_at": now.isoformat(),
                }
            )
        return meta

    def find_restore_candidate(username: str) -> GuardinoUser | None:
        candidates = users_by_label.get(str(username or "").strip(), [])
        if not candidates:
            return None
        restorable = [candidate for candidate in candidates if _can_restore_import_candidate(candidate)]
        if len(restorable) == 1:
            return restorable[0]
        billed = [candidate for candidate in candidates if _can_restore_import_candidate(candidate) and has_guardino_billing(candidate)]
        if len(billed) == 1:
            return billed[0]
        if len(candidates) == 1 and _can_restore_import_candidate(candidates[0]):
            return candidates[0]
        return None

    for remote_user in remote_items:
        remote_identifier = str(remote_user.remote_identifier or remote_user.username or "").strip()
        existing_row = existing_by_remote.get(remote_identifier)
        expire_at = remote_user.expire_at or (now + timedelta(days=36500))
        base_item = {
            "username": remote_user.username,
            "remote_identifier": remote_identifier,
            "total_gb": int(remote_user.total_gb or 0),
            "used_bytes": int(remote_user.used_bytes or 0),
            "expire_at": expire_at.isoformat(),
            "status": str(remote_user.status or "active"),
        }
        if existing_row:
            existing_subaccount, existing_user = existing_row
            if int(existing_user.owner_reseller_id) != reseller_id_value:
                detail = "Already exists on this node under another reseller."
                errors += 1
                add_out_item(ImportRemoteUserItem(**base_item, action="error", detail=detail))
                continue
            repair_user = find_restore_candidate(remote_user.username)
            if (
                repair_user is not None
                and int(repair_user.id) != int(existing_user.id)
                and has_guardino_billing(repair_user)
                and not has_guardino_billing(existing_user)
            ):
                if payload.dry_run:
                    add_out_item(
                        ImportRemoteUserItem(
                            **base_item,
                            action="would_merge_duplicate",
                            detail=f"Would move remote link back to original Guardino user #{repair_user.id}.",
                        )
                    )
                    continue

                direct_url = normalize_url(remote_user.direct_sub_url, node_base_url)
                repair_user.total_gb = int(remote_user.total_gb or 0)
                repair_user.used_bytes = int(remote_user.used_bytes or 0)
                repair_user.expire_at = expire_at
                repair_user.status = _import_status(remote_user.status)
                repair_user.node_selection_mode = NodeSelectionMode.manual
                repair_user.meta = import_meta(repair_user, remote_user, is_new=False)
                existing_subaccount.user_id = repair_user.id
                existing_subaccount.allocation_id = allocation_id_value
                existing_subaccount.panel_sub_url_cached = direct_url
                existing_subaccount.panel_sub_url_cached_at = now if direct_url else None
                existing_subaccount.used_bytes = int(remote_user.used_bytes or 0)
                existing_subaccount.last_sync_at = now
                existing_user.status = UserStatus.deleted
                duplicate_meta = dict(existing_user.meta) if isinstance(existing_user.meta, dict) else {}
                existing_user.meta = {
                    **duplicate_meta,
                    "local_hidden_at": now.isoformat(),
                    "local_hidden_reason": "duplicate_import_repaired",
                    "superseded_by_user_id": int(repair_user.id),
                    "superseded_at": now.isoformat(),
                }
                imported += 1
                add_out_item(
                    ImportRemoteUserItem(
                        **base_item,
                        action="merged_duplicate",
                        detail=f"Remote link moved back to original Guardino user #{repair_user.id}.",
                    )
                )
                continue
            if payload.skip_existing and existing_user.status != UserStatus.deleted:
                skipped_existing += 1
                add_out_item(ImportRemoteUserItem(**base_item, action="skip_existing", detail="Already imported."))
                continue

            if payload.dry_run:
                action = "would_restore_existing" if existing_user.status == UserStatus.deleted else "would_update_existing"
                add_out_item(ImportRemoteUserItem(**base_item, action=action))
                continue

            was_deleted = existing_user.status == UserStatus.deleted
            direct_url = normalize_url(remote_user.direct_sub_url, node_base_url)
            existing_user.total_gb = int(remote_user.total_gb or 0)
            existing_user.used_bytes = int(remote_user.used_bytes or 0)
            existing_user.expire_at = expire_at
            existing_user.status = _import_status(remote_user.status)
            existing_user.meta = import_meta(existing_user, remote_user, is_new=False)
            existing_subaccount.allocation_id = allocation_id_value
            existing_subaccount.panel_sub_url_cached = direct_url
            existing_subaccount.panel_sub_url_cached_at = now if direct_url else None
            existing_subaccount.used_bytes = int(remote_user.used_bytes or 0)
            existing_subaccount.last_sync_at = now
            if was_deleted:
                imported += 1
            add_out_item(ImportRemoteUserItem(**base_item, action="restored_existing" if was_deleted else "updated_existing"))
            continue

        restore_user = find_restore_candidate(remote_user.username)
        if restore_user is not None:
            if payload.dry_run:
                add_out_item(ImportRemoteUserItem(**base_item, action="would_restore_existing"))
                continue

            try:
                direct_url = normalize_url(remote_user.direct_sub_url, node_base_url)
                restore_user.total_gb = int(remote_user.total_gb or 0)
                restore_user.used_bytes = int(remote_user.used_bytes or 0)
                restore_user.expire_at = expire_at
                restore_user.status = _import_status(remote_user.status)
                restore_user.node_selection_mode = NodeSelectionMode.manual
                restore_user.meta = import_meta(restore_user, remote_user, is_new=False)
                db.add(
                    SubAccount(
                        user_id=restore_user.id,
                        node_id=node_id_value,
                        allocation_id=allocation_id_value,
                        remote_identifier=remote_identifier,
                        panel_sub_url_cached=direct_url,
                        panel_sub_url_cached_at=now if direct_url else None,
                        used_bytes=int(remote_user.used_bytes or 0),
                        last_sync_at=now,
                    )
                )
                imported += 1
                add_out_item(ImportRemoteUserItem(**base_item, action="restored_existing"))
            except Exception as exc:
                errors += 1
                add_out_item(ImportRemoteUserItem(**base_item, action="error", detail=str(exc)[:180]))
            continue

        if payload.dry_run:
            add_out_item(ImportRemoteUserItem(**base_item, action="would_import"))
            continue

        try:
            user = GuardinoUser(
                owner_reseller_id=reseller_id_value,
                label=remote_user.username,
                total_gb=int(remote_user.total_gb or 0),
                used_bytes=int(remote_user.used_bytes or 0),
                expire_at=expire_at,
                status=_import_status(remote_user.status),
                master_sub_token=await _new_unique_master_sub_token(db),
                node_selection_mode=NodeSelectionMode.manual,
                node_group=None,
                meta=import_meta(None, remote_user, is_new=True),
            )
            db.add(user)
            await db.flush()
            direct_url = normalize_url(remote_user.direct_sub_url, node_base_url)
            db.add(
                SubAccount(
                    user_id=user.id,
                    node_id=node_id_value,
                    allocation_id=allocation_id_value,
                    remote_identifier=remote_identifier,
                    panel_sub_url_cached=direct_url,
                    panel_sub_url_cached_at=now if direct_url else None,
                    used_bytes=int(remote_user.used_bytes or 0),
                    last_sync_at=now,
                )
            )
            imported += 1
            add_out_item(ImportRemoteUserItem(**base_item, action="imported"))
        except Exception as exc:
            errors += 1
            add_out_item(ImportRemoteUserItem(**base_item, action="error", detail=str(exc)[:180]))

    if payload.dry_run:
        await db.rollback()
    else:
        await db.commit()
        try:
            await refresh_daily_metrics_for_resellers(db, [reseller_id_value], metric_day=now.date(), now=now)
            await db.commit()
        except Exception as exc:
            await db.rollback()
            logger.warning(
                "allocation import metrics refresh failed allocation_id=%s reseller_id=%s err=%s",
                allocation_id_value,
                reseller_id_value,
                str(exc)[:220],
            )

    return ImportRemoteUsersResponse(
        dry_run=payload.dry_run,
        allocation_id=allocation_id_value,
        reseller_id=reseller_id_value,
        node_id=node_id_value,
        scanned=len(remote_items),
        imported=imported,
        skipped_existing=skipped_existing,
        errors=errors,
        total_remote=total_remote,
        items=out_items,
    )

@router.delete("/{allocation_id}")
async def delete_allocation(allocation_id: int, db: AsyncSession = Depends(get_db), admin=Depends(require_admin)):
    a = (await db.execute(select(NodeAllocation).where(NodeAllocation.id == allocation_id))).scalar_one_or_none()
    if not a:
        raise HTTPException(status_code=404, detail="Allocation not found")
    reseller_id = int(a.reseller_id)
    subaccounts = (
        await db.execute(
            select(SubAccount)
            .join(GuardinoUser, GuardinoUser.id == SubAccount.user_id)
            .where(
                or_(
                    SubAccount.allocation_id == a.id,
                    and_(
                        SubAccount.node_id == a.node_id,
                        GuardinoUser.owner_reseller_id == a.reseller_id,
                    ),
                )
            )
        )
    ).scalars().all()
    detach_result = await detach_subaccounts_locally(
        db,
        subaccounts,
        reason="allocation_removed",
    )
    await db.delete(a)
    await db.commit()
    try:
        await refresh_daily_metrics_for_resellers(db, [reseller_id])
        await db.commit()
    except Exception as e:
        await db.rollback()
        logger.warning("allocation delete metrics refresh failed allocation_id=%s reseller_id=%s err=%s", allocation_id, reseller_id, str(e)[:220])
    return {
        "ok": True,
        "subaccounts_detached": detach_result.subaccounts_detached,
        "users_archived": detach_result.users_archived,
    }
