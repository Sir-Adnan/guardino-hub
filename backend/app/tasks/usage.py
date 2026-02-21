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

BYTES_PER_GB = 1024 ** 3

@celery_app.task(name="app.tasks.usage.sync_usage")
def sync_usage():
    asyncio.run(_sync_usage_async())

async def _sync_usage_async():
    now = datetime.now(timezone.utc)
    async with AsyncSessionLocal() as db:
        q = await db.execute(select(GuardinoUser).where(GuardinoUser.status == UserStatus.active).limit(2000))
        users = q.scalars().all()
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
                u.status = UserStatus.disabled
                # best-effort remote restrict across panels
                for s in u_subs:
                    n = nodes.get(s.node_id)
                    if not n:
                        continue
                    try:
                        adapter = get_adapter(n)
                        if n.panel_type.value == "wg_dashboard":
                            await adapter.set_status(s.remote_identifier, "limited")
                        else:
                            await adapter.disable_user(s.remote_identifier)
                    except Exception:
                        pass

        await db.commit()
