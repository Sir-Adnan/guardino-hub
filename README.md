# Guardino Hub 🚀

Guardino Hub is a **multi-panel VPN reseller and billing platform**.
It gives you one central control plane for users, traffic, expiry, wallet, reports, and subscription delivery across:

- Marzban
- PasarGuard
- WGDashboard

Repository: `https://github.com/Sir-Adnan/guardino-hub`  
Publisher profile: `https://github.com/Sir-Adnan/`

---

## ✨ Why Guardino Exists

Most VPN businesses run multiple nodes and multiple panel types. This creates operational chaos:

- different panel APIs
- inconsistent billing behavior
- manual user lifecycle actions
- weak backup/restore/migration routines

Guardino solves this by acting as an orchestration + business layer above upstream panels.

---

## 🧠 Core Capabilities

- 👥 Admin + Reseller workflow
- 💳 Wallet-based billing and ledger records
- 📦 User lifecycle: create / extend / add traffic / revoke / refund
- 🔗 Central subscription link plus node-level direct links
- 📊 Reporting for orders and wallet activity
- 🔄 Background sync for usage + expiry
- 🔌 Adapter architecture for multiple upstream panel APIs
- 🧰 Production installer/update/management scripts
- 💾 Professional backup/restore with migration support
- 🤖 Telegram backup delivery (scheduled uploads)

---

## 🏗️ Stack

- **Backend:** FastAPI, SQLAlchemy Async, Alembic, Celery, Redis
- **Frontend:** Next.js (App Router), Tailwind CSS
- **Infra:** Docker Compose, PostgreSQL, Nginx
- **Workers:** Celery worker + beat

---

## ⚡ Quick Start (Recommended)

## 1) Remote manager (fresh VPS)

```bash
bash <(curl -Ls --ipv4 https://raw.githubusercontent.com/Sir-Adnan/guardino-hub/main/installer/guardino.sh)
```

This opens the interactive manager menu.

## 2) Install from menu

Choose `Install Panel`.

## 3) Open panel

- Panel URL: `http://<server-ip-or-domain>/`
- API docs: `http://<server-ip-or-domain>/docs`

---

## 🛠️ Installation Modes

## A) Remote Manager (recommended)

```bash
bash <(curl -Ls --ipv4 https://raw.githubusercontent.com/Sir-Adnan/guardino-hub/main/installer/guardino.sh)
```

Optional overrides:

```bash
INSTALL_DIR=/opt/guardino-hub BRANCH=main \
bash <(curl -Ls --ipv4 https://raw.githubusercontent.com/Sir-Adnan/guardino-hub/main/installer/guardino.sh)
```

## B) Local source manager

```bash
sudo bash installer/manage.sh
```

## C) Direct installer (non-menu)

```bash
sudo bash installer/install.sh
```

## D) Update existing deployment

```bash
sudo bash installer/update.sh
```

---

## 🧭 Management Console

Main script:

- `installer/manage.sh`

Menu includes:

- Install panel
- Update panel
- Status
- Logs
- Backup now
- Telegram backup setup (full / lite)
- Local backup schedule
- Restore backup
- Disable backup jobs
- Uninstall

### Non-interactive commands

```bash
sudo bash installer/manage.sh --install
sudo bash installer/manage.sh --update
sudo bash installer/manage.sh --status
sudo bash installer/manage.sh --logs

sudo bash installer/manage.sh --backup-now
sudo bash installer/manage.sh --backup-now --backup-mode essential

sudo bash installer/manage.sh --setup-telegram-full
sudo bash installer/manage.sh --setup-telegram-lite

sudo bash installer/manage.sh --restore /path/to/guardino_backup_YYYYmmddTHHMMSSZ.tar.gz
sudo bash installer/manage.sh --disable-backup
```

---

## 💾 Backup & Restore (Professional)

Guardino now supports migration-grade backup archives:

- format: `guardino_backup_YYYYmmddTHHMMSSZ.tar.gz`
- default path: `<INSTALL_DIR>/backups`

### Backup content

**Full mode** includes:

- PostgreSQL DB dump (`db.sql.gz`)
- PostgreSQL globals dump (`globals.sql.gz`)
- `.env`
- `docker-compose.yml`
- SSL-related config (`deploy/docker-compose.ssl.yml`, `deploy/nginx.conf`)
- `deploy/certbot` folder (if present)
- `/etc/letsencrypt` + `/var/lib/letsencrypt` archive (if present)
- manifest metadata

**Essential mode** includes:

- DB + core config files
- excludes heavy TLS archives for lighter backup delivery

### Telegram backup upload 🤖

From menu:

- `Setup TG (Full)`
- `Setup TG (Lite)`

Flow:

