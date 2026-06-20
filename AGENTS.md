# Guardino Hub AI Development Rules

This project is developed with AI assistance. Keep changes safe, targeted, and token-efficient.

## Core Rule: Do Not Run Heavy Commands Automatically

Never automatically run these commands after normal edits:

```bash
npm run build
npm install
npm ci
docker compose up --build
docker compose up -d --build
docker compose build
docker compose logs -f
python -m compileall backend/app backend/alembic
guardino update
```

Only run heavy commands if the user explicitly says one of these exact phrases:

```text
FULL TEST
FULL BUILD
DEPLOY CHECK
```

If the user does not say one of those phrases, use targeted checks only.

## Token Optimization Rules

* Do not read or paste long logs unless needed.
* Do not summarize unchanged files.
* Do not scan the whole repository if the task is limited to a few files.
* Do not run backend checks for frontend-only changes.
* Do not run frontend checks for backend-only changes.
* Do not run any build/test command for documentation-only changes.
* Report only important errors, not full success output.
* Before running any long command, briefly explain why it is needed and ask for confirmation.

## Backend Check Rules

For small Python changes, check only the changed file:

```bash
python -m py_compile path/to/changed_file.py
```

If `ruff` is available, prefer:

```bash
ruff check path/to/changed_file.py
```

For FastAPI route/schema changes, use a lightweight OpenAPI smoke test only if the backend environment is already ready:

```bash
python -c "from app.main import app; print(len(app.openapi().get('paths', {})))"
```

If local backend dependencies are not installed, do not install them automatically. Report this clearly and suggest running the check inside Docker only if the user asks.

## Frontend Check Rules

For frontend changes, do not run a full Next.js build by default.

Use lightweight checks first:

```bash
npm run lint
```

or, if available:

```bash
npm run typecheck
```

If `node_modules` is missing or `next is not recognized`, do not assume the UI code is broken. Report that frontend dependencies are not installed locally and wait for user confirmation before installing or building.

Do not run `npm install`, `npm ci`, or `npm install <package>` without asking first, because they may modify `package.json`, `package-lock.json`, and the local dependency state.

## Docker Rules

Docker commands are expensive. Do not run these automatically:

```bash
docker compose up -d --build
docker compose build
docker compose logs -f
guardino update
```

If Dockerfile, docker-compose files, dependency files, installer scripts, or update scripts changed, explain that a Docker/deploy check may be needed and ask for confirmation first.

Use Docker only when:

* the user says `FULL TEST`, `FULL BUILD`, or `DEPLOY CHECK`
* the user explicitly asks to run Docker
* a deployment check is explicitly requested

## Migration Rule

If SQLAlchemy models or Alembic migration files change, clearly report:

```bash
docker compose exec api alembic upgrade head
```

Do not run migrations against production unless the user explicitly asks.

## Git Rules

The user usually commits manually using VS Code Source Control.

AI assistants may inspect Git status or diffs when needed, but must not commit, push, create tags, or change branches unless the user explicitly asks.

Before suggesting a commit, check:

```bash
git diff --check
git status --short
```

If changes are ready, summarize the changed files and suggest a commit message. Do not run `git commit` or `git push` automatically.

## Response Style

* Explain what changed, what was checked, and what still needs manual/full testing.
* If a full build was not run, say that honestly.
* Prefer small, safe changes over large mixed changes.

## Production Data Safety

This project is already used in a real production environment.

There are existing resellers, many existing users, active upstream panel connections, existing financial records, and a production database that must be preserved during updates.

Before changing database models, migrations, sync/import logic, billing logic, reseller access, update scripts, or deployment behavior, first inspect the current code and `docs/DEVELOPMENT.md`. Do not assume table names, database names, migration IDs, volume names, or internal identifiers without checking the repository.

### Main safety rule

Do not make changes that can accidentally delete, reset, overwrite, duplicate, detach, or corrupt existing production data.

Be especially careful with changes related to:

* users and imported users
* resellers and reseller access
* balances, orders, ledger/accounting records
* node allocations and upstream panel mappings
* PasarGuard, Marzban, and WGDashboard sync/import behavior
* Alembic migrations
* install and update scripts

### Migration safety

Database migrations should be backward-compatible whenever possible.

Prefer additive migrations over destructive migrations.

Do not drop columns, drop tables, clear data, rewrite ownership, reset balances, or rewrite historical financial records unless the user explicitly approves the risk.

If a migration is required, clearly mention that deployment must run:

```bash
docker compose exec api alembic upgrade head
```

Do not run production migrations automatically unless the user explicitly asks.

### Sync and import safety

When changing sync or import logic:

* avoid creating duplicate users
* preserve existing user-to-reseller relationships
* preserve existing upstream panel mappings
* do not treat incomplete remote lists as a reliable full deletion signal
* do not create financial records for old imported users unless the user explicitly requests it
* keep deletion detection conservative and safe

### Reseller panel safety

After updates, existing reseller panels should continue working.

Be careful not to break:

* reseller login
* user list
* user renew/reset/delete flows
* node access
* pricing and balance display
* reports and ledger views
* imported users and existing subscriptions

If a change can affect reseller access, billing, user ownership, or node allocation, explain the risk before making the change.

### Install and update script compatibility

This project has two update paths:

1. repository install/update scripts
2. server-side command flow such as `guardino update`

When changing deployment behavior, Docker services, environment variables, migrations, installer logic, or update logic, check both update paths and keep them consistent.

Do not update only one path if the other one also needs the same change.

### Before deployment-sensitive changes

For production-sensitive changes, recommend taking a backup first.

Do not run backup, migration, reset, cleanup, or destructive commands on production unless the user explicitly asks.

### AI behavior

Keep changes small and backward-compatible.

If you are unsure whether a change can affect existing production users, resellers, balances, database records, or update scripts, stop and ask before proceeding.

Do not invent details. Check the repository first.
