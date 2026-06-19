from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterable

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.subaccount import SubAccount
from app.models.user import GuardinoUser, UserStatus


@dataclass(frozen=True)
class LocalDetachResult:
    subaccounts_detached: int = 0
    users_archived: int = 0
    affected_reseller_ids: tuple[int, ...] = ()


async def detach_subaccounts_locally(
    db: AsyncSession,
    subaccounts: Iterable[SubAccount],
    *,
    reason: str,
    now: datetime | None = None,
) -> LocalDetachResult:
    """Remove Guardino local links without touching the remote panel."""
    now = now or datetime.now(timezone.utc)
    subs = list(subaccounts)
    sub_ids = sorted({int(sa.id) for sa in subs if sa.id is not None})
    user_ids = sorted({int(sa.user_id) for sa in subs if sa.user_id is not None})
    if not sub_ids or not user_ids:
        return LocalDetachResult()

    users = (
        (await db.execute(select(GuardinoUser).where(GuardinoUser.id.in_(user_ids))))
        .scalars()
        .all()
    )
    user_map = {int(user.id): user for user in users}
    affected_reseller_ids = sorted({int(user.owner_reseller_id) for user in users})

    await db.execute(delete(SubAccount).where(SubAccount.id.in_(sub_ids)))

    remaining_rows = (
        await db.execute(
            select(
                SubAccount.user_id,
                func.coalesce(func.sum(SubAccount.used_bytes), 0).label("used_bytes"),
            )
            .where(SubAccount.user_id.in_(user_ids))
            .group_by(SubAccount.user_id)
        )
    ).all()
    remaining_used_by_user = {int(row.user_id): int(row.used_bytes or 0) for row in remaining_rows}

    archived = 0
    for user_id in user_ids:
        user = user_map.get(user_id)
        if not user:
            continue
        if user_id in remaining_used_by_user:
            user.used_bytes = max(0, int(remaining_used_by_user[user_id] or 0))
            continue
        if user.status == UserStatus.deleted:
            continue
        meta = user.meta if isinstance(user.meta, dict) else {}
        previous_status = str(getattr(user.status, "value", user.status) or "")
        user.status = UserStatus.deleted
        user.meta = {
            **meta,
            "local_hidden_at": now.isoformat(),
            "local_hidden_reason": reason,
            "local_hidden_previous_status": previous_status,
        }
        archived += 1

    return LocalDetachResult(
        subaccounts_detached=len(sub_ids),
        users_archived=archived,
        affected_reseller_ids=tuple(affected_reseller_ids),
    )
