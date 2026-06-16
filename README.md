# Guardino Hub

Guardino Hub یک پنل مرکزی برای مدیریت فروش، رسیلرها، کاربران، کیف پول، لینک‌های ساب و گزارش‌ها روی چند پنل VPN است. این پروژه بین پنل‌های بالادستی مثل PasarGuard، Marzban و WGDashboard قرار می‌گیرد و یک لایه تجاری و عملیاتی واحد می‌سازد تا سوپرادمین بتواند رسیلرها را مدیریت کند و رسیلرها بتوانند بدون درگیری مستقیم با چند پنل مختلف، سرویس بفروشند.

مخزن رسمی:

```text
https://github.com/Sir-Adnan/guardino-hub
```

مستند فعلی برای وضعیت جدید پروژه بازنویسی شده و جایگزین README قدیمی است.

## هدف پروژه

بسیاری از فروشنده‌های VPN چند نوع پنل و چند نود دارند. در این حالت ساخت کاربر، قیمت‌گذاری، تمدید، ریفاند، لینک‌دهی، کنترل مصرف و گزارش‌گیری بین پنل‌ها پراکنده می‌شود. Guardino Hub این آشفتگی را به یک پنل واحد تبدیل می‌کند.

Guardino Hub قرار است:

- سوپرادمین بتواند نودها، رسیلرها، قیمت‌ها، موجودی‌ها و سیاست‌ها را کنترل کند.
- رسیلر بتواند از پنل خودش کاربر بسازد، تمدید کند، لینک ساب بدهد و سفارش‌هایش را ببیند.
- کاربر در پنل‌های مقصد مثل PasarGuard، Marzban و WGDashboard ساخته شود، اما وضعیت مالی و مدیریتی داخل Guardino متمرکز بماند.
- عملیات حساس مثل حذف، ریفاند، revoke، reset usage و renew طبق سیاست‌های قابل تنظیم انجام شود.

## نقش‌ها

### سوپرادمین

سوپرادمین مالک اصلی پنل است و به بخش‌های مدیریتی دسترسی دارد:

- ساخت، ویرایش، فعال/غیرفعال و حذف نرم رسیلرها
- افزایش و کاهش موجودی رسیلرها
- تعریف قیمت per-node، قیمت bundle و قیمت روزانه
- تعریف نودهای PasarGuard، Marzban و WGDashboard
- تخصیص نود به رسیلر و تعیین نودهای پیش‌فرض هر رسیلر
- تنظیم پیش‌فرض‌های ساخت کاربر
- تنظیم سیاست‌های کلی ساخت، حذف، ریفاند، ریست مصرف و تمدید
- مشاهده دفترکل، سفارش‌ها و آمار

### رسیلر

رسیلر فروشنده‌ای است که از موجودی کیف پول خود برای ساخت و مدیریت کاربران استفاده می‌کند:

- ساخت کاربر تکی یا گروهی
- انتخاب پکیج زمانی و حجمی
- انتخاب نودهای مجاز یا استفاده از نودهای پیش‌فرض
- دریافت لینک مستقیم پنل‌ها، لینک ساب مرکزی در صورت فعال بودن و QR
- revoke لینک‌ها
- تمدید، افزایش حجم/زمان، کاهش حجم یا حذف طبق سیاست
- مشاهده گزارش سفارش‌ها و وضعیت کیف پول

## پنل‌های پشتیبانی‌شده

Guardino Hub از معماری Adapter استفاده می‌کند. هر نوع پنل بالادستی در یک adapter جدا پیاده‌سازی شده است:

| Panel | وضعیت | مسیر adapter |
| --- | --- | --- |
| Marzban | پشتیبانی از ساخت کاربر، لینک ساب، مصرف، status، reset و حذف | `backend/app/services/adapters/marzban.py` |
| PasarGuard | سازگار با API جدید، از جمله PasarGuard 5.x و فایل OpenAPI موجود در repo | `backend/app/services/adapters/pasarguard.py` |
| WGDashboard | پشتیبانی WireGuard، لینک config و revoke با delete/recreate | `backend/app/services/adapters/wg_dashboard.py` |

فایل‌های مرجع API داخل مخزن:

```text
docs/openapi/MarzbanAPI.json
docs/openapi/PasarGuardAPI.json
docs/openapi/WGDashboard.postman_collection.v4.3.0.json
```

## امکانات اصلی

- پنل مرکزی سوپرادمین و رسیلر
- مدیریت رسیلرها، موجودی و قیمت‌گذاری
- افزایش و کاهش موجودی با دو حالت جداگانه برای جلوگیری از خطای عدد منفی
- مدیریت نودها، تست اتصال و تعیین نمایش/عدم نمایش در ساب
- تخصیص نود به رسیلر با امکان price override و default node
- ساخت کاربر تکی و گروهی
- نام کاربر یکپارچه: همان مقدار داخل Guardino در پنل‌های PasarGuard و Marzban هم استفاده می‌شود
- ساخت نام تصادفی با رعایت prefix و suffix
- پشتیبانی از on hold و active هنگام ساخت کاربر
- نمایش وضعیت on hold به صورت "در انتظار اولین اتصال"
- همگام‌سازی وضعیت on hold با اتصال واقعی کاربر
- نمایش مصرف‌های کوچک در حد MB، حتی اگر کمتر از 100MB باشد
- لینک مستقیم هر نود و لینک ساب مرکزی Guardino
- لینک ساب مرکزی به صورت پیش‌فرض برای رسیلرها خاموش است
- revoke امن لینک ساب مرکزی و باطل شدن توکن قبلی
- QR برای لینک‌های ساب
- جست‌وجوی سمت سرور در کاربران، مستقل از صفحه فعلی
- سیاست‌های حذف، ریفاند، ریست مصرف، ویرایش و تمدید
- سیاست تمدید با چند مدل مختلف
- محدودیت ساخت و ویرایش طبق پکیج‌های مجاز
- گزارش دفترکل و سفارش‌ها با نمایش خواناتر و تاریخ شمسی در فرانت‌اند
- background sync برای مصرف و انقضا
- حذف خودکار local user وقتی کاربر از پنل بالادستی حذف شده باشد، بدون تغییر مالی
- installer، updater، backup، restore و ارسال بکاپ به تلگرام

