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
from app.models.node_allocation import NodeAllocation
from app.services.adapters.factory import get_adapter
from app.services.adapters.base import RemoteUserListItem, RemoteUserNotFound
from app.services.panel_access import get_adapter_for_allocation, get_adapter_for_subaccount
from app.services.status_policy import enforce_volume_exhausted
from app.services.locks import redis_lock
from app.services.task_metrics import TaskRunStats
from app.services.dashboard_metrics import refresh_daily_metrics_for_resellers
from app.services.remote_missing import clear_remote_missing, mark_remote_missing, remote_identifier

BYTES_PER_GB = 1024 ** 3
logger = logging.getLogger(__name__)


def _sync_create_status_meta(user: GuardinoUser, remote_status: str | None, used_bytes: int, now: datetime) -> None:
    meta = user.meta if isinstance(user.meta, dict) else {}
    current = str(meta.get("create_status") or "").strip().lower()
    normalized_remote = str(remote_status or "").strip().lower()
    next_status: str | None = None

    if normalized_remote == "on_hold":
        next_status = "on_hold"
    elif normalized_remote in {"active", "disabled", "limited", "expired"}:
        next_status = "active"
    elif used_bytes > 0 and current == "on_hold":
        next_status = "active"

    if next_status and current != next_status:
        extra: dict[str, str] = {"create_status": next_status}
        if next_status == "active" and current == "on_hold":
            extra["first_connection_synced_at"] = now.isoformat()
        user.meta = {**meta, **extra}


