from __future__ import annotations
import asyncio
from datetime import datetime, timezone
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.celery_app import celery_app
from app.core.db import AsyncSessionLocal
from app.models.user import GuardinoUser, UserStatus
from app.models.subaccount import SubAccount
from app.models.node import Node, PanelType
from app.services.adapters.factory import get_adapter
from app.services.status_policy import enforce_time_expiry

@celery_app.task(name="app.tasks.expiry.expire_due_users")
def expire_due_users():
    asyncio.run(_expire_due_users_async())

async def _expire_due_users_async():
    now = datetime.now(timezone.utc)
    async with AsyncSessionLocal() as db:
        # Find active users whose expire_at <= now
        q = await db.execute(select(GuardinoUser).where(GuardinoUser.status == UserStatus.active, GuardinoUser.expire_at <= now).limit(500))
        users = q.scalars().all()
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
                await enforce_time_expiry(n.panel_type, adapter, s.remote_identifier)

            except Exception:
                pass
