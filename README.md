# Guardino Hub

> **Guardino Hub** is a **VPN reseller & billing panel** that connects to multiple upstream panels (**Marzban**, **PasarGuard**, **WGDashboard**) and lets you sell/manage VPN subscriptions through a single UI and a single set of business rules.

- **Backend:** FastAPI + Async SQLAlchemy + Alembic + JWT
- **Frontend:** Next.js (App Router) + Tailwind UI components
- **Infra:** Docker Compose (Postgres + Redis + Nginx)
- **Workers:** Celery (expiry + usage sync)

---

## Table of contents

- [What is this project?](#what-is-this-project)
- [Key concepts](#key-concepts)
- [Roles & permissions](#roles--permissions)
- [How subscriptions work](#how-subscriptions-work)
- [Billing & wallet system](#billing--wallet-system)
- [Integrations (Marzban / PasarGuard / WGDashboard)](#integrations-marzban--pasarguard--wgdashboard)
- [Installation](#installation)
- [Configuration](#configuration)
- [Operations & troubleshooting](#operations--troubleshooting)
- [Project structure (for developers)](#project-structure-for-developers)
- [AI maintenance guide](#ai-maintenance-guide)
- [فارسی](#فارسی)

---

## What is this project?

Guardino Hub is designed for **VPN businesses** that have:
- multiple upstream panels (different servers / different technologies),
- multiple sales levels (admin → reseller → sub-reseller),
- and need **consistent pricing, wallet control, refunds, and reporting**.

### What it does
- Admin defines **Nodes** (each node = one upstream panel endpoint).
- Admin allocates nodes to resellers via **Allocations** (and can override per-node price).
- Resellers create **Users** across one or more nodes.
- Guardino stores a **master subscription token** per user and can:
  - show **direct panel subscription links** (per node), and/or
  - provide a **Guardino master subscription link** that merges all node subscriptions into one.

### What it is NOT
- It is not a VPN protocol implementation itself.
- It does not replace upstream panels; it orchestrates them.

---

## Key concepts

### Node
A **Node** represents a single upstream panel and connection details:
- `panel_type`: `marzban` | `pasarguard` | `wg_dashboard`
- `base_url`
- `credentials` (token or username/password or api key)
- `tags` (used for grouping / filtering / auto-selection)
- `is_enabled`, `is_visible_in_sub`

**Model:** `backend/app/models/node.py`

### Reseller (and Sub-reseller)
A **Reseller** is an account that can sell subscriptions.  
It can have a parent reseller (`parent_id`) → sub-reseller hierarchy.

**Model:** `backend/app/models/reseller.py`

### Allocation
An **Allocation** links a reseller to a node:
- whether it is enabled,
- whether the node is default for the reseller,
- optional `price_per_gb_override`.

**Model:** `backend/app/models/node_allocation.py`

### Guardino User
A **Guardino User** is your product subscription object:
- `total_gb`, `used_bytes`, `expire_at`, `status`
- `master_sub_token` (for merged sub link)
- selection mode:
  - `manual`: chosen node ids stored via SubAccounts
  - `group`: auto-expand nodes by tag (`node_group`) (advanced feature)

**Model:** `backend/app/models/user.py`

### SubAccount
A **SubAccount** is the per-node provisioning record:
- mapping between Guardino User and Node,
- stores `remote_identifier` on that panel,
- caches direct subscription URL when available.

**Model:** `backend/app/models/subaccount.py`

---

## Roles & permissions

Roles are currently:
- `admin`
- `reseller`

Resellers may still form a hierarchy using `parent_id`.

**RBAC:** `backend/app/core/rbac.py`  
**Auth:** `backend/app/api/v1/routes/auth.py`

---

## How subscriptions work

### Direct (panel) subscription links
For each SubAccount, Guardino can show a **direct link** returned by the upstream panel (or derived using panel API).

### Guardino master subscription link (merged)
Guardino exposes:

- `GET /api/v1/sub/{token}`

It:
1. finds the Guardino user by token,
2. fetches per-node subscription content,
3. merges them into a single subscription output (Base64 where needed).

Code: `backend/app/api/v1/routes/public_sub.py` + `backend/app/services/subscription_merge.py`

> **Security note:** the master token is a bearer secret. Treat it like a password.

---

## Billing & wallet system

### What exists today
- Each reseller has a **wallet balance**.
- Guardino records:
  - **Orders** (`create`, `add_traffic`, `extend`, `change_nodes`, `refund`, `delete`)
  - **LedgerTransactions** for wallet adjustments (positive/negative).

Models:
- `backend/app/models/order.py`
- `backend/app/models/ledger.py`

### Pricing modes
Guardino supports two conceptual modes in pricing logic:
- **Per-node**: charge per GB per selected node (supports allocation overrides)
- **Bundle**: charge once per GB for all selected nodes (optional `bundle_price_per_gb` on reseller)

Implementation: `backend/app/services/pricing.py`

### Refund policy (current default)
- window: `REFUND_WINDOW_DAYS` (default 10)
- based on remaining volume only

Config: `backend/app/core/config.py`

### Anti-fraud / safety recommendations (roadmap)
If you run large resellers, implement these to reduce abuse:
- atomic balance deduction (row lock / conditional update),
- idempotency keys for paid actions,
- provisioning after confirmed charge (or outbox worker),
- charging for group-mode auto-provision,
- deprovision on remove/delete,
- rate limits on create/extend/sub endpoints.

---

## Integrations (Marzban / PasarGuard / WGDashboard)

### Important: official API specs (source of truth)

This repo includes the **official API reference files** used when updating adapters:

- `docs/openapi/MarzbanAPI.json`
- `docs/openapi/PasarGuardAPI.json`
- `docs/openapi/WGDashboard.postman_collection.v4.3.0.json`

When you update adapters, treat these specs as **authoritative**.

### Default rule for user creation (Guardino policy)
When creating a user on **Marzban** or **PasarGuard**:
- fetch inbounds/proxies from the panel API,
- enable **ALL** active proxy types and **ALL** inbounds by default.

This is implemented in:
- `backend/app/services/adapters/marzban.py`
- `backend/app/services/adapters/pasarguard.py`

#### Marzban notes
Credentials supported:
- `{"token":"..."}` (recommended), OR
- `{"username":"...","password":"..."}` (Guardino will login to obtain a token)

Inbound/proxy default selection:
- Guardino calls `GET /api/inbounds` and builds `inbounds` + `proxies` fields for user creation.

#### PasarGuard notes
Credentials supported:
- `{"token":"..."}` OR `{"username":"...","password":"..."}`

Inbound default selection:
- Guardino calls `GET /api/inbounds` and ensures a Group named `guardino_all_inbounds` exists including all inbound tags.
- On user creation, Guardino sets `group_ids=[<group_id>]`.

Template fallback:
- If `POST /api/user` fails, Guardino can fall back to `POST /api/user/from_template` and then applies limits using `PUT /api/user/{username}`.

#### WGDashboard notes
Credentials:
- `{"apikey":"..."}` sent as header `wg-dashboard-apikey`
- plus `{"config":"wg0"}` (WireGuard config name) in credentials

Revoke behavior (Guardino policy):
- **Delete & recreate peer** (link changes).

---

## Installation

### Option A — Docker Compose (manual)

1) Copy `.env.example` to `.env` and edit it.
2) Start:

```bash
docker compose up -d --build
```

3) Run migrations and create superadmin:

```bash
docker compose exec api bash -lc "alembic upgrade head"
docker compose exec api bash -lc "python -m app.cli create-superadmin"
```

### Option B — Remote installer (recommended for fresh Ubuntu)

```bash
bash <(curl -Ls --ipv4 https://raw.githubusercontent.com/Sir-Adnan/guardino-hub/main/installer/guardino.sh)
```

What it does (high level):
- installs Docker,
- prepares `.env`,
- starts the stack,
- runs migrations,
- creates superadmin and prints credentials.

Optional overrides:

```bash
INSTALL_DIR=/opt/guardino-hub BRANCH=main \
bash <(curl -Ls --ipv4 https://raw.githubusercontent.com/Sir-Adnan/guardino-hub/main/installer/guardino.sh)
```

### Option C — Local installer (from a checked-out source tree)

```bash
sudo bash installer/install.sh
```

---

## Configuration

Main environment variables (see `.env.example`):

- `DATABASE_URL`
- `REDIS_URL`
- `SECRET_KEY`
- `PANEL_TLS_VERIFY`
- `HTTP_TIMEOUT_SECONDS`
- `REFUND_WINDOW_DAYS`
- `CORS_ORIGINS`

Frontend:
- `NEXT_PUBLIC_API_BASE` (optional for local dev)

### Guardino API Docs

After deployment behind Nginx, Guardino's OpenAPI docs are available at:

- `GET /docs`
- `GET /openapi.json`

Compatibility aliases are also available:

- `GET /api/docs`
- `GET /api/openapi.json`
- `GET /redoc` and `GET /api/redoc`

---

## Operations & troubleshooting

### “Node test connection” fails
- verify `base_url` (include scheme `http(s)://`),
- verify credentials,
- check `PANEL_TLS_VERIFY` for self-signed certs (dev only).

### Users show no panel subscription URL
- some panels require a “subscription URL” field to be enabled per user,
- Guardino caches direct links in `SubAccount.panel_sub_url_cached`.

### Master subscription returns empty
- check that SubAccounts exist,
- check nodes are enabled + visible,
- check upstream panel is reachable.

### Celery workers not running
- verify `worker` and `beat` services in compose are healthy,
- verify Redis connectivity.

---

## Project structure for developers

```
backend/
  app/
    api/v1/routes/         # FastAPI routes (admin/reseller/public)
    core/                  # settings, db, auth, celery
    models/                # SQLAlchemy models
    schemas/               # Pydantic schemas
    services/
      adapters/            # Marzban / PasarGuard / WGDashboard integrations
      pricing.py           # pricing + node resolution
      subscription_merge.py
      ...
frontend/
  src/
    app/                   # Next.js pages (admin/users/nodes)
    components/            # UI components (modal, dropdown, toasts, ...)
    lib/                   # apiFetch, auth, i18n, storage
installer/                 # one-click install scripts
deploy/nginx.conf          # reverse proxy for /api and web
docs/openapi/              # official upstream API specs (source of truth)
```

---

## AI maintenance guide

This section is written so an AI (or a new developer) can quickly understand and safely modify the project.

### Golden rules
1) **Adapters must follow official specs** in `docs/openapi/*` (do not guess endpoints).
2) **Do not change pricing/billing without updating:**
   - `services/pricing.py`
   - reseller schemas (`schemas/admin.py`, etc.)
   - admin reports routes
3) Whenever you add a new UI field:
   - update i18n keys (FA/EN),
   - add a tooltip (HelpTip) if it might be confusing.
4) Prefer **small, incremental changes** and keep backward compatibility.

### Common tasks & where to edit

#### Add a new panel type
1) Add enum to `models/node.py`
2) Implement adapter in `services/adapters/`
3) Register in `services/adapters/factory.py`
4) Update Admin Nodes UI dropdown (`frontend/src/app/app/admin/nodes/page.tsx`)
5) Document required credentials in README

