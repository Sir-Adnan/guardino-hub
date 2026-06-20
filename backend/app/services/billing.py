from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.reseller import Reseller


async def lock_reseller_for_billing(db: AsyncSession, reseller: Reseller) -> Reseller:
    # IMPORTANT: the reseller instance passed in was already loaded into the
    # session identity map during authentication, so a plain SELECT ... FOR UPDATE
    # would return the *same* stale Python object without refreshing `balance`.
    # populate_existing=True forces SQLAlchemy to overwrite the in-memory
    # attributes with the freshly-locked row, which is what makes the lock
    # actually protect against concurrent double-spend.
    q = await db.execute(
        select(Reseller)
        .where(Reseller.id == reseller.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    locked = q.scalar_one_or_none()
    return locked or reseller
