# Development Notes

این فایل برای توسعه‌دهندگان و AIهایی است که قرار است Guardino Hub را گسترش دهند.

## قبل از تغییر

کد مرتبط را کامل بخوانید: route، schema، service، model، adapter، migration و صفحه frontend. رفتار مالی یا دیتابیس را از روی حدس تغییر ندهید.

## ساختار مهم

- `backend/app/api/v1/routes`: endpointهای API
- `backend/app/models`: مدل‌های SQLAlchemy
- `backend/app/schemas`: schemaهای Pydantic
- `backend/app/services`: منطق دامنه، adapterها، قیمت‌گذاری، دسترسی پنل‌ها و متریک‌ها
- `backend/app/tasks`: taskهای Celery مثل sync مصرف و انقضا
- `backend/alembic/versions`: migrationهای دیتابیس
- `frontend/src/app/app`: صفحات اصلی پنل
- `frontend/src/lib/i18n.ts`: متن‌های چندزبانه
- `installer`: نصب، آپدیت، بکاپ، ریستور و CLI

## قوانین دیتابیس

- هر تغییر model باید migration داشته باشد.
- migration باید روی دیتابیس نسخه قبلی بدون حذف داده اجرا شود.
- ستون جدید در جدول پرکاربر بهتر است ابتدا nullable/default-safe باشد.
- backfillها باید قابل اجرای مجدد و امن باشند.
- برای آپدیت production، مسیر رسمی همیشه `alembic upgrade head` است.

## قوانین مالی

برای create، renew، add_traffic، extend، delete و refund این موارد را همزمان بررسی کنید:

- سفارش با وضعیت درست ساخته می‌شود.
- ledger دقیق و قابل audit است.
- balance منفی نمی‌شود مگر سیاست اجازه دهد.
- خطای پنل بالادستی باعث کسر پول بدون سرویس نمی‌شود.
- import کاربران قدیمی شارژ مالی ایجاد نمی‌کند.

## adapterها

adapter هر پنل باید تفاوت API بالادستی را پشت interface داخلی پنهان کند. تغییرات PasarGuard، Marzban یا WGDashboard نباید به صفحات UI یا منطق مالی نشت کند.

برای credential اختصاصی، از `NodeAllocation.credentials` و سرویس `panel_access` استفاده کنید. اگر تخصیص dedicated باشد، عملیات همان رسیلر باید با credential همان تخصیص انجام شود.

## داشبورد و متریک‌ها

مصرف کاربران در task سینک به‌روزرسانی می‌شود. برای اینکه داشبورد به اسکن سنگین کاربران وابسته نباشد، snapshot روزانه در `dashboard_daily_metrics` ذخیره می‌شود. endpointهای stats باید تا حد امکان از همین rollupهای سبک استفاده کنند و مقدار امروز را با جمع فعلی کاربران اصلاح کنند.

## frontend

- UI باید RTL و موبایل را جدی بگیرد.
- متن‌ها نباید از دکمه، کارت یا جدول بیرون بزنند.
- لیست‌های پرتعداد باید اسکرول یا صفحه‌بندی داشته باشند، نه اینکه silently truncate شوند.
- برای iconها از lucide-react استفاده کنید.
- مسیرهای مدیریتی باید برای سوپرادمین و رسیلر از نظر دسترسی جدا بمانند.

## checklist قبل از تمام کردن تغییر

- `python -m compileall backend/app backend/alembic`
- `npm run build` در frontend، اگر وابستگی‌ها نصب هستند
- `git diff --check`
- بررسی migration جدید و down_revision
- بررسی آپدیت README یا docs اگر رفتار عمومی تغییر کرده است
- تست سناریوی موبایل برای صفحات UI حساس
