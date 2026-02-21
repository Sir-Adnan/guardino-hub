from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.db import get_db
from app.api.deps import require_admin
from app.models.node import Node, PanelType
from app.schemas.admin import CreateNodeRequest, NodeOut

router = APIRouter()

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

    return NodeOut(
        id=n.id,
        name=n.name,
        panel_type=n.panel_type.value,
        base_url=n.base_url,
        tags=n.tags,
        is_enabled=n.is_enabled,
        is_visible_in_sub=n.is_visible_in_sub,
    )

@router.get("", response_model=list[NodeOut])
async def list_nodes(db: AsyncSession = Depends(get_db), admin=Depends(require_admin)):
    q = await db.execute(select(Node).order_by(Node.id.desc()))
    nodes = q.scalars().all()
    return [
        NodeOut(
            id=n.id,
            name=n.name,
            panel_type=n.panel_type.value,
            base_url=n.base_url,
            tags=n.tags,
            is_enabled=n.is_enabled,
            is_visible_in_sub=n.is_visible_in_sub,
        )
        for n in nodes
    ]

@router.delete("/{node_id}")
async def soft_delete_node(node_id: int, db: AsyncSession = Depends(get_db), admin=Depends(require_admin)):
    q = await db.execute(select(Node).where(Node.id == node_id))
    n = q.scalar_one_or_none()
    if not n:
        raise HTTPException(status_code=404, detail="Node not found")

    # Soft delete: فقط از Guardino غیرفعال می‌کنیم؛ هیچ تغییری در پنل مقصد اعمال نمی‌شود.
    n.is_enabled = False
    await db.commit()
    return {"ok": True, "is_enabled": n.is_enabled}

@router.post("/{node_id}/test-connection")
async def test_connection(node_id: int, db: AsyncSession = Depends(get_db), admin=Depends(require_admin)):
    q = await db.execute(select(Node).where(Node.id == node_id))
    n = q.scalar_one_or_none()
    if not n:
        raise HTTPException(status_code=404, detail="Node not found")

    from app.services.adapters.factory import get_adapter
    adapter = get_adapter(n)
    result = await adapter.test_connection()
    return {"ok": result.ok, "detail": result.detail, "meta": result.meta}