async def _fetch_remote_user_list(
    adapter: object,
    wanted_identifiers: set[str],
) -> tuple[dict[str, RemoteUserListItem], bool, int | None, int]:
    if not wanted_identifiers or not hasattr(adapter, "list_users"):
        return {}, False, None, 0

    page_size = max(100, min(5000, int(getattr(settings, "USAGE_SYNC_REMOTE_LIST_PAGE_SIZE", 1000) or 1000)))
    max_pages = max(1, min(1000, int(getattr(settings, "USAGE_SYNC_REMOTE_LIST_MAX_PAGES", 200) or 200)))
    found: dict[str, RemoteUserListItem] = {}
    seen_remote_keys: set[str] = set()
    offset = 0
    total: int | None = None
    scanned = 0

    for _page in range(max_pages):
        result = await adapter.list_users(offset=offset, limit=page_size)  # type: ignore[attr-defined]
        items = list(getattr(result, "items", []) or [])
        scanned += len(items)
        maybe_total = getattr(result, "total", None)
        total = int(maybe_total) if maybe_total is not None else total

        page_keys = {
            remote_identifier(candidate)
            for item in items
            for candidate in (item.remote_identifier, item.username)
            if remote_identifier(candidate)
        }
        new_page_keys = page_keys - seen_remote_keys
        for item in items:
            for candidate in (item.remote_identifier, item.username):
                key = remote_identifier(candidate)
                if key and key in wanted_identifiers:
                    found[key] = item
        seen_remote_keys.update(page_keys)

        if wanted_identifiers.issubset(found.keys()):
            return found, True, total, scanned
        if not items:
            return found, True, total, scanned
        if not new_page_keys and offset > 0:
            return found, False, total, scanned
        offset += page_size
        if total is not None and offset >= total:
            return found, True, total, scanned
        if len(items) < page_size:
            return found, True, total, scanned

    return found, False, total, scanned


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
    missing_confirmations = max(1, min(20, int(getattr(settings, "USAGE_SYNC_REMOTE_MISSING_CONFIRMATIONS", 3) or 3)))
    last_id = 0
    failure_log_budget = 25

    async with AsyncSessionLocal() as db:
        while True:
            q = await db.execute(
                select(GuardinoUser)
                .where(GuardinoUser.status != UserStatus.deleted, GuardinoUser.id > last_id)
                .order_by(GuardinoUser.id.asc())
                .limit(batch_size)
            )
            users = q.scalars().all()
            if not users:
                break
            next_last_id = int(users[-1].id)

            stats.scanned_users += len(users)
            touched_reseller_ids: set[int] = set()
            user_ids = [u.id for u in users]
            sq = await db.execute(select(SubAccount).where(SubAccount.user_id.in_(user_ids)))
            subs = sq.scalars().all()

            by_user: dict[int, list[SubAccount]] = {}
            by_access: dict[tuple[str, int], list[SubAccount]] = {}
            node_ids: set[int] = set()
            allocation_ids: set[int] = set()
            for s in subs:
                by_user.setdefault(s.user_id, []).append(s)
                node_ids.add(s.node_id)
                if s.allocation_id:
                    allocation_ids.add(int(s.allocation_id))

            nodes: dict[int, Node] = {}
            if node_ids:
                nq = await db.execute(select(Node).where(Node.id.in_(list(node_ids))))
                nodes = {n.id: n for n in nq.scalars().all()}

            allocations: dict[int, NodeAllocation] = {}
            if allocation_ids:
                aq = await db.execute(select(NodeAllocation).where(NodeAllocation.id.in_(list(allocation_ids))))
                allocations = {a.id: a for a in aq.scalars().all()}

            for s in subs:
                key = ("allocation", int(s.allocation_id)) if s.allocation_id and int(s.allocation_id) in allocations else ("node", int(s.node_id))
                by_access.setdefault(key, []).append(s)

            adapters: dict[tuple[str, int], object] = {}
            for key, access_subs in by_access.items():
                first_sub = access_subs[0]
                node = nodes.get(first_sub.node_id)
                if not node:
                    continue
                try:
                    allocation = allocations.get(key[1]) if key[0] == "allocation" else None
                    adapters[key] = get_adapter_for_allocation(node, allocation) if allocation else get_adapter(node)
                except Exception as e:
                    stats.remote_failures += len(access_subs)
                    if failure_log_budget > 0:
                        logger.warning(
                            "sync_usage adapter init failed access=%s node_id=%s err=%s",
                            key,
                            first_sub.node_id,
                            str(e)[:220],
                        )
                        failure_log_budget -= 1

            wg_usage_map_by_access: dict[tuple[str, int], dict[str, int | None]] = {}
            wg_failed_access: set[tuple[str, int]] = set()
            for key, access_subs in by_access.items():
                node = nodes.get(access_subs[0].node_id)
                if not node:
                    continue
                if node.panel_type != PanelType.wg_dashboard:
                    continue
                adapter = adapters.get(key)
                if not adapter:
                    wg_failed_access.add(key)
                    stats.remote_failures += len(access_subs)
                    continue
                try:
                    if hasattr(adapter, "get_used_bytes_many"):
                        ids = [str(s.remote_identifier or "").strip() for s in access_subs if str(s.remote_identifier or "").strip()]
                        wg_usage_map_by_access[key] = await adapter.get_used_bytes_many(ids)  # type: ignore[attr-defined]
                    else:
                        wg_usage_map_by_access[key] = {}
                except Exception as e:
                    wg_failed_access.add(key)
                    stats.remote_failures += len(access_subs)
                    if failure_log_budget > 0:
                        logger.warning(
                            "sync_usage WG bulk fetch failed access=%s node_id=%s peers=%s err=%s",
                            key,
                            node.id,
                            len(access_subs),
                            str(e)[:220],
                        )
                        failure_log_budget -= 1

            remote_list_by_access: dict[tuple[str, int], tuple[dict[str, RemoteUserListItem], bool, int | None, int]] = {}
            remote_list_untrusted_missing_access: set[tuple[str, int]] = set()
            remote_list_untrusted_direct_budget: dict[tuple[str, int], int] = {}
            for key, access_subs in by_access.items():
                node = nodes.get(access_subs[0].node_id)
                if not node or node.panel_type not in {PanelType.pasarguard, PanelType.marzban}:
                    continue
                adapter = adapters.get(key)
                if not adapter or not hasattr(adapter, "list_users"):
                    continue
                wanted = {remote_identifier(s.remote_identifier) for s in access_subs if remote_identifier(s.remote_identifier)}
                if not wanted:
                    continue
                try:
                    remote_items, exhausted, total, scanned = await _fetch_remote_user_list(adapter, wanted)
                    remote_list_by_access[key] = (remote_items, exhausted, total, scanned)
                    if exhausted:
                        missing_count = len(wanted - set(remote_items.keys()))
                        missing_threshold = max(50, int(len(wanted) * 0.05))
                        if missing_count > missing_threshold:
                            remote_list_untrusted_missing_access.add(key)
                            remote_list_untrusted_direct_budget[key] = 50
                            stats.remote_bulk_untrusted += 1
                            logger.warning(
                                "sync_usage remote bulk list marked untrusted access=%s node_id=%s local_remote_ids=%s found=%s missing=%s scanned=%s total=%s",
                                key,
                                node.id,
                                len(wanted),
                                len(remote_items),
                                missing_count,
                                scanned,
                                total,
                            )
                except Exception as e:
                    stats.remote_failures += len(access_subs)
                    if failure_log_budget > 0:
                        logger.warning(
                            "sync_usage remote bulk list failed access=%s node_id=%s local_users=%s err=%s",
                            key,
                            node.id,
                            len(access_subs),
                            str(e)[:220],
                        )
                        failure_log_budget -= 1

            for u in users:
                touched_reseller_ids.add(int(u.owner_reseller_id))
                u_subs = by_user.get(u.id, [])
                total_used = 0
                remote_success_count = 0

                # Sync usage from remote. If a node is temporarily unreachable,
                # keep the previous local usage snapshot for that subaccount.
                missing_subs = 0
                missing_sub_ids: set[int] = set()
                for s in u_subs:
                    effective_used = max(0, int(s.used_bytes or 0))
                    n = nodes.get(s.node_id)
                    if not n:
                        total_used += effective_used
                        continue
                    access_key = ("allocation", int(s.allocation_id)) if s.allocation_id and int(s.allocation_id) in allocations else ("node", int(s.node_id))
                    adapter = adapters.get(access_key)
                    if not adapter:
                        if n.panel_type == PanelType.wg_dashboard and access_key in wg_failed_access:
                            total_used += effective_used
                            continue
                        stats.remote_failures += 1
                        total_used += effective_used
                        continue
                    if n.panel_type == PanelType.wg_dashboard:
                        if access_key in wg_failed_access:
                            total_used += effective_used
                            continue
                        used = wg_usage_map_by_access.get(access_key, {}).get(str(s.remote_identifier or "").strip())
                        if used is None:
                            # Fallback for partial bulk misses (stale peer index / recent topology changes).
                            try:
                                used = await adapter.get_used_bytes(s.remote_identifier)
                            except Exception as e:
                                stats.remote_failures += 1
                                if failure_log_budget > 0:
                                    logger.warning(
                                        "sync_usage WG fallback fetch failed user_id=%s node_id=%s remote_identifier=%s err=%s",
                                        u.id,
                                        s.node_id,
                                        s.remote_identifier,
                                        str(e)[:220],
                                    )
                                    failure_log_budget -= 1
                                total_used += effective_used
                                continue
                            if used is None:
                                stats.remote_skipped += 1
                                total_used += effective_used
                                continue
                        effective_used = max(0, int(used))
                        s.used_bytes = effective_used
                        s.last_sync_at = now
                        clear_remote_missing(u, s)
                        _sync_create_status_meta(u, None, effective_used, now)
                        remote_success_count += 1
                        stats.remote_success += 1
                        total_used += effective_used
                        continue
                    bulk_result = remote_list_by_access.get(access_key)
                    if bulk_result is not None:
                        remote_items, remote_list_exhausted, _remote_total, _remote_scanned = bulk_result
                        remote_id = remote_identifier(s.remote_identifier)
                        remote_item = remote_items.get(remote_id)
                        if remote_item is not None:
                            effective_used = max(0, int(remote_item.used_bytes or 0))
                            s.used_bytes = effective_used
                            s.last_sync_at = now
                            if remote_item.direct_sub_url:
                                s.panel_sub_url_cached = remote_item.direct_sub_url
                                s.panel_sub_url_cached_at = now
                            clear_remote_missing(u, s)
                            _sync_create_status_meta(u, remote_item.status, effective_used, now)
                            remote_success_count += 1
                            stats.remote_success += 1
                            total_used += effective_used
                            continue
                        if remote_list_exhausted and access_key in remote_list_untrusted_missing_access:
                            direct_budget = int(remote_list_untrusted_direct_budget.get(access_key, 0))
                            if direct_budget <= 0:
                                stats.remote_skipped += 1
                                total_used += effective_used
                                continue
                            remote_list_untrusted_direct_budget[access_key] = direct_budget - 1
                    try:
                        remote_status = None
                        if hasattr(adapter, "get_user_snapshot"):
                            snapshot = await adapter.get_user_snapshot(s.remote_identifier)  # type: ignore[attr-defined]
                            used = snapshot.used_bytes
                            remote_status = snapshot.status
                        else:
                            used = await adapter.get_used_bytes(s.remote_identifier)
                        if used is None:
                            stats.remote_skipped += 1
                            total_used += effective_used
                            continue
                        effective_used = max(0, int(used))
                        s.used_bytes = effective_used
                        s.last_sync_at = now
                        clear_remote_missing(u, s)
                        _sync_create_status_meta(u, remote_status, effective_used, now)
                        remote_success_count += 1
                        stats.remote_success += 1
                        total_used += effective_used
                    except RemoteUserNotFound:
                        stats.remote_missing += 1
                        missing_count = mark_remote_missing(u, s, now, source="direct_404")
                        if missing_count < missing_confirmations:
                            stats.remote_missing_pending += 1
                            stats.remote_skipped += 1
                            total_used += effective_used
                            if failure_log_budget > 0:
                                logger.info(
                                    "sync_usage remote user missing pending user_id=%s node_id=%s remote_identifier=%s confirmation=%s/%s",
                                    u.id,
                                    s.node_id,
                                    s.remote_identifier,
                                    missing_count,
                                    missing_confirmations,
                                )
                                failure_log_budget -= 1
                            continue

                        missing_subs += 1
                        missing_sub_ids.add(s.id)
                        try:
                            await db.delete(s)
                        except Exception:
                            stats.errors += 1
                        if failure_log_budget > 0:
                            logger.info(
                                "sync_usage remote user missing confirmed user_id=%s node_id=%s remote_identifier=%s confirmations=%s",
                                u.id,
                                s.node_id,
                                s.remote_identifier,
                                missing_count,
                            )
                            failure_log_budget -= 1
                        continue
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

                if u_subs and missing_subs >= len(u_subs):
                    meta = u.meta if isinstance(u.meta, dict) else {}
                    u.status = UserStatus.deleted
                    u.meta = {
                        **meta,
                        "remote_deleted_at": now.isoformat(),
                        "remote_deleted_reason": "missing_in_panel",
                    }
                    stats.remote_deleted_users += 1
                    stats.affected_users += 1
                    continue

                u.used_bytes = int(total_used)
                if u_subs and missing_subs < len(u_subs) and remote_success_count == 0:
                    stats.users_with_stale_usage += 1

                if int(u.total_gb or 0) <= 0 or u.used_bytes < int(u.total_gb) * BYTES_PER_GB:
                    meta = u.meta if isinstance(u.meta, dict) else {}
                    if meta.get("volume_exhausted_at") or meta.get("volume_exhausted_policy"):
                        next_meta = dict(meta)
                        next_meta.pop("volume_exhausted_at", None)
                        next_meta.pop("volume_exhausted_policy", None)
                        u.meta = next_meta

                # Enforce volume exhaustion only when Guardino must coordinate
                # several remote accounts, or when the panel does not reliably
                # enforce quota by itself (WGDashboard). Single Marzban/PasarGuard
                # users stay active locally so reseller actions and subscription UI
                # remain usable while the upstream panel shows the quota limit.
                if int(u.total_gb or 0) > 0 and u.used_bytes >= int(u.total_gb) * BYTES_PER_GB and u.status == UserStatus.active:
                    enforce_subs = [s for s in u_subs if s.id not in missing_sub_ids]
                    enforce_nodes = [nodes.get(s.node_id) for s in enforce_subs if nodes.get(s.node_id)]
                    should_enforce_locally = len(enforce_subs) > 1 or any(n.panel_type == PanelType.wg_dashboard for n in enforce_nodes)
                    if not should_enforce_locally:
                        meta = u.meta if isinstance(u.meta, dict) else {}
                        if not meta.get("volume_exhausted_at"):
                            u.meta = {
                                **meta,
                                "volume_exhausted_at": now.isoformat(),
                                "volume_exhausted_policy": "upstream_single_node",
                            }
                        continue

                    u.status = UserStatus.disabled
                    stats.affected_users += 1
                    for s in enforce_subs:
                        if s.id in missing_sub_ids:
                            continue
                        n = nodes.get(s.node_id)
                        if not n:
                            continue
                        try:
                            access_key = ("allocation", int(s.allocation_id)) if s.allocation_id and int(s.allocation_id) in allocations else ("node", int(s.node_id))
                            adapter = adapters.get(access_key) or await get_adapter_for_subaccount(db, s, n, u)
                            await enforce_volume_exhausted(n.panel_type, adapter, s.remote_identifier)
                            stats.remote_actions += 1
                        except Exception:
                            stats.remote_failures += 1
                            continue

            await db.commit()
            try:
                await refresh_daily_metrics_for_resellers(db, touched_reseller_ids, metric_day=now.date(), now=now)
                await db.commit()
            except Exception as e:
                await db.rollback()
                logger.warning("sync_usage daily metrics refresh failed reseller_count=%s err=%s", len(touched_reseller_ids), str(e)[:220])
            last_id = next_last_id
            if len(users) < batch_size:
                break

        logger.info("sync_usage stats=%s", stats)
