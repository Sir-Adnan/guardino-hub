# Guardino Hub (starter scaffold)

This is a starter scaffold for **Guardino Hub** (VPN reseller panel + multi-panel adapters: Marzban / Pasarguard / WGDashboard).

## What is included (MVP scaffold)
- FastAPI backend (async) + SQLAlchemy + Alembic
- Core domain models: Reseller, Node, NodeAllocation, GuardinoUser, SubAccount, Order, LedgerTransaction
- Auth (JWT) + RBAC (admin/reseller)
- Business rule enforced:
  - If a reseller `balance == 0` (or below), **all actions are blocked** except **listing users**.
- Node delete is **soft delete** (no changes are pushed to Marzban/Pasarguard/WG DBs).
- Docker compose (api + worker placeholders + postgres + redis)
- Installer script skeleton (`installer/install.sh`) for a clean server

## Quick start (dev)
```bash
cp .env.example .env
docker compose up -d --build
docker compose exec api alembic upgrade head
docker compose exec api python -m app.cli create-superadmin --username admin --password 'ChangeMe_123!'
```
API docs: http://localhost:8000/docs

## Repo layout
- `backend/` FastAPI app
- `installer/` one-shot install script skeleton (production)
- `deploy/` compose & nginx templates

> NOTE: This is a scaffold. Adapters for Marzban/Pasarguard/WGDashboard are stubbed and will be filled based on official API specs.


## Admin node connection test
Use `POST /api/v1/admin/nodes/{id}/test-connection` to verify credentials and reachability (no changes are applied to panel DB).


## Step 4 (WIP): Reseller user creation (mock provisioning)
- POST /api/v1/reseller/user-ops/quote
- POST /api/v1/reseller/user-ops
Adapters provision is mock-only for now: set `node.credentials.mock=true`.


## Step 5: Real provisioning via panel APIs
- Marzban/Pasarguard: POST /api/user (Bearer token)
- WGDashboard: POST /api/addPeers/{configuration} + POST /api/sharePeer/create


## Step 6: Links + Master subscription
- GET /api/v1/reseller/users/{id}/links?refresh=true
- GET /api/v1/sub/{token} (public)


## Step 7: User lifecycle ops + refund policy
- POST /api/v1/reseller/users/{id}/extend
- POST /api/v1/reseller/users/{id}/add-traffic
- POST /api/v1/reseller/users/{id}/change-nodes
- POST /api/v1/reseller/users/{id}/refund  (10 days, remaining GB only)


### Pricing modes
- per_node (default): price per GB is applied for each selected node
- bundle: a central price per GB is applied once for all selected nodes (uses reseller.bundle_price_per_gb if set; otherwise reseller.price_per_gb)

### Remote updates
On extend/add-traffic/refund/delete we also update/delete on remote panels (best-effort).


## Step 9: Expiry worker (Celery Beat)
A periodic task marks due users as disabled and enforces expiry on remote panels (including WGDashboard) by deleting/restricting peers.


## Step 10: Usage sync worker
A periodic task syncs `used_traffic` from Marzban/Pasarguard and disables users when volume is exhausted. WGDashboard volume is enforced by its schedule job; used bytes may remain unknown.


## Step 11: Expiry policy change
- Marzban/Pasarguard: on time expiry -> disable (no revoke_sub, no delete)
- WGDashboard: on time expiry -> delete peer
- On extend/add-traffic: best-effort enable user again


## Step 12: Central status policy
Introduced `app.services.status_policy` to standardize how Guardino maps and enforces statuses across panels.


## Step 13: Worker reliability
- Added Redis locks to prevent overlapping task runs
- Added basic task run stats counters


## Step 14: Frontend UI scaffold
- Next.js (App Router) + RTL + light/dark + accent picker
- Pages: /login, /app (dashboard), /app/users, /app/settings


## Step 15: Reseller UI
- Create user wizard
- User detail: links + ops
