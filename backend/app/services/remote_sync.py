from __future__ import annotations

from datetime import datetime

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.node import Node
from app.models.subaccount import SubAccount
from app.services.adapters.factory import get_adapter
from app.services.panel_access import get_adapter_for_subaccount


def short_error(error: Exception, size: int = 140) -> str:
    return str(error).strip().replace("\n", " ")[:size]


def raise_remote_sync_failed(action: str, errors: list[str]) -> None:
    if not errors:
        return
    sample = " | ".join(errors[:3])
    raise HTTPException(
        status_code=502,
        detail=f"{action} sync failed on {len(errors)} node(s): {sample}",
    )


async def rollback_limit_changes(
    successful_sync: list[tuple[SubAccount, Node]],
    *,
    total_gb: int,
    expire_at: datetime,
    db: AsyncSession | None = None,
) -> list[str]:
    rollback_errors: list[str] = []
    for subaccount, node in successful_sync:
        try:
            adapter = await get_adapter_for_subaccount(db, subaccount, node) if db else get_adapter(node)
            await adapter.update_user_limits(
                subaccount.remote_identifier,
                total_gb=int(total_gb),
                expire_at=expire_at,
            )
        except Exception as exc:
            rollback_errors.append(f"node#{subaccount.node_id}: {short_error(exc)}")
    return rollback_errors


def raise_remote_sync_failed_with_rollback(
    action: str,
    errors: list[str],
    rollback_errors: list[str],
) -> None:
    if not errors:
        return
    sample = " | ".join(errors[:3])
    detail = f"{action} sync failed on {len(errors)} node(s): {sample}"
    if rollback_errors:
        rollback_sample = " | ".join(rollback_errors[:2])
        detail = f"{detail} || rollback failed on {len(rollback_errors)} node(s): {rollback_sample}"
    raise HTTPException(status_code=502, detail=detail)