#### Change default inbounds/proxies selection
- Marzban: edit `_get_active_inbounds()` and `provision_user()` in `adapters/marzban.py`
- PasarGuard: edit `_ensure_all_inbounds_group_id()` and `provision_user()` in `adapters/pasarguard.py`

#### Add a new user action (Reset/Revoke/etc.)
- Backend: `api/v1/routes/reseller_ops.py`
- Frontend:
  - `frontend/src/app/app/users/page.tsx` (list actions)
  - `frontend/src/app/app/users/[id]/page.tsx` (detail actions)

#### Add new admin reports
- Backend: `api/v1/routes/admin_reports.py`
- Frontend: `frontend/src/app/app/admin/reports/*`

### Release checklist
- `alembic revision` if DB changes were made
- update README and (optionally) add a changelog entry
- ensure installer still works on fresh Ubuntu
- smoke test: login, create node, allocate, create user, open links

---

# فارسی

این بخش همان توضیحات بالاست ولی به فارسی و با جزئیات بیشتر.

## هدف پروژه
Guardino Hub یک «پنل فروش و مدیریت اشتراک VPN» است که چند پنل/سرور مختلف را (مثل **Marzban** و **PasarGuard** و **WGDashboard**) زیر یک سیستم واحد برای **ادمین، ریسیلر و زیرریسیلر** قرار می‌دهد.

