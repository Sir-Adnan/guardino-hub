from __future__ import annotations
import asyncio
import logging
from datetime import datetime, timezone
from sqlalchemy import select

from app.core.celery_app import celery_app
from app.core.config import settings
from app.core.db import AsyncSessionLocal
from app.models.user import GuardinoUser, UserStatus
from app.models.subaccount import SubAccount
from app.models.node import Node, PanelType
from app.services.adapters.factory import get_adapter
from app.services.status_policy import enforce_volume_exhausted
from app.services.locks import redis_lock
from app.services.task_metrics import TaskRunStats

BYTES_PER_GB = 1024 ** 3
logger = logging.getLogger(__name__)

@celery_app.task(name="app.tasks.usage.sync_usage")
def sync_usage():
    lock_ttl = max(90, int(getattr(settings, "USAGE_SYNC_SECONDS", 60) or 60) * 2)
    with redis_lock("guardino:lock:sync_usage", ttl_seconds=lock_ttl) as ok:
        if not ok:
            logger.info("sync_usage skipped: lock not acquired")
            return
        asyncio.run(_sync_usage_async())

async def _sync_usage_async():
    stats = TaskRunStats()
    now = datetime.now(timezone.utc)
    batch_size = max(100, min(10000, int(getattr(settings, "USAGE_SYNC_BATCH_SIZE", 2000) or 2000)))
    last_id = 0
    failure_log_budget = 25

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
            by_node: dict[int, list[SubAccount]] = {}
            node_ids: set[int] = set()
            for s in subs:
                by_user.setdefault(s.user_id, []).append(s)
                by_node.setdefault(s.node_id, []).append(s)
                node_ids.add(s.node_id)

            nodes: dict[int, Node] = {}
            if node_ids:
                nq = await db.execute(select(Node).where(Node.id.in_(list(node_ids))))
                nodes = {n.id: n for n in nq.scalars().all()}

            adapters: dict[int, object] = {}
            for node_id, node in nodes.items():
                try:
                    adapters[node_id] = get_adapter(node)
                except Exception as e:
                    if failure_log_budget > 0:
                        logger.warning(
                            "sync_usage adapter init failed node_id=%s err=%s",
                            node_id,
                            str(e)[:220],
                        )
                        failure_log_budget -= 1

            wg_usage_map_by_node: dict[int, dict[str, int | None]] = {}
            wg_failed_nodes: set[int] = set()
            for node_id, node in nodes.items():
                if node.panel_type != PanelType.wg_dashboard:
                    continue
                adapter = adapters.get(node_id)
                node_subs = by_node.get(node_id, [])
                if not adapter:
                    wg_failed_nodes.add(node_id)
                    stats.remote_failures += len(node_subs)
                    continue
                try:
                    if hasattr(adapter, "get_used_bytes_many"):
                        ids = [str(s.remote_identifier or "").strip() for s in node_subs if str(s.remote_identifier or "").strip()]
                        wg_usage_map_by_node[node_id] = await adapter.get_used_bytes_many(ids)  # type: ignore[attr-defined]
                    else:
                        wg_usage_map_by_node[node_id] = {}
                except Exception as e:
                    wg_failed_nodes.add(node_id)
                    stats.remote_failures += len(node_subs)
                    if failure_log_budget > 0:
                        logger.warning(
                            "sync_usage WG bulk fetch failed node_id=%s peers=%s err=%s",
                            node_id,
                            len(node_subs),
                            str(e)[:220],
                        )
                        failure_log_budget -= 1

            for u in users:
                u_subs = by_user.get(u.id, [])
                total_used = 0
                remote_success_count = 0

                # Sync usage from remote. If a node is temporarily unreachable,
                # keep the previous local usage snapshot for that subaccount.
                for s in u_subs:
                    effective_used = max(0, int(s.used_bytes or 0))
                    n = nodes.get(s.node_id)
                    if not n:
                        total_used += effective_used
                        continue
                    adapter = adapters.get(s.node_id)
                    if not adapter:
                        if n.panel_type == PanelType.wg_dashboard and s.node_id in wg_failed_nodes:
                            total_used += effective_used
                            continue
                        stats.remote_failures += 1
                        total_used += effective_used
                        continue
                    if n.panel_type == PanelType.wg_dashboard:
                        if s.node_id in wg_failed_nodes:
                            total_used += effective_used
                            continue
                        used = wg_usage_map_by_node.get(s.node_id, {}).get(str(s.remote_identifier or "").strip())
                        if used is None:
                            stats.remote_skipped += 1
                            total_used += effective_used
                            continue
                        effective_used = max(0, int(used))
                        s.used_bytes = effective_used
                        s.last_sync_at = now
                        remote_success_count += 1
                        stats.remote_success += 1
                        total_used += effective_used
                        continue
                    try:
                        used = await adapter.get_used_bytes(s.remote_identifier)
                        if used is None:
                            stats.remote_skipped += 1
                            total_used += effective_used
                            continue
                        effective_used = max(0, int(used))
                        s.used_bytes = effective_used
                        s.last_sync_at = now
                        remote_success_count += 1
                        stats.remote_success += 1
                        total_used += effective_used
                    except Exception as e:
                        stats.remote_failures += 1
                        if failure_log_budget > 0:
                            logger.warning(
                                "sync_usage remote fetch failed user_id=%s node_id=%s remote_identifier=%s err=%s",
                                u.id,
                                s.node_id,
                                s.remote_identifier,
                                str(e)[:220],
                            )
                            failure_log_budget -= 1
                        total_used += effective_used
                        continue

                u.used_bytes = int(total_used)
                if u_subs and remote_success_count == 0:
                    stats.users_with_stale_usage += 1

                # enforce volume exhaustion
                if u.used_bytes >= int(u.total_gb) * BYTES_PER_GB and u.status == UserStatus.active:
                    u.status = UserStatus.disabled
                    stats.affected_users += 1
                    for s in u_subs:
                        n = nodes.get(s.node_id)
                        if not n:
                            continue
                        try:
                            adapter = adapters.get(s.node_id) or get_adapter(n)
                            await enforce_volume_exhausted(n.panel_type, adapter, s.remote_identifier)
                            stats.remote_actions += 1
                        except Exception:
                            stats.remote_failures += 1
                            continue

            await db.commit()
            last_id = users[-1].id
            if len(users) < batch_size:
                break

        logger.info("sync_usage stats=%s", stats)
