from __future__ import annotations
import asyncio
from datetime import datetime, timezone
from sqlalchemy import select

from app.core.celery_app import celery_app
from app.core.config import settings
from app.core.db import AsyncSessionLocal
from app.models.user import GuardinoUser, UserStatus
from app.models.subaccount import SubAccount
from app.models.node import Node
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
    batch_size = max(100, min(10000, int(getattr(settings, "EXPIRY_SYNC_BATCH_SIZE", 500) or 500)))
    last_id = 0
    async with AsyncSessionLocal() as db:
        while True:
            # Find active users whose expire_at <= now, in deterministic keyset batches.
            q = await db.execute(
                select(GuardinoUser)
                .where(
                    GuardinoUser.status == UserStatus.active,
                    GuardinoUser.expire_at <= now,
                    GuardinoUser.id > last_id,
                )
                .order_by(GuardinoUser.id.asc())
                .limit(batch_size)
            )
            users = q.scalars().all()
            if not users:
                break

            stats.scanned_users += len(users)
            user_ids = [u.id for u in users]
            qs = await db.execute(select(SubAccount).where(SubAccount.user_id.in_(user_ids)))
            subs = qs.scalars().all()
            node_ids = list({s.node_id for s in subs})
            qn = await db.execute(select(Node).where(Node.id.in_(node_ids)))
            nodes = {n.id: n for n in qn.scalars().all()}

            # Expire each user locally first.
            for u in users:
                u.status = UserStatus.disabled
            stats.affected_users += len(users)
            await db.commit()

            # Remote actions (best-effort) after local state update.
            for s in subs:
                n = nodes.get(s.node_id)
                if not n:
                    continue
                try:
                    adapter = get_adapter(n)
                    # For all panels, best-effort delete to enforce expiry.
                    stats.remote_actions += 1
                    await enforce_time_expiry(n.panel_type, adapter, s.remote_identifier)
                except Exception:
                    stats.remote_failures += 1

            last_id = users[-1].id
            if len(users) < batch_size:
                break

        print('expire_due_users stats:', stats)
