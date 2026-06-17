from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.reseller import Reseller


async def lock_reseller_for_billing(db: AsyncSession, reseller: Reseller) -> Reseller:
    q = await db.execute(
        select(Reseller)
        .where(Reseller.id == reseller.id)
        .with_for_update()
    )
    locked = q.scalar_one_or_none()
    return locked or reseller
