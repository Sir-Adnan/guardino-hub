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

Docker Compose سرویس‌های `db`، `redis`، `api`، `worker`، `beat`، `web` و `nginx` را اجرا می‌کند. تنظیمات runtime از `.env` خوانده می‌شوند.

دستورهای موجود برای بررسی محلی:

```bash
python -m compileall backend/app backend/alembic
cd frontend && npm run build
git diff --check
```