## معماری کلی

```text
Reseller/Admin UI
        |
        v
Next.js Frontend
        |
        v
FastAPI Backend
        |
        +--> PostgreSQL: users, resellers, orders, ledger, nodes, settings
        +--> Redis/Celery: sync usage, sync expiry, scheduled jobs
        |
        +--> Marzban Adapter
        +--> PasarGuard Adapter
        +--> WGDashboard Adapter
```

## تکنولوژی‌ها

Backend:

- FastAPI
- SQLAlchemy Async
- Alembic
- PostgreSQL
- Redis
- Celery worker و Celery beat
- httpx

Frontend:

- Next.js App Router
- React
- Tailwind CSS
- lucide-react
- React Query

Infra:

- Docker Compose
- Nginx
- اسکریپت نصب و آپدیت
- بکاپ و restore
- پشتیبانی اختیاری از SSL با Let's Encrypt

## جریان کاری سوپرادمین

1. ورود به پنل با حساب superadmin
2. تعریف نودهای مورد نیاز در بخش نودها
3. تست اتصال هر نود
4. ساخت رسیلر و تعیین قیمت‌ها
5. تخصیص نود به رسیلر
6. تعیین نودهای پیش‌فرض رسیلر
7. تنظیم سیاست‌های کلی یا اختصاصی
8. شارژ کیف پول رسیلر
9. بررسی سفارش‌ها، دفترکل و مصرف

## جریان کاری رسیلر

1. ورود به پنل رسیلر
2. رفتن به بخش کاربران
3. انتخاب ساخت کاربر
4. وارد کردن نام کاربر یا استفاده از دکمه random
5. انتخاب حجم و مدت
6. انتخاب نودها یا استفاده از پیش‌فرض‌ها
7. مشاهده قیمت قبل از ساخت
8. ساخت کاربر
9. کپی لینک مستقیم یا QR
10. مدیریت تمدید، revoke، reset یا حذف طبق سیاست‌های مجاز

## مدیریت نودها

هر نود مشخص می‌کند Guardino باید به کدام پنل خارجی وصل شود.

فیلدهای مهم نود:

- `name`: نام نمایشی داخل Guardino
- `panel_type`: یکی از `marzban`، `pasarguard` یا `wg_dashboard`
- `base_url`: آدرس پنل مقصد
- `credentials`: اطلاعات اتصال، به صورت JSON
- `tags`: تگ‌ها برای گروه‌بندی نودها
- `is_enabled`: فعال یا غیرفعال بودن نود
- `is_visible_in_sub`: نمایش یا عدم نمایش لینک نود داخل ساب کاربر

نمونه credential برای Marzban و PasarGuard:

```json
{
  "username": "admin",
  "password": "strong-password"
}
```

یا در صورت پشتیبانی پنل:

```json
{
  "token": "access-token"
}
```

نمونه credential برای WGDashboard:

```json
{
  "apikey": "wg-dashboard-api-key"
}
```

نکته: credentials در مدل فعلی به صورت JSON ذخیره می‌شود. برای production جدی، رمزنگاری at-rest برای این فیلد باید در اولویت توسعه امنیتی باشد.

## PasarGuard 5.x

Guardino با OpenAPI جدید PasarGuard در مسیر زیر تطبیق داده شده است:

```text
docs/openapi/PasarGuardAPI.json
```

رفتارهای مهم adapter پاسارگارد:

- دریافت token از `/api/admin/token` در حالت username/password
- ساخت کاربر از API جدید `/api/user`
- پشتیبانی از on hold
- گرفتن snapshot کاربر برای status و used traffic
- دریافت لینک subscription از پاسخ پنل یا endpoint مربوطه
- استفاده از Groups برای فعال‌سازی inbounds
- ساخت یا sync گروه `guardino_all_inbounds` در صورت امکان
- fallback برای نسخه‌هایی که payload جدید proxy settings را قبول نمی‌کنند
- تلاش برای repair کردن کاربر اگر proxy settings یا group_ids کامل اعمال نشده باشد

اگر در آینده API پاسارگارد دوباره تغییر کرد، ابتدا `docs/openapi/PasarGuardAPI.json` را به‌روزرسانی کنید، سپس فقط adapter پاسارگارد و تست‌های مرتبط را تغییر دهید.

## تخصیص نود به رسیلر

سوپرادمین می‌تواند برای هر رسیلر مشخص کند کدام نودها قابل استفاده باشند.

هر تخصیص شامل این موارد است:

- `reseller_id`
- `node_id`
- `enabled`
- `default_for_reseller`
- `price_per_gb_override`

قانون انتخاب نود:

- اگر رسیلر هنگام ساخت کاربر نود انتخاب کند، فقط همان نودهای مجاز استفاده می‌شوند.
- اگر گروه نود انتخاب کند، فقط نودهای دارای همان tag استفاده می‌شوند.
- اگر هیچ نودی انتخاب نشود، ابتدا نودهای `default_for_reseller` استفاده می‌شوند.
- اگر هیچ نود پیش‌فرضی تعریف نشده باشد، همه تخصیص‌های فعال رسیلر استفاده می‌شوند.

پیش‌فرض فعلی برای جلوگیری از هزینه ناخواسته:

- `default_node_mode = manual`
- `default_pricing_mode = per_node`
- اگر برای رسیلر فقط یک نود پیش‌فرض مشخص شده باشد، فرم ساخت کاربر به صورت طبیعی روی همان نود و حالت per-node می‌نشیند.

## قیمت‌گذاری

Guardino دو مدل قیمت دارد.

### Per Node

در این حالت هزینه برای هر نود جدا حساب می‌شود.

فرمول کلی:

```text
sum(selected_node_price_per_gb * total_gb) + optional_price_per_day * days
```

اگر روی allocation یک `price_per_gb_override` تعریف شده باشد، همان قیمت برای آن نود استفاده می‌شود. در غیر این صورت قیمت عمومی رسیلر یعنی `price_per_gb` استفاده می‌شود.

### Bundle

در این حالت هزینه برای کل سرویس فقط یک بار حساب می‌شود، حتی اگر چند نود انتخاب شده باشد.

فرمول کلی:

```text
bundle_price_per_gb * total_gb + optional_price_per_day * days
```