### Guardino چه مشکلی را حل می‌کند؟
- اگر چند سرور دارید (یا چند نوع پنل مختلف)، دیگر لازم نیست برای هر کدام پنل جدا بدهید.
- اگر چند سطح فروش دارید (عمده‌فروش/ریسیلر/زیرمجموعه)، Guardino کنترل مالی و تخصیص منابع را یکجا انجام می‌دهد.
- لینک اشتراک‌ها را **از پنل مرجع** می‌گیرد و همچنین یک لینک **Master** می‌سازد که اشتراک‌های چند نود را با هم merge می‌کند.

---

## مفاهیم اصلی (ریز به ریز)

### 1) Node (نود)
هر نود یعنی یک پنل مرجع:
- نوع پنل: `marzban` یا `pasarguard` یا `wg_dashboard`
- آدرس پنل: `base_url`
- اطلاعات ورود: `credentials`
- تگ‌ها: `tags` (برای دسته‌بندی و انتخاب سریع)
- فعال/غیرفعال بودن: `is_enabled`
- نمایش در Master Sub: `is_visible_in_sub`

**فایل:** `backend/app/models/node.py`

### 2) Reseller (ریسیلر) و Sub-Reseller (زیرمجموعه)
ریسیلر:
- `balance` (کیف پول)
- قیمت‌ها (مثل price_per_gb و bundle_price_per_gb)
- می‌تواند زیرمجموعه داشته باشد (`parent_id`)
- می‌تواند اجازه ساخت زیرمجموعه داشته باشد (`can_create_subreseller`)

