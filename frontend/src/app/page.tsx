import type { Metadata } from "next";
import Link from "next/link";
import { Vazirmatn } from "next/font/google";
import {
  Bot,
  CheckCircle2,
  ArrowLeft,
  CircleDollarSign,
  BadgeCheck,
  BarChart3,
  Boxes,
  Cable,
  Clock3,
  CreditCard,
  Download,
  Globe2,
  Layers3,
  LifeBuoy,
  Lock,
  MessageSquareText,
  Rocket,
  Server,
  ShieldCheck,
  Smartphone,
  Sparkles,
  TimerReset,
  Users,
  Wallet,
} from "lucide-react";

const vazir = Vazirmatn({ subsets: ["arabic", "latin"], weight: ["400", "500", "600", "700", "800"] });

export const metadata: Metadata = {
  title: "Guardino Hub | پنل حرفه ای فروش نمایندگی VPN",
  description:
    "گاردینو هاب؛ سیستم تمام‌عیار مدیریت فروش VPN برای ادمین و رسیلر، با پشتیبانی Marzban/Pasarguard/WGDashboard، محاسبه هوشمند قیمت، گزارش مالی و ساب مرکزی.",
  keywords: [
    "پنل فروش VPN",
    "پنل رسیلری",
    "Marzban",
    "Pasarguard",
    "WGDashboard",
    "Guardino Hub",
    "پنل مدیریت کاربران VPN",
  ],
  openGraph: {
    title: "Guardino Hub | پنل حرفه ای فروش نمایندگی VPN",
    description:
      "مدیریت کامل رسیلر، نود و کاربر با رابط حرفه ای، گزارشات مالی دقیق، ساخت گروهی کاربران و لینک ساب مرکزی.",
    type: "website",
    locale: "fa_IR",
  },
};

const featureCards = [
  {
    icon: <Layers3 size={20} />,
    title: "مدیریت چند پنل در یک داشبورد",
    text: "اتصال همزمان به Marzban، Pasarguard و WGDashboard و مدیریت یکپارچه کاربران.",
  },
  {
    icon: <CreditCard size={20} />,
    title: "قیمت گذاری هوشمند",
    text: "حالت Bundle و Per-Node، محاسبه خودکار هزینه حجم/زمان و کنترل دقیق روی سود.",
  },
  {
    icon: <Users size={20} />,
    title: "ساخت تکی و گروهی",
    text: "ساخت سریع تعداد بالا کاربر با وضعیت لحظه ای عملیات، گزارش موفق/ناموفق و لینک آماده.",
  },
  {
    icon: <BarChart3 size={20} />,
    title: "دفتر کل و گزارشات شفاف",
    text: "تاریخچه کامل تراکنش ها، سفارشات، شارژ/کسر و کنترل مالی برای ادمین و رسیلر.",
  },
  {
    icon: <ShieldCheck size={20} />,
    title: "کنترل دسترسی و سیاست فروش",
    text: "قوانین اختصاصی برای هر رسیلر: پکیج مجاز، مدت زمان مجاز، نود پیش فرض و محدودیت ها.",
  },
  {
    icon: <TimerReset size={20} />,
    title: "اتوماسیون عملیات روزانه",
    text: "همگام‌سازی مصرف، مدیریت انقضا، قطع/وصل خودکار و به‌روزرسانی وضعیت کاربران.",
  },
  {
    icon: <Download size={20} />,
    title: "لینک و کانفیگ آماده تحویل",
    text: "کپی لینک مستقیم هر نود، ساب مرکزی Guardino و دانلود فایل .conf برای WireGuard.",
  },
];

const flows = [
  { icon: <Server size={18} />, title: "۱) اتصال نودها", desc: "پنل‌های مرزبان، پاسارگارد و WGDashboard را با API رسمی متصل کنید." },
  { icon: <Users size={18} />, title: "۲) تعریف ساختار فروش", desc: "رسیلر بسازید، قیمت‌گذاری و سیاست فروش هر سطح را تنظیم کنید." },
  { icon: <CircleDollarSign size={18} />, title: "۳) صدور و فروش اشتراک", desc: "ساخت تکی/گروهی کاربر، تحویل لینک/کانفیگ و کسر هزینه خودکار." },
  { icon: <BarChart3 size={18} />, title: "۴) کنترل و رشد", desc: "گزارش مالی، دفتر کل، مدیریت مصرف و تصمیم‌گیری مبتنی بر داده." },
];