اگر `bundle_price_per_gb` صفر یا خالی باشد، سیستم از `price_per_gb` رسیلر استفاده می‌کند.

## ساخت کاربر

ساخت کاربر در endpoint زیر انجام می‌شود:

```text
POST /api/v1/reseller/users
```

فیلدهای اصلی:

```json
{
  "label": "customer-01",
  "username": "customer-01",
  "randomize_username": false,
  "create_status": "active",
  "duration_preset": "1m",
  "total_gb": 50,
  "days": 31,
  "pricing_mode": "per_node",
  "node_ids": [1, 2],
  "node_group": null
}
```

قواعد مهم:

- `label` و `username` در محصول جدید یکی در نظر گرفته می‌شوند.
- نامی که در Guardino ذخیره می‌شود باید با نام کاربر در Marzban و PasarGuard یکی باشد.
- اگر username خالی باشد و random فعال نباشد، ساخت کاربر مجاز نیست.
- دکمه random نام معتبر می‌سازد.
- prefix و suffix از تنظیمات موثر رسیلر اعمال می‌شوند.
- مدت یک ماهه برابر 31 روز است.
- `create_status` فقط `active` یا `on_hold` است.
- پیش‌فرض ساخت کاربر active است، مگر اینکه کاربر در تنظیمات پیشرفته on hold را روشن کند.

## Prefix و Suffix نام کاربر

در تنظیمات، سوپرادمین و رسیلر می‌توانند prefix و suffix تعیین کنند. چون label و username یکی شده‌اند، این تنظیمات روی نام نهایی کاربر اثر می‌گذارند.

نمونه:

```text
prefix = rs1-
input  = ali
suffix = -vip
final  = rs1-ali-vip
```

در ساخت دستی و random باید همین قانون رعایت شود. اگر رسیلر prefix یا suffix داشته باشد، فرم ساخت کاربر باید الگوی نهایی را به صورت ثابت و شفاف نمایش دهد.

## ساخت گروهی کاربران

ساخت گروهی برای زمانی است که رسیلر بخواهد چند کاربر با یک پکیج و یک تنظیم مشترک بسازد.

قواعد مورد انتظار:

- هر کاربر باید نام یکتا بگیرد.
- پیش‌فرض on hold خاموش است.
- اگر on hold روشن شود، کاربران در پنل مقصد در حالت on hold ساخته می‌شوند.
- پس از ساخت، لینک‌های مستقیم و QR برای هر کاربر قابل مشاهده باشد.
- اگر یک نود خطا بدهد، باید خطای همان نود ثبت شود و وضعیت کاربر در Guardino قابل پیگیری بماند.

## وضعیت Active و On Hold

Guardino دو وضعیت را باید از هم جدا نگه دارد:

- `status`: وضعیت اصلی local user در Guardino، مثل active، disabled یا deleted
- `create_status`: وضعیت نحوه ساخت یا وضعیت اولین اتصال، مثل active یا on_hold

وقتی کاربر با on hold ساخته می‌شود:

- داخل پنل PasarGuard یا Marzban با status on_hold ساخته می‌شود.
- در لیست کاربران Guardino باید با عنوان "در انتظار اولین اتصال" نمایش داده شود.
- بعد از اولین اتصال، اگر پنل مقصد status را active کند یا مصرف بیشتر از صفر گزارش شود، Guardino هم `create_status` را active می‌کند.

این sync در دو جا انجام می‌شود:

- هنگام refresh گرفتن لینک‌ها
- در job دوره‌ای sync usage

## مصرف و نمایش ترافیک

Guardino مصرف را در `used_bytes` نگه می‌دارد. برای کاربر و رسیلر، حتی مصرف‌های کوچک باید قابل مشاهده باشد.

قواعد نمایش:

- اگر مصرف کمتر از 1GB است، با MB نمایش داده شود.
- اگر مصرف حتی 1MB باشد، نوار پیشرفت صفر مطلق نشان ندهد.
- مصرف کلی کاربر از مجموع subaccountهای فعال به‌روزرسانی می‌شود.

## لینک‌های ساب

Guardino دو نوع لینک به رسیلر نشان می‌دهد.

### لینک مستقیم پنل

این لینک از خود پنل مقصد می‌آید:

- Marzban subscription URL
- PasarGuard subscription URL
- WGDashboard config download URL

این لینک‌ها برای فروش عملیاتی پیشنهاد می‌شوند، چون مستقیم به نود یا پنل مربوطه وصل هستند.

### لینک ساب مرکزی Guardino

لینک مرکزی Guardino چند لینک را merge می‌کند و از مسیر عمومی Guardino ارائه می‌دهد:

```text
/api/v1/sub/{token}
```

برای WireGuard:

```text
/api/v1/sub/wg/{token}/{node_id}.conf
```

قانون مهم:

- لینک ساب مرکزی برای رسیلرها به صورت پیش‌فرض خاموش است.
- سوپرادمین یا رسیلر از بخش تنظیمات می‌توانند نمایش آن را فعال کنند.
- اگر خاموش باشد، در popup لینک‌ها نشان داده نمی‌شود.
- اگر روشن باشد، کنار لینک‌های مستقیم نمایش داده می‌شود.

## Revoke لینک‌ها

Revoke یعنی لینک قبلی دیگر قابل استفاده نباشد و لینک جدید ساخته شود.

رفتار فعلی:

- برای Marzban و PasarGuard، توکن/لینک ساب پنل مقصد rotate می‌شود، در حد توان adapter.
- برای WGDashboard، peer حذف و دوباره ساخته می‌شود.
- برای لینک مرکزی Guardino، `master_sub_token` عوض می‌شود.
- توکن قبلی Guardino در لیست revoked ذخیره می‌شود تا لینک قدیمی همچنان فعال نماند.

این رفتار برای جلوگیری از سوءاستفاده از لینک‌های قدیمی حیاتی است.

## حذف، ریفاند و کاهش حجم

حذف و ریفاند در endpoint عملیات کاربر انجام می‌شود:

```text
POST /api/v1/reseller/users/{user_id}/refund
```

قواعد اصلی حذف:

