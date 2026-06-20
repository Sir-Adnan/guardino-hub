# Guardino Hub

Guardino Hub پنل مرکزی فروش و مدیریت سرویس‌های VPN روی چند پنل بالادستی است. این پروژه PasarGuard، Marzban و WGDashboard را پشت یک API و پنل واحد قرار می‌دهد و مدیریت رسیلرها، کاربران، کیف پول، سفارش‌ها، دفترکل، لینک‌های اشتراک و گزارش‌ها را یکپارچه می‌کند.

مخزن رسمی:

```text
https://github.com/Sir-Adnan/guardino-hub
```

## قابلیت‌های اصلی

- پنل جداگانه سوپرادمین و رسیلر
- مدیریت PasarGuard، Marzban و WGDashboard
- ساخت، تمدید، افزایش حجم و زمان، تغییر وضعیت، حذف، ریفاند، revoke و reset usage
- کیف پول رسیلر، سفارش‌های idempotent و دفترکل قابل پیگیری
- تخصیص نود با قیمت، وضعیت و credential مستقل برای هر رسیلر
- حالت `shared` برای credential اصلی نود و `dedicated` برای حساب اختصاصی رسیلر
- ورود کامل و صفحه‌بندی‌شده کاربران قدیمی بدون کسر موجودی
- بازیابی رکوردهای قبلی Guardino هنگام ورود مجدد، با حفظ سابقه سفارش و ریفاند
- sync مقاوم در برابر timeout، پاسخ ناقص و 404 موقت
- API token محدود به سوپرادمین یا رسیلر مشخص
- ورود دومرحله‌ای TOTP، کدهای بازیابی یک‌بارمصرف و نگهداری رمزنگاری‌شده secret
- داشبورد فروش، مصرف، حجم ثبت‌شده، وضعیت کاربران و snapshotهای روزانه
- رابط فارسی و انگلیسی، حالت روشن و تاریک و طراحی واکنش‌گرا
- نصب، آپدیت، migration، بکاپ، ریستور، دامنه و SSL از طریق CLI

## معماری

```text
Next.js Panel
    |
FastAPI API
    |
    +-- PostgreSQL: users, resellers, orders, ledger, nodes, settings, metrics
    +-- Redis/Celery: usage sync, expiry sync, background jobs
    |
    +-- PasarGuard adapter
    +-- Marzban adapter
    +-- WGDashboard adapter
```

Backend با FastAPI، SQLAlchemy Async، Alembic، PostgreSQL، Redis و Celery اجرا می‌شود. Frontend بر پایه Next.js App Router، React، Tailwind CSS و lucide-react است. Nginx مسیرهای پنل و API را منتشر می‌کند.

## نصب سریع

روی سرور لینوکسی:

```bash
bash <(curl -Ls --ipv4 https://raw.githubusercontent.com/Sir-Adnan/guardino-hub/main/installer/guardino.sh)
```

دستورهای پرکاربرد:

```bash
guardino help
guardino status
guardino logs api
guardino logs worker
guardino update
guardino backup full
guardino restore /path/to/guardino_backup_YYYYmmddTHHMMSSZ.tar.gz
guardino domain set panel.example.com
```

## آپدیت و دیتابیس

```bash
guardino update
```

آپدیت رسمی قبل از migration از PostgreSQL بکاپ می‌گیرد، imageها را build می‌کند، `alembic upgrade head` را اجرا می‌کند و سرویس‌ها را دوباره ایجاد می‌کند. migration فعلی پروژه تا revision `0011_dashboard_metric_bigint` ادامه دارد.

Updater کلیدهای غایب `.env` را اضافه می‌کند. مقدارهای stock نسخه‌های قدیمی sync و timeout نیز به پروفایل پنل سنگین منتقل می‌شوند، در حالی که مقدارهای سفارشی حفظ می‌شوند.

پروفایل پیش‌فرض برای پنل‌های پرتعداد:

```env
USAGE_SYNC_SECONDS=180
EXPIRY_SYNC_SECONDS=120
USAGE_SYNC_BATCH_SIZE=5000
USAGE_SYNC_REMOTE_LIST_PAGE_SIZE=1000
USAGE_SYNC_REMOTE_LIST_MAX_PAGES=200
USAGE_SYNC_REMOTE_MISSING_CONFIRMATIONS=3
EXPIRY_SYNC_BATCH_SIZE=1000
HTTP_TIMEOUT_SECONDS=60
```

## API

OpenAPI هر نصب از مسیرهای زیر در دسترس است:

```text
https://YOUR_DOMAIN/api/openapi.json
https://YOUR_DOMAIN/api/docs
```

توکن‌های API محدوده دسترسی حساب را حفظ می‌کنند. عملیات مالی تکرارپذیر از `client_request_id` استفاده می‌کنند تا retry باعث سفارش یا کاربر تکراری نشود.

## مستندات

- [docs/FEATURES.md](docs/FEATURES.md): قابلیت‌های فعال و رفتار پنل
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): نصب، آپدیت، بکاپ، ریستور، دامنه و SSL
- [docs/API_AND_BOT_READY.md](docs/API_AND_BOT_READY.md): قرارداد API برای ابزارهای بیرونی و ربات فروش
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md): ساختار فعلی کد و محیط توسعه
- [docs/references/upstream-apis](docs/references/upstream-apis): snapshot قرارداد API پنل‌های بالادستی