1. Enter bot token
2. Enter chat ID
3. Verify Telegram connection
4. Choose schedule (30 min / every X hours / daily)
5. Auto-test backup + upload

Config file is stored at:

- `/etc/guardino-hub/telegram-backup.env`

Cron wrapper path:

- `/usr/local/bin/guardino-hub-backup.sh`

### Restore behavior

Restore process:

- validates backup structure
- stops stack
- restores config files
- resets DB volume where needed
- recreates database and imports dump
- starts full stack
- runs Alembic migrations

> ⚠️ Restore overwrites current state. Use only with confirmed backup.

---

## 🔗 API Docs

After deployment:

- `GET /docs`
- `GET /openapi.json`
- `GET /redoc`

Compatibility aliases behind Nginx:

- `GET /api/docs`
- `GET /api/openapi.json`
- `GET /api/redoc`

Health endpoint:

- `GET /health`

---

## 🔌 Upstream Panel Integrations

Official references in repo:

- `docs/openapi/MarzbanAPI.json`
- `docs/openapi/PasarGuardAPI.json`
- `docs/openapi/WGDashboard.postman_collection.v4.3.0.json`

Adapter implementations:

- `backend/app/services/adapters/marzban.py`
- `backend/app/services/adapters/pasarguard.py`
- `backend/app/services/adapters/wg_dashboard.py`

---

## 📈 Scale Notes (High User Count)

For large deployments (100k+ users total):

- usage and expiry tasks are batch-based
- sync intervals are environment-controlled
- worker/beat run independently under compose restart policies
- remote panel failures are isolated as much as possible from local accounting state

Important env variables:

- `USAGE_SYNC_SECONDS`
- `EXPIRY_SYNC_SECONDS`
- `USAGE_SYNC_BATCH_SIZE`
- `EXPIRY_SYNC_BATCH_SIZE`
- `HTTP_TIMEOUT_SECONDS`

---

## 🔐 Security Notes

- Treat subscription tokens as secrets
- Keep `.env` private and backed up securely
- Rotate credentials after suspected leakage
- Use TLS in production
- Limit node access by network policy/firewall
- Avoid exposing upstream panel admin endpoints to public internet

---

## 📁 Project Structure

```text
backend/
  app/
    api/v1/routes/
    services/adapters/
    tasks/
  alembic/
frontend/
deploy/
installer/
docs/openapi/
```

---

## 👨‍💻 Developer Workflow

### Local run

```bash
cp .env.example .env
docker compose up -d --build
docker compose exec api alembic upgrade head
docker compose exec api python -m app.cli create-superadmin
```

### Common operations

```bash
docker compose ps
docker compose logs -f api
docker compose logs -f worker
docker compose logs -f beat
```

---

## 🤖 AI Context (For Assistants and Agents)

If you are an AI agent maintaining this project:

### Product intent

Guardino is a **business orchestration layer** above VPN panels, not a VPN protocol implementation.

### Source of truth priorities

1. official upstream API docs in `docs/openapi/`
2. current adapter behavior in `backend/app/services/adapters/`
3. reseller operations in `backend/app/api/v1/routes/reseller_ops.py`

### Key invariants

- wallet/accounting operations must stay consistent
- remote panel failure must not silently corrupt local financial state
- usage sync must avoid false reset to zero on transient remote failures
- revoke must invalidate central token and node links correctly

### Safe extension areas

- add new panel adapters under `services/adapters`
- add new operational commands in `installer/manage.sh`
- improve reporting endpoints without breaking schema contracts

### High-impact future roadmap

- idempotency keys for paid operations
- stronger outbox/retry model for remote panel actions
- rate limiting and abuse controls per reseller
- richer audit trails for all lifecycle actions
- integration test matrix for panel adapters

---

## 📰 Latest Operational Updates

- ✅ Interactive manager script added: `installer/manage.sh`
- ✅ Full backup/restore flow unified under manager
- ✅ Telegram backup scheduler and upload integration added
- ✅ `guardino.sh` now launches manager console by default
- ✅ `deploy/backup.sh` and `deploy/restore.sh` now delegate to manager core logic
- ✅ README refreshed for installation + operations + AI context

---

## 🇮🇷 خلاصه فارسی

Guardino Hub یک پنل مرکزی برای مدیریت فروش VPN روی چند پنل مختلف (مرزبان، پاسارگارد، WGDashboard) است.  
با یک رابط واحد می‌توانید کاربر بسازید، تمدید/افزایش حجم انجام دهید، لینک ساب بدهید، گزارش بگیرید و بکاپ/ریستور حرفه‌ای داشته باشید.  
برای نصب و مدیریت سریع از دستور زیر استفاده کنید:

```bash
bash <(curl -Ls --ipv4 https://raw.githubusercontent.com/Sir-Adnan/guardino-hub/main/installer/guardino.sh)
```

