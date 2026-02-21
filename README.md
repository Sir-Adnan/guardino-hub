# Guardino Hub

Guardino Hub is a **VPN reseller panel** that aggregates multiple backends (Marzban / Pasarguard / WGDashboard) under one billing + reseller hierarchy.

## Key features
- **Super Admin** creates resellers, charges wallets manually, manages nodes and allocations.
- **Resellers** create users across one or multiple nodes/panels, and deliver:
  - **Direct panel subscription links** (preferred)
  - **Master subscription link** (merged, auto-updating)
- Pricing modes:
  - **Per-node**: price per GB is charged for each selected node (supports per-node override)
  - **Bundle**: central price per GB is charged once for all selected nodes (optional `bundle_price_per_gb`)
- Refund policy:
  - **10 days window**
  - **Remaining volume only** (GB)
- Enforcement:
  - If reseller balance `<= 0` → **all actions blocked** except **listing users**
  - Time expiry enforced by worker:
    - Marzban/Pasarguard: **disable only** (keeps subscription URL stable)
    - WGDashboard: **delete peer** (hard cut)
  - Volume exhaustion:
    - Marzban/Pasarguard: **disable**
    - WGDashboard: **restrict (schedule job)**
- Workers:
  - Time expiry (every minute)
  - Usage sync for Marzban/Pasarguard (every 5 minutes)
  - Redis locks prevent overlaps

---

## Quick install (one-liner) — Ubuntu (fresh server)
> This assumes a completely fresh Ubuntu server (22/24) with root/sudo.

```bash
bash <(curl -Ls --ipv4 https://raw.githubusercontent.com/Sir-Adnan/guardino-hub/main/installer/guardino.sh)
```

At the end, the installer prints your **superadmin username/password**.

### What the installer does
1. Installs Docker + Compose plugin
2. Clones this repo into `/opt/guardino-hub`
3. Generates `.env` (SECRET_KEY + DB password)
4. Builds and starts services (db, redis, api, workers, frontend, nginx)
5. Runs migrations
6. Creates superadmin (random password)

---

## Manual install (if you prefer)
```bash
sudo apt update -y
sudo apt install -y git
git clone https://github.com/Sir-Adnan/guardino-hub.git /opt/guardino-hub
cd /opt/guardino-hub

cp .env.example .env
# edit .env to set CORS_ORIGINS, DOMAIN, ADMIN_EMAIL (optional)

docker compose up -d --build
docker compose exec -T api alembic upgrade head
docker compose exec -T api python -m app.cli create-superadmin --username admin --password 'CHANGE_ME'
```

Open:
- UI: `http://SERVER_IP/`
- API docs: `http://SERVER_IP/api/docs`

---

## HTTPS (optional, recommended)
We provide an optional Caddy setup for automatic Let's Encrypt.

1) Set these in `.env`:
- `DOMAIN=yourdomain.com`
- `ADMIN_EMAIL=you@example.com`

2) Start https stack:
```bash
docker compose -f docker-compose.yml -f deploy/docker-compose.https.yml up -d --build
```

---

## Backup & Restore

### Backup
```bash
bash deploy/backup.sh /opt/guardino-hub /opt/guardino-hub/backups
```

### Restore
```bash
bash deploy/restore.sh /opt/guardino-hub /opt/guardino-hub/backups/db_XXXX.sql
```

---

## Operations overview

### Admin (UI)
- `/app/admin/resellers`: create resellers + credit
- `/app/admin/nodes`: create nodes + test connection + disable (soft)
- `/app/admin/allocations`: assign nodes to resellers, mark default nodes, set per-node price override

### Reseller (UI)
- `/app/users`: list users
- `/app/users/new`: create user wizard (random username, packages, per-node/bundle pricing)
- `/app/users/{id}`: links + operations

### API essentials
- Auth: `POST /api/v1/auth/login`
- List reseller users: `GET /api/v1/reseller/users`
- Quote: `POST /api/v1/reseller/user-ops/quote`
- Create: `POST /api/v1/reseller/user-ops`
- Links: `GET /api/v1/reseller/users/{id}/links?refresh=true`
- Master sub: `GET /api/v1/sub/{token}`

---

## Node credentials examples

### Marzban / Pasarguard
```json
{ "username": "admin", "password": "YOUR_PASS" }
```

### WGDashboard
```json
{
  "apikey": "YOUR_API_KEY",
  "configuration": "wg-external",
  "ip_prefix": "10.29.1.",
  "ip_start": 2,
  "ip_end": 254,
  "dns": "1.1.1.1",
  "mtu": 1460,
  "keep_alive": 21,
  "endpoint_allowed_ip": "0.0.0.0/0"
}
```

---

## Upgrading
```bash
cd /opt/guardino-hub
git pull
docker compose up -d --build
docker compose exec -T api alembic upgrade head
```

---

## Security notes
- Never commit `.env`
- Keep your admin passwords private
- Consider enabling HTTPS in production
- Keep Docker and OS updated

---

## Roadmap (next steps)
- Full Admin reporting: ledger/orders pages
- Reseller node list endpoint (only allowed nodes)
- Better WG usage reporting (if available)
- UI polish: node picker, charts, tables, pagination


## Step 21: UI polish + admin reports + role-based sidebar
- `/api/v1/auth/me` for role/balance
- Reseller nodes endpoint for proper node picker
- Admin reports endpoints + UI pages (ledger/orders)
