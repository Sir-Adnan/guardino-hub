# Deployment

## نصب

```bash
bash <(curl -Ls --ipv4 https://raw.githubusercontent.com/Sir-Adnan/guardino-hub/main/installer/guardino.sh)
```

پس از نصب:

```bash
guardino help
guardino status
guardino ps
```

## سرویس‌ها

Docker Compose این سرویس‌ها را اجرا می‌کند:

- `db`: PostgreSQL 16
- `redis`: Redis 7
- `api`: FastAPI
- `worker`: Celery worker
- `beat`: Celery scheduler
- `web`: Next.js
- `nginx`: reverse proxy

## آپدیت

```bash
guardino update
```

یا از سورس:

```bash
sudo bash installer/update.sh
```

فرآیند آپدیت شامل دریافت سورس، نگهداری backup تغییرات local، بکاپ PostgreSQL در `backups/pre-update-*`، build imageها، اجرای `alembic upgrade head` و recreate سرویس‌ها است.

Updater کلیدهای غایب `.env` را اضافه می‌کند. defaultهای stock قدیمی sync و timeout به مقادیر فعلی منتقل می‌شوند؛ مقدارهایی که با defaultهای شناخته‌شده برابر نیستند سفارشی محسوب شده و حفظ می‌شوند.

رد کردن بکاپ خودکار:

```bash
SKIP_PRE_UPDATE_BACKUP=1 sudo -E bash installer/update.sh
```

## تنظیمات پنل پرتعداد

مقادیر پیش‌فرض فعلی برای نصب‌های دارای بیش از حدود 7 هزار کاربر:

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

`USAGE_SYNC_REMOTE_MISSING_CONFIRMATIONS` تعداد پاسخ‌های مستقیم 404 لازم پیش از حذف نگاشت remote است. پاسخ ناقص bulk list یا timeout به‌تنهایی کاربر را حذف نمی‌کند.

## دیتابیس

تاریخچه schema در `backend/alembic/versions` قرار دارد. revision فعلی `0011_dashboard_metric_bigint` است و مسیر استقرار migrationها را با دستور زیر اجرا می‌کند:

```bash
alembic upgrade head
```

## بکاپ و ریستور

```bash
guardino backup full
guardino backup essential
guardino restore /path/to/guardino_backup_YYYYmmddTHHMMSSZ.tar.gz
```

حالت `full` شامل داده‌های لازم برای مهاجرت کامل است. حالت `essential` خروجی سبک‌تری تولید می‌کند.

## دامنه و SSL

```bash
guardino domain set panel.example.com
```

## لاگ‌ها

```bash
guardino logs api
guardino logs worker
guardino logs beat
guardino logs nginx
```

وضعیت migration در خروجی updater و لاگ API قابل مشاهده است. بکاپ‌های قبل از آپدیت در پوشه `backups` باقی می‌مانند.
