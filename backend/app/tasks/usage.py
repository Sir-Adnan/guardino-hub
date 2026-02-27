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
from app.services.status_policy import enforce_volume_exhausted
from app.services.locks import redis_lock
from app.services.task_metrics import TaskRunStats

BYTES_PER_GB = 1024 ** 3

@celery_app.task(name="app.tasks.usage.sync_usage")
def sync_usage():
    lock_ttl = max(90, int(getattr(settings, "USAGE_SYNC_SECONDS", 60) or 60) * 2)
    with redis_lock("guardino:lock:sync_usage", ttl_seconds=lock_ttl) as ok:
        if not ok:
            return
        asyncio.run(_sync_usage_async())

async def _sync_usage_async():
    stats = TaskRunStats()
    now = datetime.now(timezone.utc)
    batch_size = max(100, min(10000, int(getattr(settings, "USAGE_SYNC_BATCH_SIZE", 2000) or 2000)))
    last_id = 0

    async with AsyncSessionLocal() as db:
        while True:
            q = await db.execute(
                select(GuardinoUser)
                .where(GuardinoUser.status == UserStatus.active, GuardinoUser.id > last_id)
                .order_by(GuardinoUser.id.asc())
                .limit(batch_size)
            )
            users = q.scalars().all()
            if not users:
                break

            stats.scanned_users += len(users)
            user_ids = [u.id for u in users]
            sq = await db.execute(select(SubAccount).where(SubAccount.user_id.in_(user_ids)))
            subs = sq.scalars().all()

            by_user: dict[int, list[SubAccount]] = {}
            node_ids: set[int] = set()
            for s in subs:
                by_user.setdefault(s.user_id, []).append(s)
                node_ids.add(s.node_id)

            nodes: dict[int, Node] = {}
            if node_ids:
                nq = await db.execute(select(Node).where(Node.id.in_(list(node_ids))))
                nodes = {n.id: n for n in nq.scalars().all()}

            for u in users:
                u_subs = by_user.get(u.id, [])
                total_used = 0

                # sync usage from remote
                for s in u_subs:
                    n = nodes.get(s.node_id)
                    if not n:
                        continue
                    try:
                        adapter = get_adapter(n)
                        used = await adapter.get_used_bytes(s.remote_identifier)
                        if used is None:
                            continue
                        s.used_bytes = int(used)
                        s.last_sync_at = now
                        total_used += int(used)
                    except Exception:
                        stats.remote_failures += 1
                        continue

                u.used_bytes = int(total_used)

                # enforce volume exhaustion
                if u.used_bytes >= int(u.total_gb) * BYTES_PER_GB and u.status == UserStatus.active:
                    u.status = UserStatus.disabled
                    stats.affected_users += 1
                    for s in u_subs:
                        n = nodes.get(s.node_id)
                        if not n:
                            continue
                        try:
                            adapter = get_adapter(n)
                            await enforce_volume_exhausted(n.panel_type, adapter, s.remote_identifier)
                            stats.remote_actions += 1
                        except Exception:
                            stats.remote_failures += 1
                            continue

            await db.commit()
            last_id = users[-1].id
            if len(users) < batch_size:
                break

        print("sync_usage stats:", stats)
