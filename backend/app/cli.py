import argparse
import asyncio
from sqlalchemy import select
from app.core.db import AsyncSessionLocal
from app.core.security import hash_password
from app.models.reseller import Reseller

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
            price_per_day=None,
        )
        db.add(admin)
        await db.commit()
        print("Created superadmin:", username)

def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd")

    c = sub.add_parser("create-superadmin")
    c.add_argument("--username", required=True)
    c.add_argument("--password", required=True)

    args = parser.parse_args()
    if args.cmd == "create-superadmin":
        asyncio.run(create_superadmin(args.username, args.password))
    else:
        parser.print_help()

if __name__ == "__main__":
    main()