const highlights = [
  { label: "تحویل سریع", value: "کمتر از ۶۰ ثانیه" },
  { label: "پنل های پشتیبانی شده", value: "۳ نوع" },
  { label: "مدیریت همزمان", value: "تکی + گروهی" },
  { label: "گزارش مالی", value: "کاملا شفاف" },
];

const benefits = [
  {
    icon: <CircleDollarSign size={18} />,
    title: "افزایش سود واقعی",
    text: "با قیمت‌گذاری دقیق Bundle/Per-Node و کنترل ریزتراکنش‌ها، حاشیه سود قابل پیش‌بینی می‌شود.",
  },
  {
    icon: <LifeBuoy size={18} />,
    title: "کاهش فشار پشتیبانی",
    text: "تحویل لینک مستقیم، ساب مرکزی و دانلود .conf باعث کاهش خطای کاربر و تیکت پشتیبانی می‌شود.",
  },
  {
    icon: <Bot size={18} />,
    title: "عملیات نیمه‌خودکار",
    text: "بخش‌های مهم مانند وضعیت کاربر، تمدید، ریفاند و همگام‌سازی مصرف با کمترین دخالت دستی انجام می‌شود.",
  },
];

const platformCards = [
  {
    icon: <ShieldCheck size={18} />,
    title: "برای ادمین اصلی",
    points: [
      "مدیریت کامل رسیلرها، نودها و تخصیص‌ها",
      "کنترل سیاست‌های فروش برای هر رسیلر",
      "گزارش‌گیری مالی و رهگیری تراکنش‌ها",
      "مدیریت پیش‌فرض‌ها و استانداردسازی عملیات",
    ],
  },
  {
    icon: <Rocket size={18} />,
    title: "برای رسیلر",
    points: [
      "ساخت سریع کاربران با قالب‌های آماده",
      "مدیریت لینک‌ها، تمدید و افزایش/کاهش حجم",
      "مشاهده شفاف موجودی و تاریخچه عملکرد",
      "فرآیند فروش ساده، سریع و حرفه‌ای",
    ],
  },
];

const faqs = [
  {
    q: "آیا گاردینو برای فروش روزانه در مقیاس بالا مناسب است؟",
    a: "بله. ساخت گروهی کاربر، مدیریت چند نود و گزارش مالی یکپارچه دقیقا برای سناریوهای فروش مستمر و حجیم طراحی شده است.",
  },
  {
    q: "برای شروع چه چیزهایی لازم است؟",
    a: "فقط نودهای فعال و دسترسی API پنل‌ها. بعد از اتصال، می‌توانید رسیلر تعریف کنید و فروش را همان روز شروع کنید.",
  },
  {
    q: "آیا می‌توان روی مدل فروش هر رسیلر محدودیت گذاشت؟",
    a: "بله. تعیین پکیج‌های مجاز، مدت زمان مجاز، نود پیش‌فرض و سیاست‌های قیمت برای هر رسیلر قابل تنظیم است.",
  },
  {
    q: "خروجی برای کاربر نهایی چه شکلی است؟",
    a: "لینک مستقیم هر پنل، ساب مرکزی Guardino و برای نودهای WireGuard، فایل .conf دانلودی ارائه می‌شود.",
  },
];

