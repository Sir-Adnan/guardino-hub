import argparse
import asyncio
from sqlalchemy import select
from app.core.db import AsyncSessionLocal
from app.core.security import hash_password
from app.models.node import Node, PanelType
from app.models.reseller import Reseller
from app.models.subaccount import SubAccount
from app.models.user import GuardinoUser, UserStatus
from app.services.adapters.factory import get_adapter

async def create_superadmin(username: str, password: str):
    async with AsyncSessionLocal() as db:
        q = await db.execute(select(Reseller).where(Reseller.username == username))
        if q.scalar_one_or_none():
            raise SystemExit("User already exists")
        admin = Reseller(
            parent_id=None,
            username=username,
            password_hash=hash_password(password),
            balance=0,
            price_per_gb=0,
            price_per_day=0,
            role="admin",
        )
        db.add(admin)
        await db.commit()
        print("Created superadmin:", username)


async def reconcile_wg_jobs(batch_size: int = 500, include_inactive: bool = False, dry_run: bool = False):
    """Resync WGDashboard peer jobs/limits from Guardino source of truth."""
    scanned = 0
    synced = 0
    failed = 0
    skipped = 0
    last_sub_id = 0
    error_budget = 30

    async with AsyncSessionLocal() as db:
        while True:
            q = await db.execute(
                select(SubAccount, GuardinoUser, Node)
                .join(GuardinoUser, GuardinoUser.id == SubAccount.user_id)
                .join(Node, Node.id == SubAccount.node_id)
                .where(
                    Node.panel_type == PanelType.wg_dashboard,
                    SubAccount.id > last_sub_id,
                )
                .order_by(SubAccount.id.asc())
                .limit(max(50, min(5000, int(batch_size or 500))))
            )
            rows = q.all()
            if not rows:
                break

            adapters: dict[int, object] = {}
            for sub, user, node in rows:
                scanned += 1

                if user.status == UserStatus.deleted:
                    skipped += 1
                    continue
                if (not include_inactive) and user.status != UserStatus.active:
                    skipped += 1
                    continue

                adapter = adapters.get(node.id)
                if adapter is None:
                    try:
                        adapter = get_adapter(node)
                    except Exception as e:
                        failed += 1
                        if error_budget > 0:
                            print(f"[ERR] adapter init failed node_id={node.id}: {e}")
                            error_budget -= 1
                        continue
                    adapters[node.id] = adapter

                if dry_run:
                    synced += 1
                    continue

                try:
                    await adapter.update_user_limits(sub.remote_identifier, int(user.total_gb), user.expire_at)
                    if user.status == UserStatus.active:
                        await adapter.enable_user(sub.remote_identifier)
                    else:
                        await adapter.disable_user(sub.remote_identifier)
                    synced += 1
                except Exception as e:
                    failed += 1
                    if error_budget > 0:
                        print(
                            "[ERR] wg reconcile failed "
                            f"sub_id={sub.id} user_id={user.id} node_id={node.id} remote_id={sub.remote_identifier}: {e}"
                        )
                        error_budget -= 1

            last_sub_id = rows[-1][0].id
            if len(rows) < max(50, min(5000, int(batch_size or 500))):
                break

    mode = "DRY-RUN" if dry_run else "APPLIED"
    print(
        f"[WG-RECONCILE:{mode}] scanned={scanned} synced={synced} "
        f"failed={failed} skipped={skipped}"
    )


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd")

    c = sub.add_parser("create-superadmin")
    c.add_argument("--username", required=True)
    c.add_argument("--password", required=True)

    r = sub.add_parser("reconcile-wg")
    r.add_argument("--batch-size", type=int, default=500)
    r.add_argument("--include-inactive", action="store_true")
    r.add_argument("--dry-run", action="store_true")

    args = parser.parse_args()
    if args.cmd == "create-superadmin":
        asyncio.run(create_superadmin(args.username, args.password))
    elif args.cmd == "reconcile-wg":
        asyncio.run(
            reconcile_wg_jobs(
                batch_size=args.batch_size,
                include_inactive=args.include_inactive,
                dry_run=args.dry_run,
            )
        )
    else:
        parser.print_help()

if __name__ == "__main__":
    main()
