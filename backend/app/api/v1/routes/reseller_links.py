from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime, timezone
from urllib.parse import urlparse

from app.core.db import get_db
from app.api.deps import block_if_balance_zero
from app.models.user import GuardinoUser, UserStatus
from app.models.subaccount import SubAccount
from app.models.node import Node, PanelType
from app.services.adapters.base import RemoteUserNotFound
from app.services.adapters.factory import get_adapter
from app.schemas.links import UserLinksResponse, NodeLink
from app.services.user_defaults import (
    get_effective_user_defaults,
)

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

router = APIRouter()


def _sync_create_status_meta(user: GuardinoUser, remote_status: str | None, used_bytes: int, now: datetime) -> None:
    meta = user.meta if isinstance(user.meta, dict) else {}
    current = str(meta.get("create_status") or "").strip().lower()
    normalized_remote = str(remote_status or "").strip().lower()
    next_status: str | None = None

    if normalized_remote == "on_hold":
        next_status = "on_hold"
    elif normalized_remote in {"active", "disabled", "limited", "expired"}:
        next_status = "active"
    elif used_bytes > 0 and current == "on_hold":
        next_status = "active"

    if next_status and current != next_status:
        extra: dict[str, str] = {"create_status": next_status}
        if next_status == "active" and current == "on_hold":
            extra["first_connection_synced_at"] = now.isoformat()
        user.meta = {**meta, **extra}


async def _show_guardino_master_sub(db: AsyncSession, reseller_id: int) -> bool:
    effective = await get_effective_user_defaults(db, reseller_id)
    return bool(effective.get("show_guardino_master_sub", False))

@router.get("/{user_id}/links", response_model=UserLinksResponse)
async def get_links(user_id: int, request: Request, refresh: bool = False, db: AsyncSession = Depends(get_db), reseller = Depends(block_if_balance_zero)):
    q = await db.execute(
        select(GuardinoUser).where(
            GuardinoUser.id == user_id,
            GuardinoUser.owner_reseller_id == reseller.id,
            GuardinoUser.status != UserStatus.deleted,
        )
    )
    user = q.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    qs = await db.execute(select(SubAccount).where(SubAccount.user_id == user.id))
    subs = qs.scalars().all()
    if not subs:
        raise HTTPException(status_code=400, detail="No subaccounts")

    # Load nodes
    node_ids = [sa.node_id for sa in subs]
    qn = await db.execute(select(Node).where(Node.id.in_(node_ids)))
    node_map = {n.id: n for n in qn.scalars().all()}

    node_links: list[NodeLink] = []
    now = datetime.now(timezone.utc)
    missing_subs = 0
    missing_sub_ids: set[int] = set()

    for sa in subs:
        node = node_map.get(sa.node_id)
        node_panel_type = node.panel_type.value if node else None
        wg_download_url = None
        if node and node.panel_type == PanelType.wg_dashboard:
            wg_download_url = str(request.base_url).rstrip("/") + f"/api/v1/sub/wg/{user.master_sub_token}/{sa.node_id}.conf"

        direct = sa.panel_sub_url_cached
        if direct and node:
            normalized_cached = _normalize_url(direct, node.base_url)
            if normalized_cached:
                direct = normalized_cached
        status = "ok" if direct else "missing"
        detail = None

        if refresh and sa.node_id in node_map and (node_panel_type != "wg_dashboard"):
            try:
                adapter = get_adapter(node_map[sa.node_id])
                if hasattr(adapter, "get_user_snapshot"):
                    snapshot = await adapter.get_user_snapshot(sa.remote_identifier)  # type: ignore[attr-defined]
                    if snapshot.used_bytes is not None:
                        sa.used_bytes = max(0, int(snapshot.used_bytes))
                    _sync_create_status_meta(user, snapshot.status, int(sa.used_bytes or 0), now)
                direct_new = await adapter.get_direct_subscription_url(sa.remote_identifier)
                if direct_new:
                    normalized_new = _normalize_url(direct_new, node.base_url if node else None)
                    sa.panel_sub_url_cached = normalized_new or direct_new
                    sa.panel_sub_url_cached_at = now
                    direct = sa.panel_sub_url_cached
                    status = "ok"
                else:
                    status = "missing"
            except RemoteUserNotFound:
                missing_subs += 1
                missing_sub_ids.add(sa.id)
                await db.delete(sa)
                direct = None
                status = "missing"
                detail = "Remote user not found"
            except Exception as e:
                status = "error"
                detail = str(e)[:160]

        if node_panel_type == "wg_dashboard":
            direct = wg_download_url
            status = "ok" if wg_download_url else "missing"

        node_links.append(
            NodeLink(
                node_id=sa.node_id,
                node_name=node.name if node else None,
                panel_type=node_panel_type,
                direct_url=direct,
                full_url=_normalize_url(direct, node.base_url if node else None),
                config_download_url=wg_download_url,
                status=status,
                detail=detail,
            )
        )

    if refresh:
        user.used_bytes = sum(max(0, int(sa.used_bytes or 0)) for sa in subs if sa.id not in missing_sub_ids)
        if missing_subs >= len(subs):
            meta = user.meta if isinstance(user.meta, dict) else {}
            user.status = UserStatus.deleted
            user.meta = {
                **meta,
                "remote_deleted_at": now.isoformat(),
                "remote_deleted_reason": "missing_in_panel",
            }
        await db.commit()

    master = None
    if user.status != UserStatus.deleted and await _show_guardino_master_sub(db, reseller.id):
        master = str(request.base_url).rstrip("/") + f"/api/v1/sub/{user.master_sub_token}"
    return UserLinksResponse(user_id=user.id, master_link=master, node_links=node_links)
