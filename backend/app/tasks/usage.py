from __future__ import annotations
import asyncio
from datetime import datetime, timezone
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.celery_app import celery_app
from app.core.db import AsyncSessionLocal
from app.models.user import GuardinoUser, UserStatus
from app.models.subaccount import SubAccount
from app.models.node import Node
from app.services.adapters.factory import get_adapter
from app.services.status_policy import enforce_volume_exhausted
from app.services.locks import redis_lock
from app.services.task_metrics import TaskRunStats

BYTES_PER_GB = 1024 ** 3

@celery_app.task(name="app.tasks.usage.sync_usage")
def sync_usage():
    with redis_lock('guardino:lock:sync_usage', ttl_seconds=280) as ok:
        if not ok:
            return
    

# internal



async def _sync_usage_async():
    stats = TaskRunStats()
    now = datetime.now(timezone.utc)
    async with AsyncSessionLocal() as db:
        q = await db.execute(select(GuardinoUser).where(GuardinoUser.status == UserStatus.active).limit(2000))
        users = q.scalars().all()
        stats.scanned_users = len(users)
        if not users:
            return

        user_ids = [u.id for u in users]
        qs = await db.execute(select(SubAccount).where(SubAccount.user_id.in_(user_ids)))
        subs = qs.scalars().all()
        if not subs:
            return

        node_ids = list({s.node_id for s in subs})
        qn = await db.execute(select(Node).where(Node.id.in_(node_ids)))
        nodes = {n.id: n for n in qn.scalars().all()}

        # group subaccounts by user
        subs_by_user: dict[int, list[SubAccount]] = {}
        for s in subs:
            subs_by_user.setdefault(s.user_id, []).append(s)

        for u in users:
            u_subs = subs_by_user.get(u.id, [])
            total_used = 0
            # sync each subaccount usage
            for s in u_subs:
                n = nodes.get(s.node_id)
                if not n:
                    continue
                try:
                    adapter = get_adapter(n)
                    used = await adapter.get_used_bytes(s.remote_identifier)
                    if used is not None:
                        s.used_bytes = int(used)
                        s.last_sync_at = now
                        total_used += int(used)
                except Exception:
                    continue

            u.used_bytes = int(total_used)

            # enforce volume
            if u.used_bytes >= int(u.total_gb) * BYTES_PER_GB:
                stats.affected_users += 1
                u.status = UserStatus.disabled
                # best-effort remote enforcement across panels
                        stats.remote_actions += 1
                        await enforce_volume_exhausted(n.panel_type, adapter, s.remote_identifier)
                    except Exception:
                        stats.remote_failures += 1
                        pass

        await db.commit()

        print('sync_usage stats:', stats)
