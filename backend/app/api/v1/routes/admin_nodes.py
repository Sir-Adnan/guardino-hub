from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.core.db import get_db
from app.api.deps import require_admin
from app.models.node import Node, PanelType
from app.models.subaccount import SubAccount
from app.schemas.admin import CreateNodeRequest, UpdateNodeRequest, NodeOut, NodeList

router = APIRouter()


def node_out(n: Node, last_sync_at=None) -> NodeOut:
    return NodeOut(
        id=n.id,
        name=n.name,
        panel_type=n.panel_type.value,
        base_url=n.base_url,
        credentials=n.credentials or {},
        tags=n.tags,
        is_enabled=n.is_enabled,
        is_visible_in_sub=n.is_visible_in_sub,
        is_deleted=bool(getattr(n, "is_deleted", False)),
        last_sync_at=last_sync_at.isoformat() if last_sync_at else None,
    )

@router.post("", response_model=NodeOut)
async def create_node(payload: CreateNodeRequest, db: AsyncSession = Depends(get_db), admin=Depends(require_admin)):
    try:
        panel_type = PanelType(payload.panel_type)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid panel_type")

    n = Node(
        name=payload.name,
        panel_type=panel_type,
        base_url=payload.base_url.rstrip("/"),
        credentials=payload.credentials or {},
        tags=payload.tags or [],
        is_enabled=payload.is_enabled,
        is_visible_in_sub=payload.is_visible_in_sub,
    )
    db.add(n)
    await db.commit()
    await db.refresh(n)

    return node_out(n)

@router.get("", response_model=NodeList)
async def list_nodes(
    db: AsyncSession = Depends(get_db),
    admin=Depends(require_admin),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=1000),
):
    latest_sync = (
        select(SubAccount.node_id, func.max(SubAccount.last_sync_at).label("last_sync_at"))
        .group_by(SubAccount.node_id)
        .subquery()
    )
    total_q = await db.execute(select(func.count()).select_from(Node).where(Node.is_deleted.is_(False)))
    total = int(total_q.scalar_one())
    q = await db.execute(
        select(Node, latest_sync.c.last_sync_at)
        .outerjoin(latest_sync, latest_sync.c.node_id == Node.id)
        .where(Node.is_deleted.is_(False))
        .order_by(Node.id.desc())
        .limit(limit)
        .offset(offset)
    )
    items = [node_out(n, last_sync_at) for n, last_sync_at in q.all()]
    return NodeList(items=items, total=total)

@router.patch("/{node_id}", response_model=NodeOut)
async def update_node(node_id: int, payload: UpdateNodeRequest, db: AsyncSession = Depends(get_db), admin=Depends(require_admin)):
    q = await db.execute(select(Node).where(Node.id == node_id, Node.is_deleted.is_(False)))
    n = q.scalar_one_or_none()
    if not n:
        raise HTTPException(status_code=404, detail="Node not found")

    if payload.name is not None:
        n.name = payload.name
    if payload.panel_type is not None:
        try:
            n.panel_type = PanelType(payload.panel_type)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid panel_type")
    if payload.base_url is not None:
        n.base_url = payload.base_url.rstrip("/")
    if payload.credentials is not None:
        n.credentials = payload.credentials
    if payload.tags is not None:
        n.tags = payload.tags
    if payload.is_enabled is not None:
        n.is_enabled = payload.is_enabled
    if payload.is_visible_in_sub is not None:
        n.is_visible_in_sub = payload.is_visible_in_sub

    await db.commit()
    await db.refresh(n)

    return node_out(n)

@router.delete("/{node_id}")
async def soft_delete_node(node_id: int, db: AsyncSession = Depends(get_db), admin=Depends(require_admin)):
    q = await db.execute(select(Node).where(Node.id == node_id, Node.is_deleted.is_(False)))
    n = q.scalar_one_or_none()
    if not n:
        raise HTTPException(status_code=404, detail="Node not found")

    # Soft delete: فقط از Guardino غیرفعال می‌کنیم؛ هیچ تغییری در پنل مقصد اعمال نمی‌شود.
    if n.is_enabled:
        raise HTTPException(status_code=400, detail="Disable the node before deleting it.")
    n.is_enabled = False
    n.is_visible_in_sub = False
    n.is_deleted = True
    await db.commit()
    return {"ok": True, "is_enabled": n.is_enabled, "is_deleted": n.is_deleted}

@router.post("/{node_id}/test-connection")
async def test_connection(node_id: int, db: AsyncSession = Depends(get_db), admin=Depends(require_admin)):
    q = await db.execute(select(Node).where(Node.id == node_id, Node.is_deleted.is_(False)))
    n = q.scalar_one_or_none()
    if not n:
        raise HTTPException(status_code=404, detail="Node not found")

    from app.services.adapters.factory import get_adapter
    adapter = get_adapter(n)
    result = await adapter.test_connection()
    return {"ok": result.ok, "detail": result.detail, "meta": result.meta}
