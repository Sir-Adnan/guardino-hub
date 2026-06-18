# Guardino Hub

Guardino Hub یک پنل مرکزی برای فروش و مدیریت سرویس‌های VPN روی چند پنل بالادستی است. گاردینو بین پنل‌هایی مثل PasarGuard، Marzban و WGDashboard قرار می‌گیرد و یک لایه‌ی واحد برای فروش، رسیلرها، کیف پول، سفارش‌ها، کاربران، لینک‌های ساب و گزارش‌ها می‌سازد.

هدف پروژه این است که سوپرادمین بتواند چندین نود و چندین رسیلر را از یک پنل کنترل کند، و هر رسیلر هم بدون درگیری مستقیم با پنل‌های بالادستی، کاربران خودش را بسازد، تمدید کند و فروشش را مدیریت کند.

مخزن رسمی:

```text
https://github.com/Sir-Adnan/guardino-hub
```

## چرا Guardino Hub؟

- مدیریت متمرکز PasarGuard، Marzban و WGDashboard
- پنل سوپرادمین و پنل رسیلر با کیف پول، قیمت‌گذاری و دفترکل مالی
- ساخت، تمدید، افزایش حجم/زمان، حذف، ریفاند، revoke و reset usage طبق سیاست‌های قابل تنظیم
- تخصیص نود به رسیلر با قیمت اختصاصی، نود پیش‌فرض و دسترسی فعال/غیرفعال
- پشتیبانی از credential اختصاصی برای هر تخصیص؛ مناسب رسیلرهایی که در PasarGuard یا Marzban ادمین جدا دارند
- import کاربران قدیمی رسیلر از پنل بالادستی بدون کسر موجودی
- API token برای اتصال امن ابزارهای بیرونی و ربات تلگرام فروش
- داشبورد آماری با فروش، حجم زده‌شده، مصرف ثبت‌شده و snapshot روزانه
- اسکریپت نصب، آپدیت، بکاپ، ریستور، دامنه و SSL

## قابلیت‌های کلیدی

سوپرادمین می‌تواند نودها، رسیلرها، قیمت‌ها، موجودی‌ها، سیاست‌ها، API tokenها و تخصیص‌ها را مدیریت کند. رسیلر می‌تواند کاربران خودش را بسازد، وضعیت مصرف و انقضا را ببیند، سفارش‌ها را کنترل کند و لینک‌های مستقیم یا لینک ساب Guardino را تحویل بدهد.

گاردینو برای سناریوی رشد فروش طراحی شده است: می‌توانید همه رسیلرها را روی credential اصلی یک نود نگه دارید، یا برای رسیلرهای بزرگ credential اختصاصی همان رسیلر را روی همان نود ثبت کنید تا کاربرانش در پنل بالادستی هم جدا و مرتب بمانند.

جزئیات کامل قابلیت‌ها در [docs/FEATURES.md](docs/FEATURES.md) آمده است.

## معماری

```text
Next.js Panel
    |
FastAPI API
    |
    +-- PostgreSQL: users, resellers, orders, ledger, nodes, metrics
    +-- Redis/Celery: usage sync, expiry sync, background jobs
    |
    +-- PasarGuard adapter
    +-- Marzban adapter
    +-- WGDashboard adapter
```

Backend با FastAPI، SQLAlchemy Async، Alembic، PostgreSQL، Redis و Celery ساخته شده است. Frontend با Next.js App Router، React، Tailwind CSS و lucide-react پیاده‌سازی شده است.

## نصب سریع

روی سرور لینوکسی:

```bash
bash <(curl -Ls --ipv4 https://raw.githubusercontent.com/Sir-Adnan/guardino-hub/main/installer/guardino.sh)
```

بعد از نصب، دستورهای سراسری زیر در دسترس هستند:

```bash
guardino help
Guardino help
```

دستورهای پرکاربرد:

```bash
guardino status
guardino logs api
guardino update
guardino backup full
guardino restore /path/to/guardino_backup_YYYYmmddTHHMMSSZ.tar.gz
guardino domain set panel.example.com
```

راهنمای نصب، آپدیت، بکاپ و ریستور در [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) آمده است.

## آپدیت امن

برای آپدیت:

```bash
guardino update
```

مسیر آپدیت قبل از اجرای migration یک بکاپ PostgreSQL در `backups/pre-update-*` می‌سازد و سپس همه migrationهای جدید را با دستور زیر اعمال می‌کند:

```bash
alembic upgrade head
```

اگر در آینده مدل دیتابیس تغییر کند، باید migration جدید اضافه شود تا دیتابیس نسخه‌های قبلی بدون از دست رفتن اطلاعات به نسخه جدید تبدیل شود.

## آماده برای ربات تلگرام

Guardino Hub فعلا خودش ربات تلگرام نیست، اما API آن برای ربات فروش آماده شده است:

- API token برای سوپرادمین و رسیلر
- عملیات idempotent برای سفارش‌ها با `client_request_id`
- جداسازی دسترسی رسیلرها
- import کاربران قدیمی بدون شارژ مالی
- تخصیص credential اختصاصی برای رسیلر روی نود مشترک
- آمار فروش و مصرف برای داشبورد مدیریتی

جزئیات بیشتر در [docs/API_AND_BOT_READY.md](docs/API_AND_BOT_READY.md) آمده است.

## مسیر مستندات

- [docs/FEATURES.md](docs/FEATURES.md): قابلیت‌ها و سناریوهای اصلی
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): نصب، آپدیت، بکاپ، ریستور و migration
- [docs/API_AND_BOT_READY.md](docs/API_AND_BOT_READY.md): API، tokenها و آماده‌سازی برای ربات فروش
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md): نکات توسعه برای انسان و AI
- [docs/references/upstream-apis](docs/references/upstream-apis): فایل‌های مرجع API پنل‌های بالادستی

## وضعیت پروژه

گاردینو هاب به یک پایه‌ی بالغ برای پنل فروش چندرسیلری رسیده است: ساختار API، تخصیص‌های اختصاصی، import کاربران قبلی، آپدیت امن دیتابیس و داشبورد متریک‌ها آماده شده‌اند. برای تغییرات مالی، دیتابیس یا API عمومی، حتما migration، تست و مستندات همزمان به‌روزرسانی شوند.
