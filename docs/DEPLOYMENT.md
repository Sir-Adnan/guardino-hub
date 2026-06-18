# Deployment

## نصب سریع

```bash
bash <(curl -Ls --ipv4 https://raw.githubusercontent.com/Sir-Adnan/guardino-hub/main/installer/guardino.sh)
```

بعد از نصب:

```bash
guardino help
guardino status
guardino logs api
```

## آپدیت

```bash
guardino update
```

یا از داخل سورس:

```bash
sudo bash installer/update.sh
```

آپدیت امن این کارها را انجام می‌دهد:

- sync آخرین سورس از Git، اگر نصب از repo باشد
- backup تغییرات local قبل از reset سورس
- ساخت بکاپ PostgreSQL قبل از migration در `backups/pre-update-*`
- build imageهای جدید
- اجرای `alembic upgrade head`
- recreate سرویس‌ها بعد از موفقیت migration
- refresh دستورهای `guardino` و `Guardino`

اگر عمدا می‌خواهید بکاپ قبل از migration را رد کنید:

```bash
SKIP_PRE_UPDATE_BACKUP=1 sudo -E bash installer/update.sh
```

این گزینه فقط وقتی استفاده شود که خودتان از دیتابیس بکاپ سالم دارید.

## migration دیتابیس

هر تغییر در مدل دیتابیس باید Alembic migration داشته باشد. آپدیت production نباید به `create_all` یا تغییر دستی جدول وابسته باشد.

قواعد migration:

- تغییرات destructive تا حد ممکن ممنوع است.
- ستون‌های جدید برای دیتابیس‌های قدیمی باید nullable یا دارای default امن باشند.
- backfill باید idempotent باشد.
- اگر جدولی جدید برای گزارش یا cache اضافه می‌شود، migration باید داده اولیه امن بسازد.
- آپدیت باید با `alembic upgrade head` از هر نسخه قبلی قابل اجرا باشد.

## بکاپ

```bash
guardino backup full
guardino backup essential
```

حالت `full` برای مهاجرت کامل مناسب‌تر است. حالت `essential` سبک‌تر است و برای ارسال سریع‌تر به تلگرام کاربرد دارد.

ریستور:

```bash
guardino restore /path/to/guardino_backup_YYYYmmddTHHMMSSZ.tar.gz
```

## دامنه و SSL

```bash
guardino domain set panel.example.com
```

بعد از تنظیم دامنه، وضعیت سرویس را بررسی کنید:

```bash
guardino status
guardino logs nginx
guardino logs api
```

## عیب‌یابی سریع

```bash
guardino ps
guardino logs api
guardino logs worker
guardino logs beat
guardino logs nginx
```

اگر migration شکست خورد، ابتدا بکاپ `backups/pre-update-*` را نگه دارید، لاگ `api` و خروجی Alembic را بررسی کنید، و بدون بکاپ سالم migration را دستی تغییر ندهید.
