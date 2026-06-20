# Current Project Structure

این سند ساختار فعلی Guardino Hub را توصیف می‌کند.

## Backend

- `backend/app/api/v1/routes`: routeهای HTTP و کنترل دسترسی
- `backend/app/models`: مدل‌های SQLAlchemy
- `backend/app/schemas`: مدل‌های ورودی و خروجی Pydantic
- `backend/app/services`: منطق مالی، دسترسی پنل، امنیت، متریک‌ها و adapterها
- `backend/app/services/adapters`: اتصال PasarGuard، Marzban و WGDashboard
- `backend/app/tasks`: taskهای Celery برای مصرف و انقضا
- `backend/alembic/versions`: تاریخچه migrationهای PostgreSQL

API با FastAPI اجرا می‌شود و sessionهای دیتابیس asynchronous هستند. revision فعلی Alembic برابر `0012_ledger_request_id` است.

## مدل‌های عملیاتی

- `Reseller`: حساب سوپرادمین یا رسیلر، موجودی، قیمت و تنظیمات امنیتی
- `Node`: پنل بالادستی و credential اصلی
- `NodeAllocation`: اتصال یک رسیلر به یک نود با credential مشترک یا اختصاصی
- `GuardinoUser`: حساب کاربر در Guardino
- `SubAccount`: نگاشت کاربر Guardino به حساب همان کاربر روی یک نود
- `Order`: عملیات مالی و وضعیت اجرای آن
- `LedgerTransaction`: تغییرات موجودی قابل پیگیری
- `DashboardDailyMetric`: snapshot روزانه آمار
- `ApiToken`: دسترسی API محدود به حساب صادرکننده

## Sync و import

`backend/app/tasks/usage.py` مصرف را به‌صورت batch و بر اساس access هر نود یا تخصیص دریافت می‌کند. لیست‌های ناقص remote قابل اعتماد تلقی نمی‌شوند و حذف remote تنها بعد از تأییدهای مستقیم متوالی انجام می‌شود.

ورود کاربران PasarGuard و Marzban صفحه‌بندی شده است. رکورد قدیمی Guardino در صورت تشخیص حذف اشتباه بازیابی می‌شود و سابقه مالی آن حفظ می‌ماند. کاربر خارجی جدید با مبدأ `external_import` ثبت می‌شود و ورود اولیه آن تراکنش مالی ایجاد نمی‌کند.

## امنیت

احراز هویت شامل access token، API token و TOTP دومرحله‌ای است. secret دومرحله‌ای به‌شکل رمزنگاری‌شده و recovery codeها به‌شکل hash ذخیره می‌شوند.

## Frontend

- `frontend/src/app`: routeهای Next.js
- `frontend/src/app/app`: صفحات پنل پس از ورود
- `frontend/src/components`: اجزای مشترک رابط
- `frontend/src/lib/i18n.ts`: متن‌های فارسی و انگلیسی
- `frontend/src/lib/format.ts`: نمایش عدد، حجم و تاریخ

Frontend با Next.js 14، React 18، Tailwind CSS، TanStack Query و lucide-react ساخته شده است.

## Runtime

Docker Compose سرویس‌های `db`، `redis`، `api`, `worker`, `beat`, `web` و `nginx` را اجرا می‌کند. تنظیمات runtime از `.env` خوانده می‌شوند.

برای اجرای کامل محیط توسعه یا تست deploy از Docker Compose استفاده می‌شود:

```bash
docker compose up -d --build
docker compose exec api alembic upgrade head
```

## AI Testing & Execution Rules

این پروژه با کمک ابزارهای AI مثل Codex، Claude Code و VS Code توسعه داده می‌شود. برای جلوگیری از مصرف بی‌مورد توکن، زمان و لاگ‌های طولانی، AI نباید بعد از هر تغییر به‌صورت خودکار تست‌های سنگین اجرا کند.

### قوانین اصلی

* بعد از تغییرات معمولی، به‌صورت خودکار `npm run build`، `docker compose up --build`، `docker compose build` یا `python -m compileall backend/app backend/alembic` اجرا نشود.
* اجرای build کامل فقط وقتی مجاز است که کاربر صریحاً بگوید: `FULL TEST`، `BUILD` یا `DEPLOY CHECK`.
* اگر فقط Backend تغییر کرده، Frontend تست نشود.
* اگر فقط Frontend تغییر کرده، Backend تست نشود.
* اگر فقط مستندات، README، متن، comment یا فایل‌های غیر اجرایی تغییر کرده‌اند، هیچ build یا test سنگینی اجرا نشود.
* خروجی طولانی commandها در پاسخ آورده نشود؛ فقط نتیجه خلاصه یا خطاهای مهم گزارش شود.

### بررسی سریع Backend

برای تغییرات کوچک Python، فقط همان فایل تغییرکرده بررسی شود:

```bash
python -m py_compile path/to/changed_file.py
```

اگر `ruff` در پروژه موجود بود، می‌توان از آن برای فایل‌های تغییرکرده استفاده کرد:

```bash
ruff check path/to/changed_file.py
```

برای تغییرات مهم در routeها، schemaها یا FastAPI، در صورت آماده بودن محیط backend، smoke test سبک OpenAPI قابل اجراست:

```bash
python -c "from app.main import app; print(len(app.openapi().get('paths', {})))"
```

اگر dependencyهای backend روی سیستم محلی نصب نیستند، این تست باید داخل container `api` اجرا شود، نه با نصب خودکار dependencyها.

### بررسی سریع Frontend

برای تغییرات معمولی Frontend، build کامل اجرا نشود. ابتدا از checkهای سبک استفاده شود:

```bash
npm run lint
```

یا اگر script مربوطه وجود داشت:

```bash
npm run typecheck
```

اگر dependencyهای frontend روی سیستم محلی نصب نیستند و خطای `next is not recognized` یا نبودن `node_modules` دیده شد، این به‌تنهایی نشانه خطای کد UI نیست. در این حالت، AI باید موضوع را گزارش کند و بدون اجازه کاربر `npm install` یا build کامل اجرا نکند.

### Full Test / Deploy Check

فقط وقتی کاربر صریحاً درخواست `FULL TEST`، `BUILD` یا `DEPLOY CHECK` داد، اجرای کامل مجاز است:

```bash
docker compose up -d --build
docker compose exec api alembic upgrade head
docker compose ps
git diff --check
```

برای Frontend build کامل:

```bash
cd frontend
npm run build
```

### Migration Rule

اگر مدل‌های دیتابیس یا فایل‌های Alembic تغییر کردند، AI باید واضح گزارش کند که در deploy بعدی migration باید اجرا شود:

```bash
docker compose exec api alembic upgrade head
```

AI نباید migration را روی production اجرا کند مگر کاربر صریحاً درخواست دهد.