- اگر سیاست `allow_user_delete` خاموش باشد، رسیلر اجازه حذف ندارد.
- اگر کاربر از نظر زمان منقضی شده باشد، حذف/ریفاند مجاز نیست.
- اگر کاربر کل حجم خود را مصرف کرده باشد، حذف/ریفاند مجاز نیست.
- محدودیت زمان حذف از `delete_refund_window_days` می‌آید.
- محدودیت مصرف از `delete_expired_used_gb_limit` می‌آید.
- مقدار `0` برای `delete_expired_used_gb_limit` یعنی محدودیت مصرف برای حذف نامحدود است.
- مقدار اعشاری مجاز است، مثلا `0.5` یعنی حدود 500MB.
- اگر مصرف کاربر زیر 1GB باشد، هنگام حذف از مبلغ ریفاند کسر نمی‌شود.
- اگر مصرف حداقل 1GB باشد، مبلغ مصرف‌شده از ریفاند کم می‌شود.
- حذف کاربر در پنل مقصد best-effort انجام می‌شود و سپس local user به deleted تغییر می‌کند.

قانون مالی مهم:

اگر کاربر در Guardino وجود داشته باشد ولی در پنل مقصد حذف شده باشد، Guardino آن را به صورت خودکار local deleted می‌کند، اما هیچ مبلغی از حساب رسیلر کم یا زیاد نمی‌شود.

## صفر شدن موجودی رسیلر

وقتی موجودی رسیلر صفر یا کمتر باشد:

- ساخت کاربر مسدود می‌شود.
- ویرایش‌های هزینه‌دار مسدود می‌شود.
- دیدن کاربران و لینک‌ها مجاز است.
- revoke مجاز است.
- حذف کاربر از مسیر مخصوص delete همچنان می‌تواند طبق سیاست مجاز باشد.

این رفتار باعث می‌شود رسیلر بدون موجودی نتواند بدهی جدید بسازد، ولی بتواند سرویس‌های قبلی را مدیریت کند.

## سیاست‌های کاربر

سیاست‌ها در دو سطح وجود دارند:

- سیاست سراسری در تنظیمات سوپرادمین
- سیاست اختصاصی برای هر رسیلر

قانون اولویت:

- اگر برای رسیلر سیاست اختصاصی تعریف نشده باشد، سیاست سراسری اعمال می‌شود.
- اگر سیاست اختصاصی تعریف شده باشد، روی سیاست سراسری اولویت دارد.
- اگر سیاست اختصاصی غیرفعال یا حذف شود، رسیلر به سیاست سراسری برمی‌گردد.

فیلدهای مهم سیاست:

| فیلد | توضیح |
| --- | --- |
| `enabled` | فعال بودن محدودیت‌های سیاست |
| `allow_custom_days` | اجازه وارد کردن روز دستی |
| `allow_custom_traffic` | اجازه وارد کردن حجم دستی |
| `allow_no_expire` | اجازه پکیج بدون انقضا |
| `allow_user_delete` | اجازه حذف/ریفاند کاربر |
| `allow_reset_usage` | اجازه reset usage |
| `restrict_edit_to_renewal_only` | محدود کردن ویرایش به تمدید پکیجی |
| `renewal_policy` | سیاست محاسبه تمدید |
| `min_days` و `max_days` | حداقل و حداکثر روز مجاز |
| `delete_refund_window_days` | بازه مجاز حذف/ریفاند از زمان ساخت |
| `delete_expired_used_gb_limit` | سقف مصرف مجاز برای حذف |
| `allowed_duration_presets` | پکیج‌های زمانی مجاز |
| `allowed_traffic_gb` | حجم‌های مجاز |

## سیاست‌های تمدید

Guardino چهار سیاست تمدید دارد.

### reset_time_and_volume

زمان و حجم قبلی کنار گذاشته می‌شود.

```text
new_expire = now + purchased_days
new_total  = purchased_gb
used       = 0
```

### add_time_and_volume

زمان و حجم به دوره فعلی اضافه می‌شود.

```text
new_expire = max(old_expire, now) + purchased_days
new_total  = old_total + purchased_gb
used       = old_used
```

### reset_time_carry_volume

زمان ریست می‌شود، اما حجم باقی‌مانده قبلی به حجم جدید اضافه می‌شود.

```text
new_expire = now + purchased_days
new_total  = purchased_gb + remaining_gb
used       = 0
```

### reset_volume_carry_time

حجم ریست می‌شود، اما زمان باقی‌مانده قبلی حفظ و به زمان جدید اضافه می‌شود.

```text
new_expire = now + remaining_days + purchased_days
new_total  = purchased_gb
used       = 0
```

این سیاست‌ها فقط مخصوص حالت محدودیت ویرایش نیستند. سیاست تمدید باید همیشه از policy موثر رسیلر خوانده شود.

## تنظیمات پیش‌فرض کاربر

تنظیمات پیش‌فرض در دو سطح وجود دارند:

- Global defaults برای کل سیستم
- Reseller defaults برای هر رسیلر

فیلدهای مهم:

| فیلد | توضیح |
| --- | --- |
| `default_pricing_mode` | مقدار پیش‌فرض `bundle` یا `per_node` |
| `default_node_mode` | مقدار پیش‌فرض `all`، `manual` یا `group` |
| `default_node_ids` | نودهای پیش‌فرض |
| `default_node_group` | tag پیش‌فرض |
| `label_prefix` | prefix نام کاربر |
| `label_suffix` | suffix نام کاربر |
| `show_guardino_master_sub` | نمایش لینک ساب مرکزی Guardino |

قانون merge:

```text
global defaults
    + allocation default nodes
    + reseller defaults
    = effective defaults
```

نکته: فیلدهای legacy یعنی `username_prefix` و `username_suffix` هنوز در schema وجود دارند، اما عمدا با `label_prefix` و `label_suffix` mirror می‌شوند تا کل سیستم با نام یکپارچه کار کند.

## جست‌وجوی کاربران

لیست کاربران از سمت سرور جست‌وجو می‌شود:

```text
GET /api/v1/reseller/users?q=ali&offset=0&limit=50
```

قواعد فعلی:

- جست‌وجو فقط محدود به صفحه فعلی فرانت‌اند نیست.
- بخشی از نام کاربر با `ilike` پیدا می‌شود.
- اگر عبارت جست‌وجو عددی باشد، id کاربر هم بررسی می‌شود.
- کاربران deleted در لیست عادی نمایش داده نمی‌شوند.

