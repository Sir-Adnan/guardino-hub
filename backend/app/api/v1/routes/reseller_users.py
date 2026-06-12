from fastapi import APIRouter, Depends, Request, Query, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_
from datetime import datetime, timezone
from app.core.db import get_db
from app.api.deps import require_reseller, enforce_balance_or_readonly_users
from app.models.user import GuardinoUser, UserStatus
from app.schemas.user import UsersPage, UserOut

router = APIRouter()


def _create_status_for(user: GuardinoUser) -> str | None:
    meta = user.meta if isinstance(user.meta, dict) else {}
    value = str(meta.get("create_status") or "").strip().lower()
    return value if value in {"active", "on_hold"} else None


@router.get("", response_model=UsersPage)
async def list_users(
    request: Request,
    db: AsyncSession = Depends(get_db),
    reseller = Depends(require_reseller),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    q: str | None = Query(default=None, max_length=128),
    status: str | None = Query(default=None, pattern="^(all|active|disabled|expired)$"),
):
    enforce_balance_or_readonly_users(reseller, request.url.path, request.method)

    base = (
        select(GuardinoUser)
        .where(
            GuardinoUser.owner_reseller_id == reseller.id,
            GuardinoUser.status != UserStatus.deleted,
        )
        .order_by(GuardinoUser.id.desc())
    )
    term = (q or "").strip()
    if term:
        conditions = [GuardinoUser.label.ilike(f"%{term}%")]
        if term.isdigit():
            conditions.append(GuardinoUser.id == int(term))
        base = base.where(or_(*conditions))
    status_filter = (status or "all").strip().lower()
    if status_filter == "active":
        base = base.where(GuardinoUser.status == UserStatus.active, GuardinoUser.expire_at >= datetime.now(timezone.utc))
    elif status_filter == "disabled":
        base = base.where(GuardinoUser.status == UserStatus.disabled)
    elif status_filter == "expired":
        base = base.where(GuardinoUser.expire_at < datetime.now(timezone.utc))
    total_q = await db.execute(select(func.count()).select_from(base.subquery()))
    total = int(total_q.scalar_one())
    q = await db.execute(base.limit(limit).offset(offset))
    items = [
        UserOut(
            id=u.id,
            label=u.label,
            total_gb=u.total_gb,
            used_bytes=u.used_bytes,
            expire_at=u.expire_at,
            status=u.status.value,
            create_status=_create_status_for(u),
        )
        for u in q.scalars().all()
    ]
    return UsersPage(items=items, total=total)


@router.get("/{user_id}", response_model=UserOut)
async def get_user(user_id: int, db: AsyncSession = Depends(get_db), reseller = Depends(require_reseller)):
    q = await db.execute(
        select(GuardinoUser).where(
            GuardinoUser.id == user_id,
            GuardinoUser.owner_reseller_id == reseller.id,
            GuardinoUser.status != UserStatus.deleted,
        )
    )
    u = q.scalar_one_or_none()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    return UserOut(
        id=u.id,
        label=u.label,
        total_gb=u.total_gb,
        used_bytes=u.used_bytes,
        expire_at=u.expire_at,
        status=u.status.value,
        create_status=_create_status_for(u),
    )