export default function Home() {
  return (
    <main className={`${vazir.className} guardino-landing min-h-screen`}>
      <div className="bg-shape bg-shape-a" />
      <div className="bg-shape bg-shape-b" />
      <div className="bg-shape bg-shape-c" />

      <header className="sticky top-0 z-30 border-b border-[hsl(var(--border))]/60 bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-[linear-gradient(135deg,#0ea5e9,#22c55e)] text-white shadow-lg shadow-cyan-500/20">
              <ShieldCheck size={20} />
            </div>
            <div>
              <div className="text-sm font-extrabold tracking-tight sm:text-base">Guardino Hub</div>
              <div className="text-[11px] text-[hsl(var(--fg))]/60 sm:text-xs">Smart VPN Reseller Platform</div>
            </div>
          </div>

          <nav className="hidden items-center gap-1 md:flex">
            <a href="#features" className="landing-nav-link">امکانات</a>
            <a href="#benefits" className="landing-nav-link">مزایا</a>
            <a href="#workflow" className="landing-nav-link">نحوه کار</a>
            <a href="#faq" className="landing-nav-link">سوالات رایج</a>
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            <Link
              href="/login"
              className="inline-flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-xs font-semibold text-[hsl(var(--fg))] transition hover:-translate-y-0.5 hover:border-cyan-300 sm:px-4 sm:text-sm"
            >
              ورود به پنل <ArrowLeft size={15} />
            </Link>
          </div>
        </div>
      </header>

      <section className="mx-auto w-full max-w-7xl px-4 pb-10 pt-10 sm:px-6 sm:pt-16">
        <div className="grid items-center gap-8 lg:grid-cols-2 lg:gap-12">
          <div className="stagger-item">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-xs font-semibold text-cyan-700">
              <BadgeCheck size={14} /> آماده برای فروش حرفه ای و مقیاس پذیر
            </div>
            <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-slate-900 sm:text-5xl">
              پنل رسیلری حرفه ای که فروش VPN را
              <span className="block bg-[linear-gradient(90deg,#0ea5e9,#22c55e)] bg-clip-text text-transparent">سریع، دقیق و سودآور</span>
              می کند
            </h1>
            <p className="mt-5 max-w-xl text-sm leading-7 text-slate-600 sm:text-base">
              Guardino Hub تمام عملیات فروش را از مدیریت نود و رسیلر تا ساخت کاربر، لینک اشتراک، گزارش مالی و کنترل وضعیت در یک محیط شیک و
              کاربردی یکپارچه می کند.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-bold text-white transition hover:-translate-y-0.5 hover:bg-slate-800"
              >
                شروع همکاری به عنوان رسیلر <ArrowLeft size={16} />
              </Link>
              <a
                href="#features"
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-800 transition hover:-translate-y-0.5 hover:border-slate-400"
              >
                مشاهده امکانات <Sparkles size={16} />
              </a>
            </div>

            <div className="mt-6 grid max-w-xl gap-2 sm:grid-cols-2">
              <div className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-xs text-slate-700">
                <CheckCircle2 size={14} className="text-emerald-600" /> پشتیبانی چند پنل در یک محیط
              </div>
              <div className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-xs text-slate-700">
                <CheckCircle2 size={14} className="text-emerald-600" /> مناسب تیم‌های فروش حرفه‌ای
              </div>
              <div className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-xs text-slate-700">
                <CheckCircle2 size={14} className="text-emerald-600" /> تحلیل مصرف و گزارش مالی دقیق
              </div>
              <div className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-xs text-slate-700">
                <CheckCircle2 size={14} className="text-emerald-600" /> تحویل سریع لینک و کانفیگ
              </div>
            </div>
          </div>

          <div className="stagger-item">
            <div className="glass-card float-card grid gap-3 rounded-3xl border border-slate-200 bg-white/90 p-4 shadow-xl shadow-slate-200/50 sm:p-6">
              <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div>
                  <div className="text-xs text-slate-500">وضعیت فروش روزانه</div>
                  <div className="mt-1 text-xl font-extrabold text-slate-900">پایدار و رو به رشد</div>
                </div>
                <div className="grid h-11 w-11 place-items-center rounded-xl bg-emerald-100 text-emerald-700">
                  <Wallet size={20} />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {highlights.map((item) => (
                  <div key={item.label} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                    <div className="text-xs text-slate-500">{item.label}</div>
                    <div className="mt-1 text-base font-bold text-slate-900">{item.value}</div>
                  </div>
                ))}
              </div>

              <div className="rounded-2xl border border-slate-200 bg-[linear-gradient(135deg,#082f49,#0f766e)] p-4 text-white">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <Lock size={16} /> امنیت و پایداری عملیات
                </div>
                <p className="text-xs leading-6 text-cyan-100 sm:text-sm">
                  کنترل وضعیت کاربران، همگام سازی مصرف، مدیریت انقضا و ثبت دقیق گزارشات مالی به صورت یکپارچه برای ادمین و رسیلر.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-xs text-slate-500">سطح اتوماسیون عملیات</div>
                  <div className="text-xs font-bold text-slate-900">۸۵٪</div>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full w-[85%] animated-bar rounded-full bg-[linear-gradient(90deg,#0ea5e9,#22c55e)]" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="mx-auto w-full max-w-7xl px-4 pb-8 sm:px-6 sm:pb-12">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div className="stagger-item">
            <div className="text-xs font-semibold text-cyan-700">FEATURES</div>
            <h2 className="mt-1 text-2xl font-extrabold text-slate-900 sm:text-3xl">تمام ابزارهای لازم برای رشد سریع فروش</h2>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {featureCards.map((item) => (
            <article
              key={item.title}
              className="stagger-item rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:shadow-lg"
            >
              <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-700">{item.icon}</div>
              <h3 className="text-lg font-bold text-slate-900">{item.title}</h3>
              <p className="mt-2 text-sm leading-7 text-slate-600">{item.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="benefits" className="mx-auto w-full max-w-7xl px-4 pb-8 sm:px-6 sm:pb-12">
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="stagger-item rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-7">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
              <Wallet size={14} /> چرا این پنل برای فروش بهتر است؟
            </div>
            <h2 className="text-2xl font-extrabold text-slate-900">مزیت رقابتی واقعی برای رشد سریع</h2>
            <p className="mt-3 text-sm leading-7 text-slate-600">
              گاردینو فقط یک رابط ساده نیست؛ یک سیستم اجرایی کامل برای تیم فروش است که باعث می‌شود عملیات روزمره با خطای کمتر و سرعت بیشتر انجام
              شود.
            </p>
            <div className="mt-5 space-y-3">
              {benefits.map((item) => (
                <div key={item.title} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-2 flex items-center gap-2 font-bold text-slate-900">
                    <span className="grid h-8 w-8 place-items-center rounded-lg bg-white text-slate-700">{item.icon}</span>
                    {item.title}
                  </div>
                  <p className="text-sm leading-7 text-slate-600">{item.text}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="stagger-item grid gap-4">
            {platformCards.map((block) => (
              <article key={block.title} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
                  {block.icon} {block.title}
                </div>
                <div className="space-y-2">
                  {block.points.map((p) => (
                    <div key={p} className="flex items-start gap-2 text-sm text-slate-700">
                      <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" />
                      <span className="leading-7">{p}</span>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="workflow" className="mx-auto w-full max-w-7xl px-4 pb-8 sm:px-6 sm:pb-12">
        <div className="stagger-item rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <div className="mb-5 flex items-center gap-2 text-sm font-bold text-slate-800">
            <Cable size={17} /> جریان کاری پیشنهادی برای شروع سریع
          </div>
          <div className="grid gap-3 lg:grid-cols-4">
            {flows.map((item) => (
              <div key={item.title} className="workflow-step rounded-2xl border border-slate-200 bg-slate-50 p-4 transition">
                <div className="mb-2 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white text-slate-700">{item.icon}</div>
                <div className="font-bold text-slate-900">{item.title}</div>
                <div className="mt-1 text-sm leading-7 text-slate-600">{item.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-4 pb-8 sm:px-6 sm:pb-12">
        <div className="stagger-item rounded-3xl border border-slate-200 bg-[linear-gradient(135deg,#082f49,#111827)] p-5 text-white shadow-xl sm:p-7">
          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-cyan-300/30 bg-cyan-500/10 px-3 py-1 text-xs font-semibold text-cyan-100">
                <Globe2 size={14} /> زیرساخت مدرن برای فروش پایدار
              </div>
              <h3 className="text-2xl font-extrabold">یک پنل، چند خروجی حرفه‌ای برای مشتری نهایی</h3>
              <p className="mt-3 text-sm leading-7 text-cyan-100/90">
                هر کاربر می‌تواند از لینک مستقیم نودها، ساب مرکزی گاردینو یا فایل WireGuard استفاده کند. این انعطاف باعث رضایت بیشتر کاربران و
                کاهش درخواست‌های پشتیبانی می‌شود.
              </p>
            </div>
            <div className="grid gap-3">
              <div className="rounded-2xl border border-cyan-300/20 bg-white/10 p-4">
                <div className="mb-1 flex items-center gap-2 font-bold"><Download size={16} /> خروجی متنوع</div>
                <div className="text-sm text-cyan-100/90">ساب مرکزی + لینک مستقیم + دانلود .conf</div>
              </div>
              <div className="rounded-2xl border border-cyan-300/20 bg-white/10 p-4">
                <div className="mb-1 flex items-center gap-2 font-bold"><MessageSquareText size={16} /> تجربه کاربری بهتر</div>
                <div className="text-sm text-cyan-100/90">رابط ساده برای اپراتور فروش و قابل فهم برای رسیلر.</div>
              </div>
              <div className="rounded-2xl border border-cyan-300/20 bg-white/10 p-4">
                <div className="mb-1 flex items-center gap-2 font-bold"><Bot size={16} /> تصمیم‌گیری سریع</div>
                <div className="text-sm text-cyan-100/90">گزارش لحظه‌ای مصرف، مانده، سفارشات و عملکرد فروش.</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="faq" className="mx-auto w-full max-w-7xl px-4 pb-8 sm:px-6 sm:pb-12">
        <div className="stagger-item rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <div className="mb-4 text-xs font-semibold text-cyan-700">FAQ</div>
          <h2 className="mb-5 text-2xl font-extrabold text-slate-900">سوالات رایج قبل از شروع همکاری</h2>
          <div className="space-y-3">
            {faqs.map((item) => (
              <details key={item.q} className="faq-item group rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <summary className="cursor-pointer list-none text-sm font-bold text-slate-900">{item.q}</summary>
                <p className="mt-2 text-sm leading-7 text-slate-600">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-4 pb-16 sm:px-6">
        <div className="stagger-item rounded-3xl border border-slate-200 bg-[linear-gradient(135deg,#0f172a,#0b3558)] p-6 text-white shadow-2xl sm:p-9">
          <div className="grid items-center gap-5 lg:grid-cols-2">
            <div>
              <h2 className="text-2xl font-extrabold leading-tight sm:text-3xl">برای شروع فروش حرفه ای آماده ای؟</h2>
              <p className="mt-3 text-sm leading-7 text-cyan-100 sm:text-base">
                همین الان وارد پنل شو، نودها را اضافه کن، قیمت رسیلرها را تعریف کن و فروش واقعی را با گزارش مالی دقیق و تحویل سریع لینک/کانفیگ
                شروع کن.
              </p>
              <div className="mt-5 flex flex-wrap gap-3 text-xs text-cyan-100 sm:text-sm">
                <span className="inline-flex items-center gap-1 rounded-full border border-cyan-300/30 px-3 py-1">
                  <Clock3 size={14} /> راه اندازی سریع
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-cyan-300/30 px-3 py-1">
                  <Smartphone size={14} /> ریسپانسیو
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-cyan-300/30 px-3 py-1">
                  <Boxes size={14} /> مقیاس پذیر
                </span>
              </div>
            </div>
            <div className="flex justify-start lg:justify-end">
              <Link
                href="/login"
                className="inline-flex w-full max-w-xs items-center justify-center gap-2 rounded-2xl bg-white px-6 py-4 text-sm font-extrabold text-slate-900 transition hover:-translate-y-0.5 hover:bg-cyan-50"
              >
                ورود به پنل Guardino <ArrowLeft size={16} />
              </Link>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200/80 bg-white/80 backdrop-blur">
        <div className="mx-auto grid w-full max-w-7xl gap-8 px-4 py-10 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
          <div>
            <div className="mb-2 text-lg font-extrabold text-slate-900">Guardino Hub</div>
            <p className="text-sm leading-7 text-slate-600">
              زیرساخت حرفه‌ای مدیریت فروش VPN برای تیم‌هایی که می‌خواهند فروش را ساختاری، قابل‌گسترش و سودآور پیش ببرند.
            </p>
          </div>

          <div>
            <div className="mb-3 text-sm font-extrabold text-slate-900">دسترسی سریع</div>
            <div className="space-y-2 text-sm text-slate-600">
              <a href="#features" className="footer-link">امکانات</a>
              <a href="#benefits" className="footer-link">مزایا</a>
              <a href="#workflow" className="footer-link">نحوه کار</a>
              <a href="#faq" className="footer-link">سوالات رایج</a>
            </div>
          </div>

          <div>
            <div className="mb-3 text-sm font-extrabold text-slate-900">ویژگی‌های کلیدی</div>
            <div className="space-y-2 text-sm text-slate-600">
              <div className="inline-flex items-center gap-2"><CheckCircle2 size={14} className="text-emerald-600" /> مدیریت چندپنلی</div>
              <div className="inline-flex items-center gap-2"><CheckCircle2 size={14} className="text-emerald-600" /> گزارش مالی دقیق</div>
              <div className="inline-flex items-center gap-2"><CheckCircle2 size={14} className="text-emerald-600" /> ساب مرکزی و لینک مستقیم</div>
              <div className="inline-flex items-center gap-2"><CheckCircle2 size={14} className="text-emerald-600" /> ساخت تکی و گروهی کاربر</div>
            </div>
          </div>

          <div>
            <div className="mb-3 text-sm font-extrabold text-slate-900">شروع سریع</div>
            <p className="mb-4 text-sm leading-7 text-slate-600">برای شروع همکاری و ورود به محیط مدیریت فروش از دکمه زیر استفاده کنید.</p>
            <Link
              href="/login"
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white transition hover:-translate-y-0.5 hover:bg-slate-800"
            >
              ورود به پنل <ArrowLeft size={15} />
            </Link>
          </div>
        </div>
        <div className="border-t border-slate-200/80 py-4 text-center text-xs text-slate-500">
          © {new Date().getFullYear()} Guardino Hub. All rights reserved.
        </div>
      </footer>
    </main>
  );
}