## گزارش‌ها و دفترکل

Guardino برای شفافیت مالی دو مفهوم دارد:

- Orders: رخدادهای عملیاتی مثل create، renew، extend، add traffic، change nodes، refund و delete
- Ledger: تغییرات کیف پول با amount مثبت یا منفی و balance_after

گزارش‌ها باید برای رسیلر خلوت و قابل فهم باشند. نمایش idهای داخلی باید تا حد ممکن در جزئیات یا tooltip بماند و متن اصلی روی عملیات قابل فهم تمرکز کند.

توصیه برای نمایش فارسی:

- `create`: ساخت کاربر
- `extend`: افزایش زمان
- `add_traffic`: افزایش حجم
- `renew`: تمدید
- `change_nodes`: تغییر نودها
- `refund`: ریفاند/کاهش حجم
- `delete`: حذف و ریفاند

فرانت‌اند از helper تاریخ شمسی استفاده می‌کند:

```text
frontend/src/lib/jalali.ts
```

## sync مصرف و انقضا

Celery دو job دوره‌ای اصلی دارد:

- `sync_usage`
- `sync_expiry`

تنظیمات مرتبط:

```env
USAGE_SYNC_SECONDS=60
EXPIRY_SYNC_SECONDS=60
USAGE_SYNC_BATCH_SIZE=2000
EXPIRY_SYNC_BATCH_SIZE=500
```

محدوده‌ها در کد کنترل می‌شوند:

- sync interval بین 30 تا 3600 ثانیه clamp می‌شود.
- usage batch بین 100 تا 10000 clamp می‌شود.
- expiry batch بین 100 تا 10000 clamp می‌شود.

رفتارهای مهم sync:

- مصرف از پنل‌های مقصد خوانده می‌شود.
- برای WGDashboard تلاش می‌شود usage به صورت bulk خوانده شود.
- status پنل مقصد برای on hold/active بررسی می‌شود.
- اگر کاربر در پنل مقصد حذف شده باشد، subaccount حذف و اگر همه subaccountها missing باشند user در Guardino به deleted تغییر می‌کند.
- حذف ناشی از missing بودن در پنل مقصد هیچ ledger یا refund ایجاد نمی‌کند.
- اگر مصرف به حجم کل برسد، کاربر disabled می‌شود و روی پنل مقصد نیز محدود/غیرفعال می‌شود.

## API عمومی و docs

پس از اجرا:

```text
GET /docs
GET /openapi.json
GET /redoc
GET /health
```

Aliasهای nginx/backend:

```text
GET /api/docs
GET /api/openapi.json
GET /api/redoc
```

Health endpoint وضعیت دیتابیس و Redis را بررسی می‌کند:

```json
{
  "status": "ok",
  "db_ok": true,
  "redis_ok": true
}
```

## نصب سریع روی VPS

روش پیشنهادی:

```bash
bash <(curl -Ls --ipv4 https://raw.githubusercontent.com/Sir-Adnan/guardino-hub/main/installer/guardino.sh)
```

این دستور manager تعاملی را باز می‌کند. از منو گزینه `Install Panel` را انتخاب کنید.

با مسیر و branch دلخواه:

```bash
INSTALL_DIR=/opt/guardino-hub BRANCH=main \
bash <(curl -Ls --ipv4 https://raw.githubusercontent.com/Sir-Adnan/guardino-hub/main/installer/guardino.sh)
```

پس از نصب:

```text
Panel URL: http://SERVER_IP_OR_DOMAIN/
API Docs:  http://SERVER_IP_OR_DOMAIN/docs
```

اگر domain وارد کنید، installer امکان SSL با Let's Encrypt را می‌پرسد.

## نصب از سورس local

```bash
sudo bash installer/manage.sh
```

یا نصب غیرتعاملی:

```bash
sudo bash installer/manage.sh --install
```

آپدیت:

```bash
sudo bash installer/manage.sh --update
```

اسکریپت نصب کارهای زیر را انجام می‌دهد:

- نصب پیش‌نیازهای سیستم
- آماده‌سازی Docker و Docker Compose
- ساخت یا به‌روزرسانی `.env`
- تولید `SECRET_KEY` قوی
- تولید پسورد PostgreSQL در صورت نیاز
- تنظیم `DATABASE_URL`
- ساخت compose stack
- اجرای migrations
- ساخت superadmin در صورت نبودن
- تنظیم nginx و در صورت درخواست SSL

## دستورات manager

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

## متغیرهای محیطی

نمونه در `.env.example`:

```env
APP_NAME=guardino-hub
ENV=dev
SECRET_KEY=please-change-me
ACCESS_TOKEN_EXPIRE_MINUTES=10080

DATABASE_URL=postgresql+asyncpg://guardino:guardino@db:5432/guardino
REDIS_URL=redis://redis:6379/0

USAGE_SYNC_SECONDS=60
EXPIRY_SYNC_SECONDS=60
USAGE_SYNC_BATCH_SIZE=2000
EXPIRY_SYNC_BATCH_SIZE=500

REFUND_WINDOW_DAYS=10
CORS_ORIGINS=http://localhost:3000
PANEL_TLS_VERIFY=true
HTTP_TIMEOUT_SECONDS=15
```

متغیرهای مهم:

| متغیر | توضیح |
| --- | --- |
| `SECRET_KEY` | کلید امضای JWT، در production حتما قوی باشد |
| `DATABASE_URL` | اتصال backend به PostgreSQL |
| `REDIS_URL` | اتصال Celery و Redis |
| `USAGE_SYNC_SECONDS` | فاصله sync مصرف |
| `EXPIRY_SYNC_SECONDS` | فاصله sync انقضا |
| `REFUND_WINDOW_DAYS` | مقدار legacy پیش‌فرض برای ریفاند |
| `CORS_ORIGINS` | originهای مجاز برای فرانت |
| `PANEL_TLS_VERIFY` | بررسی TLS پنل‌های مقصد |
| `HTTP_TIMEOUT_SECONDS` | timeout درخواست‌های adapterها |

در نصب production، installer مقادیر حساس را خودش تولید یا تکمیل می‌کند.

## اجرای local با Docker Compose

برای توسعه سریع:

