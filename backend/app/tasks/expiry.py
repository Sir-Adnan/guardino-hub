from __future__ import annotations
import asyncio
from datetime import datetime, timezone
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.celery_app import celery_app
from app.core.config import settings
from app.core.db import AsyncSessionLocal
from app.models.user import GuardinoUser, UserStatus
from app.models.subaccount import SubAccount
from app.models.node import Node, PanelType
from app.services.adapters.factory import get_adapter
from app.services.status_policy import enforce_time_expiry
from app.services.locks import redis_lock
from app.services.task_metrics import TaskRunStats

@celery_app.task(name="app.tasks.expiry.expire_due_users")
def expire_due_users():
    lock_ttl = max(90, int(getattr(settings, "EXPIRY_SYNC_SECONDS", 60) or 60) * 2)
    with redis_lock("guardino:lock:expire_due_users", ttl_seconds=lock_ttl) as ok:
        if not ok:
            return
        asyncio.run(_expire_due_users_async())


# internal

async def _expire_due_users_async():
    stats = TaskRunStats()
    now = datetime.now(timezone.utc)
    async with AsyncSessionLocal() as db:
        # Find active users whose expire_at <= now
        q = await db.execute(select(GuardinoUser).where(GuardinoUser.status == UserStatus.active, GuardinoUser.expire_at <= now).limit(500))
        users = q.scalars().all()
        stats.scanned_users = len(users)
        if not users:
            return

        user_ids = [u.id for u in users]
        qs = await db.execute(select(SubAccount).where(SubAccount.user_id.in_(user_ids)))
        subs = qs.scalars().all()
        node_ids = list({s.node_id for s in subs})
        qn = await db.execute(select(Node).where(Node.id.in_(node_ids)))
        nodes = {n.id: n for n in qn.scalars().all()}

        # Expire each user (best-effort remote delete/restrict)
        for u in users:
            u.status = UserStatus.disabled
        stats.affected_users = len(users)

        await db.commit()

        # Remote actions (after marking disabled)
        for s in subs:
            n = nodes.get(s.node_id)
            if not n:
                continue
            try:
                adapter = get_adapter(n)
                # For all panels, best-effort delete to enforce expiry.
                # If you prefer restrict over delete for some panels, we can add adapter.restrict_user later.
                stats.remote_actions += 1
                await enforce_time_expiry(n.panel_type, adapter, s.remote_identifier)

            except Exception:
                stats.remote_failures += 1
                pass

        print('expire_due_users stats:', stats)