**فایل:** `backend/app/models/reseller.py`

### 3) Allocation (تخصیص نود)
ادمین تعیین می‌کند هر ریسیلر به کدام نودها دسترسی دارد:
- `enabled`
- `default_for_reseller`
- `price_per_gb_override`

**فایل:** `backend/app/models/node_allocation.py`

### 4) User (یوزر Guardino)
یوزر در Guardino یعنی «اشتراک قابل فروش»:
- حجم کل (GB)
- مصرف (bytes)
- تاریخ انقضا
- وضعیت (active/disabled/…)
- توکن لینک master (`master_sub_token`)
- حالت انتخاب نود:
  - manual (انتخاب دستی)
  - group (افزودن خودکار نودها بر اساس tag)

**فایل:** `backend/app/models/user.py`

### 5) SubAccount (حساب زیرمجموعه روی هر نود)
برای هر نودی که یوزر روی آن ساخته می‌شود:
- `remote_identifier` (نام کاربر/شناسه روی پنل مرجع)
- `panel_sub_url_cached` (لینک اشتراک مستقیم از پنل مرجع)

**فایل:** `backend/app/models/subaccount.py`

---

## ساخت کاربر و انتخاب inbounds/proxies (نکته‌ی مهم شما)

طبق سیاست Guardino:
- در **Marzban** و **PasarGuard** هنگام ساخت کاربر:
  - اطلاعات `inbounds` و نوع پروکسی‌ها از API پنل **دریافت می‌شود**
  - و به صورت پیش‌فرض **همه‌ی inboundها و همه‌ی پروکسی‌های فعال روشن می‌شوند**

### Marzban
- Guardino از `GET /api/inbounds` می‌خواند و برای `POST /api/user` مقدارهای `inbounds` و `proxies` را کامل می‌گذارد.
- اگر گرفتن inbounds خطا بدهد، Guardino به default خود پنل fallback می‌کند.

### PasarGuard
- Guardino از `GET /api/inbounds` لیست tagها را می‌گیرد
- یک group با نام `guardino_all_inbounds` می‌سازد/آپدیت می‌کند که همه inboundها داخلش باشد
- موقع ساخت یوزر `group_ids` همین group ست می‌شود

---

## لینک‌ها (Direct + Master)

### 1) لینک مستقیم پنل
برای هر نود یک لینک مستقیم (از پنل مرجع) نمایش داده می‌شود.

### 2) لینک Master Guardino
Guardino یک لینک می‌سازد:

`/api/v1/sub/{token}`

این لینک محتوای اشتراک چند نود را fetch می‌کند و merge می‌کند.

---

## راهنمای سریع کار با پنل (Workflow واقعی)

1) ورود با ادمین
2) ساخت Nodeها (Marzban/PasarGuard/WGDashboard)
3) تست اتصال هر نود
4) ساخت Reseller
5) تخصیص Nodeها به Reseller (Allocations)
6) ورود با Reseller و ساخت User
7) دادن لینک‌ها:
   - لینک‌های مستقیم پنل
   - لینک master

---

## برای AIها / توسعه‌دهندگان جدید (خلاصه مسیرها)

- Backend routes: `backend/app/api/v1/routes/`
- Adapters: `backend/app/services/adapters/`
- Pricing: `backend/app/services/pricing.py`
- UI pages: `frontend/src/app/app/`
- i18n: `frontend/src/lib/i18n.ts` و context مربوطه
- Tooltip: کامپوننت HelpTip در `frontend/src/components/`

---

## Snapshot قابلیت‌ها (آخرین بروزرسانی: 2026-02-23)
- UI دو زبانه (FA/EN) + RTL/LTR
- کارت کاربران + progress مصرف + منوی اکشن‌ها
- Admin CRUD برای Nodes/Resellers/Allocations
- Master subscription merge
- انتخاب پیش‌فرض همه inbounds/proxies در Marzban/PasarGuard
- Revoke در WGDashboard: delete & recreate peer