```bash
cp .env.example .env
docker compose up -d --build
docker compose exec api alembic upgrade head
docker compose exec api python -m app.cli create-superadmin --username admin --password 'CHANGE_ME_STRONG'
```

سپس:

```text
Frontend: http://localhost/
API:      http://localhost/api/v1
Docs:     http://localhost/docs
```

اگر frontend را جدا اجرا می‌کنید:

```bash
cd frontend
npm install
npm run dev
```

اگر backend را جدا اجرا می‌کنید:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Celery برای توسعه جدا:

```bash
cd backend
celery -A app.core.celery_app.celery_app worker --loglevel=INFO
celery -A app.core.celery_app.celery_app beat --loglevel=INFO
```

در Windows به جای `source .venv/bin/activate` از دستور مناسب PowerShell استفاده کنید:

```powershell
.\.venv\Scripts\Activate.ps1
```

## بکاپ و Restore

Guardino از backup archive با نام زیر استفاده می‌کند:

```text
guardino_backup_YYYYmmddTHHMMSSZ.tar.gz
```

مسیر پیش‌فرض:

```text
<INSTALL_DIR>/backups
```

### Full backup

شامل:

- PostgreSQL dump
- PostgreSQL globals
- `.env`
- `docker-compose.yml`
- فایل‌های nginx و SSL در صورت وجود
- پوشه certbot در صورت وجود
- metadata manifest

### Essential backup

نسخه سبک‌تر برای ارسال راحت‌تر:

- دیتابیس
- تنظیمات اصلی
- بدون آرشیوهای سنگین TLS

### ارسال بکاپ به تلگرام

از manager:

```bash
sudo bash installer/manage.sh --setup-telegram-full
sudo bash installer/manage.sh --setup-telegram-lite
```

مقادیر لازم:

- Bot Token از `@BotFather`
- Chat ID از botهای دریافت اطلاعات کاربر یا گروه
- Prefix سرور برای تشخیص بکاپ‌ها
- زمان‌بندی backup

فایل تنظیمات تلگرام:

```text
/etc/guardino-hub/telegram-backup.env
```

wrapper cron:

```text
/usr/local/bin/guardino-hub-backup.sh
```

نکته عملیاتی: در اسکریپت فعلی، نگهداری و پاک‌سازی بکاپ‌های قدیمی باید در سطح عملیات سرور مدیریت شود یا در توسعه بعدی به manager اضافه شود. اگر backup زمان‌بندی شده فعال است، حتما فضای دیسک را مانیتور کنید.

### Restore

```bash
sudo bash installer/manage.sh --restore /path/to/guardino_backup_YYYYmmddTHHMMSSZ.tar.gz
```

Restore کارهای زیر را انجام می‌دهد:

- بررسی ساختار archive
- توقف stack
- restore فایل‌های config
- reset volume دیتابیس در صورت نیاز
- import دیتابیس
- اجرای migrations
- راه‌اندازی دوباره stack

هشدار: restore وضعیت فعلی را overwrite می‌کند. قبل از restore از فایل backup و سرور مقصد مطمئن شوید.

## آپدیت

آپدیت:

```bash
sudo bash installer/manage.sh --update
```

یا:

```bash
sudo bash installer/update.sh
```

updater باید:

- کد جدید را دریافت کند
- فایل `.env` را بدون حذف مقادیر قبلی تکمیل کند
- migrationها را اجرا کند
- سرویس‌ها را rebuild/recreate کند
- تنظیمات sync پیش‌فرض را پایدار نگه دارد

برای تغییرات دیتابیس، همیشه Alembic migration اضافه کنید. تغییر مستقیم مدل بدون migration باعث خرابی آپدیت‌های production می‌شود.

## ساختار پوشه‌ها

```text
backend/
  app/
    api/
      deps.py
      v1/routes/
    core/
    models/
    schemas/
    services/
      adapters/
    tasks/
  alembic/
frontend/
  src/
    app/
    components/
    lib/
installer/
deploy/
docs/openapi/
docker-compose.yml
README.md
```

مسیرهای مهم backend:

- `backend/app/api/deps.py`: auth، نقش‌ها و محدودیت balance صفر
- `backend/app/api/v1/routes/reseller_user_ops.py`: ساخت کاربر و quote
- `backend/app/api/v1/routes/reseller_ops.py`: renew، extend، add traffic، refund، delete، reset و revoke
- `backend/app/api/v1/routes/reseller_links.py`: لینک‌ها و refresh snapshot
- `backend/app/services/pricing.py`: انتخاب نود و محاسبه قیمت
- `backend/app/services/user_defaults.py`: defaultهای ساخت کاربر
- `backend/app/services/reseller_user_policy.py`: سیاست‌های موثر کاربر
- `backend/app/services/subscription_tokens.py`: revoke token لینک مرکزی
- `backend/app/tasks/usage.py`: sync مصرف و status
- `backend/app/tasks/expiry.py`: sync انقضا

مسیرهای مهم frontend:

- `frontend/src/app/app/users/page.tsx`: لیست کاربران
- `frontend/src/app/app/users/new/page.tsx`: ساخت کاربر
- `frontend/src/app/app/users/[id]/page.tsx`: جزئیات و عملیات کاربر
- `frontend/src/app/app/settings/page.tsx`: تنظیمات
- `frontend/src/app/app/admin/resellers/page.tsx`: مدیریت رسیلرها
- `frontend/src/app/app/admin/nodes/page.tsx`: مدیریت نودها
- `frontend/src/app/app/admin/allocations/page.tsx`: تخصیص نودها
- `frontend/src/app/app/admin/reports/`: گزارش‌ها
- `frontend/src/components/ui/help-tip.tsx`: راهنمای hover/tap
- `frontend/src/lib/i18n.ts`: متن‌های فارسی/انگلیسی
- `frontend/src/lib/jalali.ts`: تاریخ شمسی

## نکات امنیتی

