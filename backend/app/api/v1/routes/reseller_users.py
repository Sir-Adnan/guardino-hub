from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.core.db import get_db
from app.api.deps import require_reseller, enforce_balance_or_readonly_users
from app.models.user import GuardinoUser
from app.schemas.user import UsersPage, UserOut

router = APIRouter()

@router.get("", response_model=UsersPage)
async def list_users(request: Request, db: AsyncSession = Depends(get_db), reseller = Depends(require_reseller)):
    enforce_balance_or_readonly_users(reseller, request.url.path, request.method)

    base = select(GuardinoUser).where(GuardinoUser.owner_reseller_id == reseller.id).order_by(GuardinoUser.id.desc())
    total_q = await db.execute(select(func.count()).select_from(base.subquery()))
    total = int(total_q.scalar_one())
    q = await db.execute(base.limit(50))
    items = [
        UserOut(
            id=u.id,
            label=u.label,
            total_gb=u.total_gb,
            used_bytes=u.used_bytes,
            expire_at=u.expire_at,
            status=u.status.value,
        )
        for u in q.scalars().all()
    ]
    return UsersPage(items=items, total=total)