- `SECRET_KEY` را در production تغییر دهید و در git commit نکنید.
- اطلاعات پنل‌های مقصد داخل credentials حساس هستند.
- برای production، رمزنگاری credentials در دیتابیس را اضافه کنید.
- روی سرور production فقط پورت‌های لازم را باز بگذارید.
- اگر SSL فعال است، renew certbot را مانیتور کنید.
- backupها شامل اطلاعات حساس هستند، پس دسترسی فایل و مقصد تلگرام را محدود نگه دارید.
- بعد از restore، صحت login، sync، link generation و اتصال پنل‌ها را تست کنید.
- نقش admin باید فقط از دیتابیس خوانده شود، نه از parent_id یا داده قابل دستکاری.

## تست و بررسی سلامت

دستورات پیشنهادی:

```bash
docker compose ps
docker compose logs -f api
docker compose logs -f worker
docker compose logs -f beat
curl http://localhost/health
```

اجرای migration:

```bash
docker compose exec api alembic upgrade head
```

ساخت superadmin:

```bash
docker compose exec api python -m app.cli create-superadmin --username admin --password 'CHANGE_ME_STRONG'
```

بررسی WireGuard jobs:

```bash
docker compose exec api python -m app.cli reconcile-wg --dry-run
docker compose exec api python -m app.cli reconcile-wg --batch-size 500
```

Frontend build:

```bash
cd frontend
npm run build
```

## عیب‌یابی سریع

### پنل باز نمی‌شود

- `docker compose ps` را بررسی کنید.
- لاگ nginx، api و web را ببینید.
- `/health` را تست کنید.
- مطمئن شوید `.env` و `DATABASE_URL` درست هستند.

### ساخت کاربر خطای پنل مقصد می‌دهد

- در بخش نودها test connection بگیرید.
- base_url و credentials را بررسی کنید.
- برای PasarGuard، فایل OpenAPI و endpointهای adapter را با نسخه نصب‌شده مقایسه کنید.
- اگر فقط یک نود قطع است، تخصیص یا نودهای پیش‌فرض رسیلر را اصلاح کنید تا ساخت روی نود سالم انجام شود.

### رسیلر نمی‌تواند کاربر بسازد

- موجودی رسیلر را بررسی کنید.
- status رسیلر باید active باشد.
- policy موثر رسیلر را بررسی کنید.
- نودهای تخصیص داده‌شده باید enabled باشند.
- اگر policy پکیج‌ها را محدود کرده، حجم و مدت انتخابی باید مجاز باشد.

### لینک مرکزی Guardino نمایش داده نمی‌شود

- `show_guardino_master_sub` در تنظیمات موثر رسیلر باید روشن باشد.
- کاربر نباید deleted باشد.
- لینک‌های مستقیم نودها مستقل از لینک مرکزی نمایش داده می‌شوند.

### کاربر on hold هنوز فعال نشده

- sync usage و refresh لینک‌ها را بررسی کنید.
- اگر پنل مقصد status را هنوز on_hold می‌دهد، Guardino هم آن را on_hold نگه می‌دارد.
- اگر مصرف کاربر بیشتر از صفر شود، Guardino باید `create_status` را active کند.

### کاربر در پنل مقصد حذف شده ولی در Guardino هست

- sync usage یا refresh لینک با `refresh=true` باید remote missing را تشخیص دهد.
- اگر همه subaccountهای کاربر missing باشند، Guardino user را local deleted می‌کند.
- این حذف هیچ تراکنش مالی ایجاد نمی‌کند.

## راهنمای توسعه برای انسان و هوش مصنوعی

این پروژه حساس مالی و عملیاتی است. هر تغییر باید با قواعد زیر انجام شود.

### قواعد غیرقابل شکستن

- label و username در تجربه جدید یکی هستند.
- نام کاربر در Guardino، Marzban و PasarGuard باید یکسان بماند.
- prefix و suffix باید روی دستی و random اعمال شوند.
- لینک مرکزی Guardino برای رسیلرها پیش‌فرض خاموش است.
- revoke لینک مرکزی باید توکن قبلی را واقعا باطل کند.
- رسیلر با موجودی صفر نباید بتواند create یا edit هزینه‌دار انجام دهد.
- رسیلر با موجودی صفر باید بتواند کاربران و لینک‌ها را ببیند و revoke کند.
- حذف کاربر expired یا volume-exhausted نباید مجاز باشد.
- حذف ناشی از نبودن کاربر در پنل مقصد نباید ledger یا refund ایجاد کند.
- سیاست اختصاصی رسیلر فقط وقتی تعریف شده باشد باید روی سیاست سراسری اولویت داشته باشد.
- مقدار `delete_expired_used_gb_limit = 0` یعنی بدون سقف مصرف برای حذف.
- مصرف زیر 1GB هنگام delete از مبلغ ریفاند کم نمی‌شود.
- مدت preset یک ماهه 31 روز است.
- on hold باید بعد از اولین اتصال یا مصرف واقعی به active تبدیل شود.
- جست‌وجوی کاربران باید server-side و مستقل از صفحه فعلی باشد.
- تغییر مدل دیتابیس باید migration داشته باشد.
- adapterها باید خطاهای پنل مقصد را واضح و قابل debug برگردانند.

### ترتیب پیشنهادی برای هر توسعه

1. کد مرتبط را بخوانید، مخصوصا route، schema، service و frontend همان بخش.
2. مدل داده و migration را بررسی کنید.
3. رفتار فعلی را با README و UI موجود تطبیق دهید.
4. تغییر را کوچک و محدود انجام دهید.
5. اگر رفتار مالی تغییر می‌کند، ledger و order را دقیق بررسی کنید.
6. اگر رفتار پنل مقصد تغییر می‌کند، adapter همان پنل را جدا تست کنید.
7. متن‌های فارسی و انگلیسی `i18n.ts` را به‌روزرسانی کنید.
8. responsive بودن موبایل را بررسی کنید.
9. build یا تست مرتبط را اجرا کنید.
10. README را در صورت تغییر رفتار عمومی به‌روزرسانی کنید.

### نقاط حساس مالی

- `backend/app/services/pricing.py`
- `backend/app/api/v1/routes/reseller_user_ops.py`
- `backend/app/api/v1/routes/reseller_ops.py`
- `backend/app/models/order.py`
- `backend/app/models/ledger.py`
- `backend/app/services/refund.py`

هر تغییری که balance، charged_amount، refunded_amount، order یا ledger را لمس کند باید با سناریوهای زیر تست شود:

- ساخت کاربر با per-node
- ساخت کاربر با bundle
- ساخت کاربر با price override روی allocation
- تمدید با هر چهار renewal policy
- حذف کاربر با مصرف کمتر از 1GB
- حذف کاربر با مصرف بیشتر از 1GB
- عدم اجازه حذف کاربر expired
- عدم اجازه حذف کاربر volume-exhausted
- صفر بودن موجودی رسیلر

### نقاط حساس پنل‌های مقصد

- `backend/app/services/adapters/base.py`
- `backend/app/services/adapters/marzban.py`
- `backend/app/services/adapters/pasarguard.py`
- `backend/app/services/adapters/wg_dashboard.py`
- `backend/app/services/status_policy.py`
- `backend/app/tasks/usage.py`
- `backend/app/tasks/expiry.py`

برای adapter جدید یا تغییر API:

- interface پایه را حفظ کنید.
- `get_user_snapshot` را اگر ممکن است پیاده کنید.
- خطای user not found را به `RemoteUserNotFound` تبدیل کنید.
- delete/revoke/reset را idempotent و best-effort طراحی کنید.
- لینک مستقیم را normalize کنید تا relative URL هم درست کار کند.

### نقاط حساس UI

- فرم‌ها باید در موبایل از کادر بیرون نزنند.
- help textها نباید خودکار باز بمانند.
- راهنماها باید با hover روی desktop و tap/click روی موبایل قابل خواندن باشند.
- popup لینک‌ها نباید زیر header برود.
- دکمه ساخت کاربر در header باید کوتاه، خوانا و responsive باشد.
- محیط رسیلر باید خلوت‌تر از محیط سوپرادمین باشد.

## پرامپت پیشنهادی برای توسعه آینده با هوش مصنوعی

از این متن می‌توانید برای ادامه توسعه پروژه با یک AI coding agent استفاده کنید:

```text
تو روی پروژه Guardino Hub کار می‌کنی؛ یک پنل مرکزی فروش و مدیریت VPN برای سوپرادمین و رسیلرها که به PasarGuard، Marzban و WGDashboard وصل می‌شود.

اول کل بخش مرتبط را از کد بخوان: backend route/schema/service/model، adapter مربوط، frontend page/component و README. بدون بررسی کد تصمیم نگیر.

قواعد محصول را حفظ کن:
- label و username یکی هستند و نام کاربر در Guardino و پنل‌های مقصد باید یکسان باشد.
- prefix/suffix باید روی نام دستی و random اعمال شود.
- لینک ساب مرکزی Guardino برای رسیلرها پیش‌فرض خاموش است و فقط با setting نمایش داده می‌شود.
- revoke لینک مرکزی باید توکن قبلی را باطل کند.
- رسیلر با موجودی صفر حق create/edit هزینه‌دار ندارد اما باید بتواند لینک‌ها را ببیند، revoke کند و طبق policy حذف کند.
- حذف کاربر expired یا volume-exhausted مجاز نیست.
- اگر کاربر از پنل مقصد حذف شده بود، Guardino آن را local deleted کند اما هیچ تراکنش مالی نسازد.
- سیاست رسیلر اگر تعریف نشده باشد باید از سیاست سراسری inherit شود؛ override اختصاصی فقط وقتی فعال/تعریف شده باشد اولویت دارد.
- سیاست تمدید همیشه از effective policy خوانده شود، نه فقط وقتی ویرایش محدود شده است.
- preset یک ماهه 31 روز است.
- on hold باید بعد از اولین اتصال یا مصرف واقعی به active تبدیل شود.
- جست‌وجوی کاربران باید server-side باشد و فقط صفحه فعلی را فیلتر نکند.

برای تغییرات مالی، order و ledger و balance را با سناریوهای create, renew, refund, delete تست کن. برای تغییرات دیتابیس Alembic migration بنویس. برای تغییرات UI حتما موبایل و RTL را در نظر بگیر. از الگوهای موجود پروژه استفاده کن و README را بعد از تغییر رفتار عمومی به‌روزرسانی کن.
```

## پیشنهادهای توسعه بعدی

این موارد برای نسخه‌های بعدی ارزشمند هستند:

- رمزنگاری credentials نودها در دیتابیس
- تست خودکار برای سیاست‌های مالی و تمدید
- تست integration برای PasarGuard 5.x با mock server
- retention داخلی برای پاک‌سازی خودکار بکاپ‌های قدیمی
- UI اختصاصی برای انتخاب Groups آماده PasarGuard به ازای هر نود، اگر نیاز محصول از حالت all-inbounds فراتر رفت
- audit log کامل برای تغییر سیاست‌ها، قیمت‌ها و موجودی
- export گزارش‌ها به CSV و Excel
- role/permission جزئی‌تر برای اپراتورها
- health dashboard برای نودهای بالادستی

## مجوز و وضعیت

این README وضعیت فعلی پروژه را برای نصب، استفاده، عملیات و توسعه توضیح می‌دهد. اگر قابلیت جدیدی اضافه شد که روی رفتار عمومی، مالی، API یا نصب اثر دارد، همین فایل باید همزمان به‌روزرسانی شود.

## Guardino Server Command

Linux deployments install a global command during setup:

```bash
bash <(curl -Ls --ipv4 https://raw.githubusercontent.com/Sir-Adnan/guardino-hub/main/installer/guardino.sh)
guardino help
Guardino help
```

The remote one-liner runs the installer by default. After installation, the local `guardino` command shows help when no command is passed.

Important commands:

```bash
guardino up
guardino down
guardino restart
guardino rebuild
guardino status
guardino logs api
guardino edit-env
guardino backup full
guardino backup-service full
guardino restore /path/to/guardino_backup_YYYYmmddTHHMMSSZ.tar.gz
guardino domain set panel.example.com
guardino ssl issue panel.example.com admin@example.com
guardino ssl renew
guardino doctor
```

`edit-env` opens `.env` with nano, validates critical numeric settings, creates a timestamped backup, and offers to restart the stack so changes such as `USAGE_SYNC_SECONDS` and `EXPIRY_SYNC_SECONDS` take effect.

The installer writes both `/usr/local/bin/guardino` and `/usr/local/bin/Guardino`. To refresh them manually:

```bash
cd /opt/guardino-hub
bash installer/guardinoctl.sh install-script
```
