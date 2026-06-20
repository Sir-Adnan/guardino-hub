"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { copyText } from "@/lib/copy";
import { fmtNumber, formatNumberWithDigits } from "@/lib/format";
import { formatJalaliDateTime } from "@/lib/jalali";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/components/auth-context";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/i18n-context";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { Switch } from "@/components/ui/switch";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { HelpTip } from "@/components/ui/help-tip";
import { JalaliDateTimePicker } from "@/components/ui/jalali-datetime-picker";
import { useToast } from "@/components/ui/toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Pagination } from "@/components/ui/pagination";
import {
  ArrowDownUp,
  Copy,
  ClipboardList,
  Pencil,
  Power,
  RotateCcw,
  Server,
  Trash2,
  Users,
  Link2,
  SquarePen,
  Layers,
  Download,
  QrCode,
  ExternalLink,
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock3,
  Hourglass,
  LayoutGrid,
  List,
  Sparkles,
  Gauge,
  Unlink2,
} from "lucide-react";

type UserOut = { id: number; label: string; total_gb: number; used_bytes: number; expire_at: string; status: string; create_status?: string | null };
type UsersPage = { items: UserOut[]; total: number };
type ResellerStatsOut = {
  users_total: number;
  users_active: number;
  users_disabled: number;
  used_bytes_total: number;
  sold_gb_total: number;
};
type LinksResp = {
  user_id: number;
  master_link?: string | null;
  node_links: Array<{
    node_id: number;
    node_name?: string;
    panel_type?: string;
    direct_url?: string;
    full_url?: string;
    config_download_url?: string;
    status: string;
    detail?: string;
  }>;
};
type NodeLinkOut = LinksResp["node_links"][number];
type NodeLite = { id: number; name: string; base_url: string };
type UserDefaultsEnvelope = {
  effective?: {
    show_guardino_master_sub?: boolean;
  };
};
type ResellerUserPolicy = {
  enabled: boolean;
  restrict_edit_to_renewal_only: boolean;
  renewal_policy: string;
  allowed_duration_presets: string[];
  allowed_traffic_gb: number[];
};

function normalizeUrl(maybeUrl: string, baseUrl?: string) {
  const u = (maybeUrl || "").trim();
  if (!u) return u;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) return u;
  const b = (baseUrl || "").trim();
  if (!b) return u;
  let origin = b;
  try {
    const parsed = new URL(b);
    origin = parsed.origin;
  } catch {
    const m = b.match(/^(https?:\/\/[^/]+)/i);
    if (m) origin = m[1];
  }
  const uu = u.startsWith("/") ? u : `/${u}`;
  return `${origin.replace(/\/+$/, "")}${uu}`;
}

type OpResult = { ok: boolean; charged_amount: number; refunded_amount: number; new_balance: number; user_id: number; detail?: string };
const AUTO_REFRESH_MS = 30_000;
const DURATION_PRESETS = [
  { key: "7d", label: "7 days", days: 7 },
  { key: "1m", label: "1 month", days: 31 },
  { key: "3m", label: "3 months", days: 90 },
  { key: "6m", label: "6 months", days: 180 },
  { key: "1y", label: "1 year", days: 365 },
];
const TRAFFIC_PRESETS = [20, 30, 50, 70, 100, 150, 200];

type StatusFilter = "all" | "active" | "disabled" | "expired" | "limited" | "on_hold";
type SortMode = "priority" | "expiry" | "usage" | "usage_low" | "volume_high" | "volume_low" | "newest" | "oldest" | "name";
type ViewMode = "grid2" | "single";

function bytesToGb(bytes: number) {
  return bytes / (1024 * 1024 * 1024);
}
function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

function safeDaysLeft(expire_at: string): number | null {
  const exp = new Date(expire_at);
  if (Number.isNaN(exp.getTime())) return null;
  const now = new Date();
  return Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function isUsageLimited(u: UserOut): boolean {
  const totalBytes = Math.max(0, Number(u.total_gb || 0)) * 1024 * 1024 * 1024;
  return totalBytes > 0 && Number(u.used_bytes || 0) >= totalBytes;
}

function userStatusInfo(u: UserOut, lang: "fa" | "en") {
  const s = (u.status || "").toLowerCase();
  const createStatus = String(u.create_status || "").toLowerCase();
  const days = safeDaysLeft(u.expire_at);
  const expired = days !== null && days < 0;
  const limited = isUsageLimited(u);

  if (s === "active" && createStatus === "on_hold" && !expired && !limited) {
    return {
      key: "on_hold" as const,
      v: "default" as const,
      label: lang === "fa" ? "در انتظار اتصال" : "On Hold",
      note: lang === "fa" ? "هنوز اولین اتصال کاربر ثبت نشده است." : "The user's first connection has not been recorded yet.",
      Icon: Hourglass,
      badgeClass: "border-violet-500/35 bg-violet-500/15 text-violet-700 dark:text-violet-300",
      noteClass: "border-violet-400/35 bg-violet-500/10 text-violet-700 dark:text-violet-300",
      cardGlow: "from-violet-500/12 via-transparent to-sky-500/10",
    };
  }
  if (expired) {
    return {
      key: "expired" as const,
      v: "danger" as const,
      label: lang === "fa" ? "منقضی شده" : "Expired",
      note: lang === "fa" ? "زمان اشتراک این کاربر تمام شده است." : "This user's subscription time has ended.",
      Icon: Clock3,
      badgeClass: "border-rose-500/35 bg-rose-500/15 text-rose-700 dark:text-rose-300",
      noteClass: "border-rose-400/35 bg-rose-500/10 text-rose-700 dark:text-rose-300",
      cardGlow: "from-rose-500/14 via-transparent to-orange-500/10",
    };
  }
  if (limited) {
    return {
      key: "limited" as const,
      v: "warning" as const,
      label: lang === "fa" ? "اتمام حجم" : "Data Limit",
      note: lang === "fa" ? "حجم اشتراک به سقف تعیین‌شده رسیده است." : "The subscription data quota has reached its limit.",
      Icon: AlertTriangle,
      badgeClass: "border-amber-500/35 bg-amber-500/15 text-amber-700 dark:text-amber-300",
      noteClass: "border-amber-400/35 bg-amber-500/10 text-amber-700 dark:text-amber-300",
      cardGlow: "from-amber-500/14 via-transparent to-yellow-500/10",
    };
  }
  if (s === "disabled") {
    return {
      key: "disabled" as const,
      v: "muted" as const,
      label: lang === "fa" ? "غیرفعال" : "Disabled",
      note: lang === "fa" ? "دسترسی این کاربر در گاردینو غیرفعال است." : "This user's access is disabled in Guardino.",
      Icon: Ban,
      badgeClass: "",
      noteClass: "border-slate-400/25 bg-slate-500/10 text-[hsl(var(--fg))]/75",
      cardGlow: "from-slate-500/10 via-transparent to-slate-500/5",
    };
  }
  if (s === "active") {
    return {
      key: "active" as const,
      v: "success" as const,
      label: lang === "fa" ? "فعال" : "Active",
      note: lang === "fa" ? "اشتراک فعال است." : "Subscription is active.",
      Icon: CheckCircle2,
      badgeClass: "",
      noteClass: "border-emerald-400/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
      cardGlow: "from-emerald-500/12 via-transparent to-sky-500/10",
    };
  }
  return {
    key: "unknown" as const,
    v: "default" as const,
    label: u.status || (lang === "fa" ? "نامشخص" : "Unknown"),
    note: lang === "fa" ? "وضعیت کاربر نامشخص است." : "User status is unknown.",
    Icon: Sparkles,
    badgeClass: "",
    noteClass: "border-[hsl(var(--border))] bg-[hsl(var(--surface-card-3))]/60 text-[hsl(var(--fg))]/75",
    cardGlow: "from-[hsl(var(--accent)/0.10)] via-transparent to-transparent",
  };
}

function statusBadge(status: string, createStatus: string | null | undefined, lang: "fa" | "en") {
  const s = (status || "").toLowerCase();
  if (s === "active" && String(createStatus || "").toLowerCase() === "on_hold") {
    return {
      v: "default" as const,
      label: lang === "fa" ? "در انتظار اتصال" : "On Hold",
      Icon: Sparkles,
      className: "border-violet-500/35 bg-violet-500/15 text-violet-700 dark:text-violet-300",
    };
  }
  if (s === "active") return { v: "success" as const, label: lang === "fa" ? "فعال" : "Active", Icon: CheckCircle2, className: "" };
  if (s === "disabled") return { v: "muted" as const, label: lang === "fa" ? "غیرفعال" : "Disabled", Icon: Ban, className: "" };
  if (s === "expired") return { v: "danger" as const, label: lang === "fa" ? "منقضی" : "Expired", Icon: Ban, className: "" };
  return { v: "default" as const, label: status || "—", Icon: Sparkles, className: "" };
}

function computePriority(u: UserOut) {
  const s = (u.status || "").toLowerCase();
  const totalBytes = (u.total_gb || 0) * 1024 * 1024 * 1024;
  const pct = totalBytes > 0 ? clamp01((u.used_bytes || 0) / totalBytes) : 0;
  const percent = Math.round(pct * 100);
  const days = safeDaysLeft(u.expire_at);
  const state = userStatusInfo(u, "fa");

  if (state.key === "expired" || state.key === "limited") return { level: "high" as const, percent, days };
  if (s === "expired" || (days !== null && days < 0)) return { level: "high" as const, percent, days };
  if ((days !== null && days <= 3) || percent >= 90) return { level: "high" as const, percent, days };
  if ((days !== null && days <= 7) || percent >= 80) return { level: "med" as const, percent, days };
  return { level: "low" as const, percent, days };
}

function panelLabel(panelType: string | undefined, lang: "fa" | "en") {
  const p = String(panelType || "").toLowerCase();
  if (p === "wg_dashboard") return lang === "fa" ? "وایرگارد" : "WireGuard";
  return lang === "fa" ? "لینک مستقیم" : "Direct link";
}

function qrImageUrl(value: string, size: number = 220) {
  const s = Math.max(80, Math.min(512, Number(size) || 220));
  return `https://api.qrserver.com/v1/create-qr-code/?size=${s}x${s}&margin=8&data=${encodeURIComponent(value)}`;
}

function fmtGig(value: number, lang: "fa" | "en" = "fa") {
  const n = Number.isFinite(value) ? value : 0;
  return formatNumberWithDigits(n, { maximumFractionDigits: 1 });
}

function fmtTrafficBytes(bytes: number, lang: "fa" | "en" = "fa") {
  const safe = Math.max(0, Number(bytes) || 0);
  if (safe > 0 && safe < 1024 * 1024 * 1024) {
    const mb = Math.max(1, Math.ceil(safe / (1024 * 1024)));
    const unit = lang === "fa" ? "مگابایت" : "MB";
    return `${formatNumberWithDigits(mb, { maximumFractionDigits: 0 })} ${unit}`;
  }
  return `${fmtGig(safe / (1024 * 1024 * 1024), lang)} ${lang === "fa" ? "گیگ" : "GB"}`;
}

function usagePercentLabel(percent: number, usedBytes: number, lang: "fa" | "en") {
  if (usedBytes > 0 && percent === 0) return `<${formatNumberWithDigits(1)}%`;
  return `${formatNumberWithDigits(percent)}%`;
}

function durationPresetLabel(p: { key: string; label: string; days: number }, lang: "fa" | "en") {
  if (lang === "en") return p.label;
  if (p.key === "7d") return `${formatNumberWithDigits(7)} روز`;
  if (p.key === "1m") return `${formatNumberWithDigits(1)} ماه`;
  if (p.key === "3m") return `${formatNumberWithDigits(3)} ماه`;
  if (p.key === "6m") return `${formatNumberWithDigits(6)} ماه`;
  if (p.key === "1y") return `${formatNumberWithDigits(1)} سال`;
  return `${fmtNumber(p.days)} روز`;
}

function progressTone(percent: number) {
  if (percent >= 90) return "from-rose-500 via-red-500 to-orange-500";
  if (percent >= 70) return "from-amber-500 via-orange-500 to-yellow-500";
  return "from-[hsl(var(--accent))] via-[hsl(var(--accent)/0.82)] to-[hsl(var(--accent)/0.6)]";
}

export default function UsersPage() {
  const router = useRouter();
  const { me, refresh: refreshMe } = useAuth();
  const { t, lang, digitStyle } = useI18n();
  const { push } = useToast();
  const locked = (me?.balance ?? 1) <= 0;

  const copy = React.useMemo(
    () =>
      lang === "en"
        ? {
            autoRefresh: `Auto refresh every ${formatNumberWithDigits(30)} seconds`,
            disabled: "Disabled",
            totalUsedTraffic: "Total user traffic",
            soldTraffic: "Total sold traffic",
            gb: "GB",
            usage: "Usage",
            used: "Used",
            remaining: "Remaining",
            onHold: "On Hold",
            limited: "Data Limit",
            singleView: "Single column",
            twoColumnView: "Two columns",
            copyQuickSub: "Quick copy subscription link",
            nodeLinks: "Node links",
            pickNodeLink: "Choose node link",
            qrLinks: "QR links",
            more: "More",
            quickEdit: "Quick edit",
            copyMaster: "Copy main subscription link",
            copyAllLinks: "Copy all links",
            noLinkToCopy: "No link available to copy",
            loadingLinks: "Fetching links...",
            linksFailed: "Fetching links failed",
            retry: "Try again",
            clickToFetchLinks: "Click to fetch links",
            copySubFor: (name: string) => `Copy subscription link ${name}`,
            linkMissingFor: (name: string) => `${name} - link unavailable`,
            copiedLinkFor: (name: string) => `Link ${name} copied`,
            copyAllUsable: "Copy all usable links",
            allLinksCopied: "All links copied",
            copyGuardinoSub: "Copy Guardino central sub",
            guardinoSubDisabled: "Guardino central sub is disabled",
            guardinoCopied: "Central sub copied",
            refreshLinks: "Refresh links",
            subCopied: "Subscription link copied",
            centralSub: "Central subscription",
            aggregatedLink: "Aggregated link",
            sortLabels: {
              priority: "Needs attention",
              expiry: "Soonest expiry",
              usage: "Highest usage",
              usage_low: "Lowest usage",
              volume_high: "Highest quota",
              volume_low: "Lowest quota",
              newest: "Newest",
              oldest: "Oldest",
              name: "Username",
            } as Record<SortMode, string>,
            quickEditTitle: (label?: string) => (label ? `Quick edit: ${label}` : "Quick edit"),
            renewalOnlyTitle: "Free editing is locked.",
            renewalOnlyHelp: "For this reseller, only package renewal with super-admin-approved packages is allowed.",
            renewalPackage: "Package renewal",
            extendTime: "Extend time",
            addTraffic: "Add traffic",
            decreaseTraffic: "Decrease traffic",
            decreaseTime: "Decrease time",
            renewalHelp: "Renewal policy is set by the super admin. The reseller only chooses package days and traffic.",
            renewalDuration: "Renewal duration",
            renewalTraffic: "Renewal traffic",
            renewalDays: "Renewal duration (days)",
            renewalGb: "Renewal traffic (GB)",
            run: "Run",
            days: "days",
            currentExpire: "Current expiry",
            selectedDate: "Selected date",
            quickControl: "Quick controls",
            resetUsage: "Reset usage",
            rebuildLink: "Rebuild link",
            goDetails: "Go to details",
            qrHelp: "QR codes for the central link and each node link are shown here. Revoke invalidates the previous central link too.",
            open: "Open",
            downloadConf: "Download .conf",
            noQrLink: "No link found for QR generation.",
            linksHint: "Recommendation: give users the direct panel link. The main subscription link is better for multi-node users.",
            noDirectLink: "No direct link is available",
            copyDirectLinks: "Copy direct links",
            unavailableLink: "Link is not available.",
          }
        : {
            autoRefresh: `بروزرسانی خودکار هر ${formatNumberWithDigits(30)} ثانیه`,
            disabled: "غیرفعال",
            totalUsedTraffic: "حجم مصرف کل کاربران",
            soldTraffic: "مجموع حجم فروخته‌شده",
            gb: "گیگ",
            usage: "مصرف",
            used: "مصرف",
            remaining: "باقی‌مانده",
            onHold: "در انتظار اتصال",
            limited: "اتمام حجم",
            singleView: "تک‌ستونه",
            twoColumnView: "دو ستونه",
            copyQuickSub: "کپی سریع لینک اشتراک",
            nodeLinks: "نودها",
            pickNodeLink: "انتخاب لینک نود",
            qrLinks: "QR لینک‌ها",
            more: "بیشتر",
            quickEdit: "ویرایش سریع",
            copyMaster: "کپی لینک اصلی اشتراک",
            copyAllLinks: "کپی همه لینک‌ها",
            noLinkToCopy: "لینکی برای کپی وجود ندارد",
            loadingLinks: "در حال دریافت لینک‌ها...",
            linksFailed: "دریافت لینک‌ها ناموفق بود",
            retry: "تلاش دوباره",
            clickToFetchLinks: "برای دریافت لینک‌ها کلیک کنید",
            copySubFor: (name: string) => `کپی لینک ساب ${name}`,
            linkMissingFor: (name: string) => `${name} - لینک موجود نیست`,
            copiedLinkFor: (name: string) => `لینک ${name} کپی شد`,
            copyAllUsable: "کپی همه لینک‌های قابل استفاده",
            allLinksCopied: "همه لینک‌ها کپی شد",
            copyGuardinoSub: "کپی ساب مرکزی Guardino",
            guardinoSubDisabled: "ساب مرکزی Guardino غیرفعال است",
            guardinoCopied: "ساب مرکزی کپی شد",
            refreshLinks: "به‌روزرسانی لینک‌ها",
            subCopied: "لینک اشتراک کپی شد",
            centralSub: "اشتراک مرکزی",
            aggregatedLink: "لینک تجمیعی",
            sortLabels: {
              priority: "نیازمند رسیدگی",
              expiry: "نزدیک‌ترین انقضا",
              usage: "بیشترین مصرف",
              usage_low: "کمترین مصرف",
              volume_high: "بیشترین حجم",
              volume_low: "کمترین حجم",
              newest: "جدیدترین",
              oldest: "قدیمی‌ترین",
              name: "نام کاربر",
            } as Record<SortMode, string>,
            quickEditTitle: (label?: string) => (label ? `ویرایش سریع: ${label}` : "ویرایش سریع"),
            renewalOnlyTitle: "ویرایش آزاد بسته است.",
            renewalOnlyHelp: "برای این رسیلر فقط تمدید بسته‌ای طبق پکیج‌های مجاز سوپرادمین انجام می‌شود.",
            renewalPackage: "تمدید بسته‌ای",
            extendTime: "افزایش زمان",
            addTraffic: "افزایش حجم",
            decreaseTraffic: "کاهش حجم",
            decreaseTime: "کاهش زمان",
            renewalHelp: "سیاست تمدید توسط سوپرادمین تعیین می‌شود و رسیلر فقط مقدار روز و حجم پکیج را انتخاب می‌کند.",
            renewalDuration: "مدت تمدید",
            renewalTraffic: "حجم تمدید",
            renewalDays: "مدت تمدید (روز)",
            renewalGb: "حجم تمدید (گیگ)",
            run: "اجرا",
            days: "روز",
            currentExpire: "تاریخ پایان فعلی",
            selectedDate: "تاریخ انتخابی",
            quickControl: "کنترل سریع",
            resetUsage: "ریست مصرف",
            rebuildLink: "بازسازی لینک",
            goDetails: "رفتن به جزئیات",
            qrHelp: "QR کد لینک مرکزی و لینک هر نود نمایش داده می‌شود. با Revoke، لینک مرکزی قبلی هم باطل می‌شود.",
            open: "باز کردن",
            downloadConf: "دانلود .conf",
            noQrLink: "لینکی برای ساخت QR یافت نشد.",
            linksHint: "پیشنهاد: لینک مستقیم پنل را به کاربر بدهید. لینک اصلی اشتراک برای حالت چندنودی مناسب‌تر است.",
            noDirectLink: "لینک مستقیم موجود نیست",
            copyDirectLinks: "کپی لینک‌های مستقیم",
            unavailableLink: "لینک در دسترس نیست.",
          },
    [lang, digitStyle]
  );

  const [q, setQ] = React.useState("");
  const [debouncedQ, setDebouncedQ] = React.useState("");
  const [data, setData] = React.useState<UsersPage | null>(null);
  const [resellerStats, setResellerStats] = React.useState<ResellerStatsOut | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<StatusFilter>("all");
  const [sortMode, setSortMode] = React.useState<SortMode>("newest");
  const [viewMode, setViewMode] = React.useState<ViewMode>("grid2");

  const [nodes, setNodes] = React.useState<NodeLite[] | null>(null);
  const [userPolicy, setUserPolicy] = React.useState<ResellerUserPolicy | null>(null);
  const [showMasterSub, setShowMasterSub] = React.useState<boolean>(true);
  const [quickLinks, setQuickLinks] = React.useState<Record<number, { loading: boolean; data?: LinksResp; error?: string }>>({});
  const nodeMap = React.useMemo(() => {
    const m = new Map<number, NodeLite>();
    (nodes || []).forEach((n) => m.set(n.id, n));
    return m;
  }, [nodes]);

  const [linksOpen, setLinksOpen] = React.useState(false);
  const [linksUser, setLinksUser] = React.useState<UserOut | null>(null);
  const [links, setLinks] = React.useState<LinksResp | null>(null);
  const [linksErr, setLinksErr] = React.useState<string | null>(null);
  const [qrOpen, setQrOpen] = React.useState(false);
  const [qrUser, setQrUser] = React.useState<UserOut | null>(null);
  const [qrLinks, setQrLinks] = React.useState<LinksResp | null>(null);
  const [qrErr, setQrErr] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [confirmKind, setConfirmKind] = React.useState<"reset" | "revoke" | "delete" | null>(null);
  const [confirmUser, setConfirmUser] = React.useState<UserOut | null>(null);
  const [editOpen, setEditOpen] = React.useState(false);
  const [editUser, setEditUser] = React.useState<UserOut | null>(null);
  const [quickMode, setQuickMode] = React.useState<"renewal" | "extend" | "add" | "dec" | "time_dec">("extend");
  const [editDays, setEditDays] = React.useState(31);
  const [editDecDays, setEditDecDays] = React.useState(7);
  const [editAddGb, setEditAddGb] = React.useState(10);
  const [editDecGb, setEditDecGb] = React.useState(5);
  const [editRenewDays, setEditRenewDays] = React.useState(31);
  const [editRenewGb, setEditRenewGb] = React.useState(30);
  const [editTargetDate, setEditTargetDate] = React.useState<Date | null>(null);
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(50);
  const [copyHint, setCopyHint] = React.useState<{ text: string; x: number; y: number; id: number } | null>(null);
  const copyHintTimerRef = React.useRef<number | null>(null);

  async function load() {
    setErr(null);
    try {
      const offset = (page - 1) * pageSize;
      const params = new URLSearchParams({ offset: String(offset), limit: String(pageSize) });
      const search = debouncedQ.trim();
      if (search) params.set("q", search);
      if (filter !== "all") params.set("status", filter);
      const res = await apiFetch<UsersPage>(`/api/v1/reseller/users?${params.toString()}`);
      setData(res);
      try {
        const statsRes = await apiFetch<ResellerStatsOut>("/api/v1/reseller/stats");
        setResellerStats(statsRes);
      } catch {
        // Keep users list functional even if stats endpoint is temporarily unavailable.
      }
    } catch (e: any) {
      setErr(String(e.message || e));
    }
  }


  async function loadNodes() {
    if (nodes) return;
    try {
      const res = await apiFetch<any>("/api/v1/reseller/nodes");
      const arr = res?.items || res || [];
      setNodes(arr.map((n: any) => ({ id: n.id, name: n.name, base_url: n.base_url || "" })));
    } catch {
      // ignore
    }
  }

  async function loadPolicy() {
    try {
      const policy = await apiFetch<ResellerUserPolicy>("/api/v1/reseller/settings/user-policy");
      setUserPolicy(policy || null);
    } catch {
      // Keep edit UI usable if policy endpoint is temporarily unavailable.
    }
  }

  async function loadUserDefaults() {
    try {
      const env = await apiFetch<UserDefaultsEnvelope>("/api/v1/reseller/settings/user-defaults");
      setShowMasterSub(!!env?.effective?.show_guardino_master_sub);
    } catch {
      setShowMasterSub(true);
    }
  }

  React.useEffect(() => {
    load();
  }, [page, pageSize, debouncedQ, filter]);

  React.useEffect(() => {
    const timer = window.setInterval(() => {
      load().catch(() => undefined);
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [page, pageSize, debouncedQ, filter]);

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQ(q.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [q]);

  React.useEffect(() => {
    setPage(1);
  }, [filter]);

  React.useEffect(() => {
    loadNodes().catch(() => undefined);
    loadPolicy().catch(() => undefined);
    loadUserDefaults().catch(() => undefined);
  }, []);

  React.useEffect(() => {
    try {
      const saved = (window.localStorage.getItem("users_view_mode") || "").trim();
      if (saved === "single" || saved === "grid2") setViewMode(saved);
    } catch {
      // ignore
    }
  }, []);

  React.useEffect(() => {
    try {
      window.localStorage.setItem("users_view_mode", viewMode);
    } catch {
      // ignore
    }
  }, [viewMode]);

  React.useEffect(() => {
    return () => {
      if (copyHintTimerRef.current) window.clearTimeout(copyHintTimerRef.current);
    };
  }, []);

  // Search (q) and status filtering are done server-side in load(); re-filtering
  // here would drop ID matches and hide rows the server legitimately returned.
  function applySort(items: UserOut[]) {
    const arr = [...items];

    if (sortMode === "newest") {
      arr.sort((a, b) => (b.id || 0) - (a.id || 0));
      return arr;
    }

    if (sortMode === "oldest") {
      arr.sort((a, b) => (a.id || 0) - (b.id || 0));
      return arr;
    }

    if (sortMode === "name") {
      arr.sort((a, b) => (a.label || "").localeCompare(b.label || "", lang === "fa" ? "fa" : "en"));
      return arr;
    }

    if (sortMode === "usage") {
      arr.sort((a, b) => computePriority(b).percent - computePriority(a).percent);
      return arr;
    }

    if (sortMode === "usage_low") {
      arr.sort((a, b) => computePriority(a).percent - computePriority(b).percent);
      return arr;
    }

    if (sortMode === "volume_high") {
      arr.sort((a, b) => Number(b.total_gb || 0) - Number(a.total_gb || 0));
      return arr;
    }

    if (sortMode === "volume_low") {
      arr.sort((a, b) => Number(a.total_gb || 0) - Number(b.total_gb || 0));
      return arr;
    }

    if (sortMode === "expiry") {
      arr.sort((a, b) => {
        const da = computePriority(a).days;
        const db = computePriority(b).days;
        const va = da === null ? 10_000 : da;
        const vb = db === null ? 10_000 : db;
        return va - vb;
      });
      return arr;
    }

    // priority
    const weight = { high: 3, med: 2, low: 1 } as const;
    arr.sort((a, b) => {
      const pa = computePriority(a);
      const pb = computePriority(b);
      const wa = weight[pa.level];
      const wb = weight[pb.level];
      if (wb !== wa) return wb - wa;
      // tie-break: higher usage first
      if (pb.percent !== pa.percent) return pb.percent - pa.percent;
      // tie-break: expiring sooner first
      const da = pa.days === null ? 10_000 : pa.days;
      const db = pb.days === null ? 10_000 : pb.days;
      return da - db;
    });

    return arr;
  }

  const rawItems = data?.items || [];
  const items = applySort(rawItems);
  const renewalOnly = !!(userPolicy?.enabled && userPolicy.restrict_edit_to_renewal_only);
  const renewalDurationPresets = React.useMemo(() => {
    const allowed = new Set((userPolicy?.allowed_duration_presets || []).map((x) => String(x).toLowerCase()));
    const filtered = DURATION_PRESETS.filter((p) => !allowed.size || allowed.has(p.key));
    return filtered.length ? filtered : DURATION_PRESETS;
  }, [userPolicy]);
  const renewalTrafficPresets = React.useMemo(() => {
    const allowed = (userPolicy?.allowed_traffic_gb || []).filter((x) => Number.isFinite(x) && x > 0);
    return allowed.length ? allowed : TRAFFIC_PRESETS;
  }, [userPolicy]);

  const stats = React.useMemo(() => {
    const total = resellerStats?.users_total ?? data?.total ?? rawItems.length;
    const active = resellerStats?.users_active ?? rawItems.filter((u) => (u.status || "").toLowerCase() === "active").length;
    const disabled = resellerStats?.users_disabled ?? rawItems.filter((u) => (u.status || "").toLowerCase() === "disabled").length;
    const pageUsedBytes = rawItems.reduce((sum, u) => sum + Number(u.used_bytes || 0), 0);
    const pageSoldGb = rawItems.reduce((sum, u) => sum + Number(u.total_gb || 0), 0);
    const usedBytes = resellerStats?.used_bytes_total ?? pageUsedBytes;
    const soldGb = resellerStats?.sold_gb_total ?? pageSoldGb;
    return { total, active, disabled, usedGb: bytesToGb(usedBytes), soldGb };
  }, [rawItems, data?.total, resellerStats]);

  function showCopyHint(ev?: React.MouseEvent<HTMLElement> | null, text: string = t("common.copied")) {
    const x = ev ? ev.clientX : window.innerWidth / 2;
    const y = ev ? ev.clientY : window.innerHeight / 2;
    const id = Date.now();
    setCopyHint({ text, x, y, id });
    if (copyHintTimerRef.current) window.clearTimeout(copyHintTimerRef.current);
    copyHintTimerRef.current = window.setTimeout(() => {
      setCopyHint((prev) => (prev?.id === id ? null : prev));
    }, 1100);
  }

  async function fetchUserLinks(u: UserOut, refresh = false) {
    await loadNodes();
    return await apiFetch<LinksResp>(`/api/v1/reseller/users/${u.id}/links?refresh=${refresh ? "true" : "false"}`);
  }

  function resolveNodeLink(nl: NodeLinkOut) {
    if (nl.config_download_url) return nl.config_download_url;
    const node = nodeMap.get(nl.node_id);
    if (nl.full_url) return nl.full_url;
    if (nl.direct_url) return normalizeUrl(nl.direct_url, node?.base_url);
    return "";
  }

  function extractDirectLinks(res: LinksResp) {
    return (res.node_links || []).map((nl) => resolveNodeLink(nl)).filter(Boolean);
  }

  function nodeLinkName(nl: NodeLinkOut) {
    const node = nodeMap.get(nl.node_id);
    return node?.name || nl.node_name || `Node #${nl.node_id}`;
  }

  async function copyResolvedLink(value: string, label: string) {
    if (!value) {
      push({ title: copy.noLinkToCopy, type: "warning" });
      return;
    }
    const ok = await copyText(value);
    if (ok) showCopyHint(null, label);
    else push({ title: t("common.failed"), type: "error" });
  }

  async function ensureQuickLinks(u: UserOut, refresh = false) {
    const current = quickLinks[u.id];
    if (!refresh && current?.data) return current.data;
    setQuickLinks((prev) => ({ ...prev, [u.id]: { loading: true, data: current?.data } }));
    try {
      const res = await fetchUserLinks(u, refresh);
      setQuickLinks((prev) => ({ ...prev, [u.id]: { loading: false, data: res } }));
      return res;
    } catch (e: any) {
      const message = String(e.message || e);
      setQuickLinks((prev) => ({ ...prev, [u.id]: { loading: false, error: message } }));
      return null;
    }
  }

  function quickLinkMenuItems(u: UserOut) {
    const state = quickLinks[u.id];
    const data = state?.data;
    if (state?.loading && !data) {
      return [{ label: copy.loadingLinks, icon: <Sparkles size={16} />, disabled: true, onClick: () => {} }];
    }
    if (state?.error && !data) {
      return [
        { label: copy.linksFailed, icon: <AlertTriangle size={16} />, disabled: true, onClick: () => {} },
        { label: copy.retry, icon: <RotateCcw size={16} />, onClick: () => { void ensureQuickLinks(u, true); } },
      ];
    }
    if (!data) {
      return [{ label: copy.clickToFetchLinks, icon: <Link2 size={16} />, onClick: () => { void ensureQuickLinks(u, true); } }];
    }

    const directItems: MenuItem[] = (data.node_links || []).map((nl) => {
      const link = resolveNodeLink(nl);
      const name = nodeLinkName(nl);
      return {
        label: link ? copy.copySubFor(name) : copy.linkMissingFor(name),
        icon: <Server size={16} />,
        disabled: !link,
        onClick: () => copyResolvedLink(link, copy.copiedLinkFor(name)),
      };
    });
    const copyableDirect = (data.node_links || []).map((nl) => resolveNodeLink(nl)).filter(Boolean);
    const allLinks = [...copyableDirect, showMasterSub ? data.master_link : null].filter(Boolean) as string[];
    const items: MenuItem[] = [
      {
        label: copy.copyAllUsable,
        icon: <ClipboardList size={16} />,
        disabled: allLinks.length === 0,
        onClick: () => copyResolvedLink(allLinks.join("\n"), copy.allLinksCopied),
      },
      ...directItems,
    ];
    if (showMasterSub) {
      items.push({
        label: data.master_link ? copy.copyGuardinoSub : copy.guardinoSubDisabled,
        icon: <Link2 size={16} />,
        disabled: !data.master_link,
        onClick: () => copyResolvedLink(data.master_link || "", copy.guardinoCopied),
      });
    }
    items.push({ label: copy.refreshLinks, icon: <RotateCcw size={16} />, onClick: () => { void ensureQuickLinks(u, true); } });
    return items;
  }

  async function copyPrimaryLinkForUser(u: UserOut, ev?: React.MouseEvent<HTMLElement>) {
    try {
      const res = await ensureQuickLinks(u, false);
      if (!res) {
        push({ title: copy.linksFailed, type: "error" });
        return;
      }
      const direct = (res.node_links || [])
        .map((nl) => ({ link: resolveNodeLink(nl), name: nodeLinkName(nl) }))
        .filter((x) => !!x.link);
      const master = showMasterSub && res.master_link ? res.master_link : "";
      const target = direct[0] || (master ? { link: master, name: "Guardino" } : null);
      if (!target?.link) {
        push({ title: copy.noLinkToCopy, type: "warning" });
        return;
      }
      const ok = await copyText(target.link);
      if (ok) showCopyHint(ev || null, direct.length === 1 && !master ? copy.subCopied : copy.copiedLinkFor(target.name));
      else push({ title: t("common.failed"), type: "error" });
    } catch (e: any) {
      push({ title: t("common.error"), desc: String(e.message || e), type: "error" });
    }
  }

  async function openLinks(u: UserOut) {
    setLinksUser(u);
    setLinksOpen(true);
    setLinks(null);
    setLinksErr(null);
    try {
      const res = await fetchUserLinks(u, true);
      setLinks(res);
    } catch (e: any) {
      setLinksErr(String(e.message || e));
    }
  }

  async function copyMaster(u: UserOut, ev?: React.MouseEvent<HTMLElement>) {
    try {
      const res = await fetchUserLinks(u, true);
      if (!res.master_link) {
        push({ title: copy.guardinoSubDisabled, type: "warning" });
        return;
      }
      const ok = await copyText(res.master_link);
      if (ok) showCopyHint(ev || null, t("common.copied"));
      else push({ title: t("common.failed"), type: "error" });
    } catch (e: any) {
      push({ title: t("common.error"), desc: String(e.message || e), type: "error" });
    }
  }

  async function copyAllLinksForUser(u: UserOut, ev?: React.MouseEvent<HTMLElement>) {
    try {
      const res = await fetchUserLinks(u, true);
      const direct = extractDirectLinks(res);
      const lines = [...direct, showMasterSub ? res.master_link : null].filter(Boolean).join("\n");
      if (!lines) {
        push({ title: copy.noLinkToCopy, type: "warning" });
        return;
      }
      const ok = await copyText(lines);
      if (ok) showCopyHint(ev || null, copy.allLinksCopied);
      else push({ title: t("common.failed"), type: "error" });
    } catch (e: any) {
      push({ title: t("common.error"), desc: String(e.message || e), type: "error" });
    }
  }

  async function openQr(u: UserOut) {
    setQrUser(u);
    setQrOpen(true);
    setQrErr(null);
    setQrLinks(null);
    try {
      const res = await fetchUserLinks(u, true);
      setQrLinks(res);
    } catch (e: any) {
      setQrErr(String(e.message || e));
    }
  }

  const qrItems = React.useMemo(() => {
    if (!qrLinks) return [] as Array<{ key: string; title: string; subtitle: string; url: string; isWg: boolean }>;
    const out: Array<{ key: string; title: string; subtitle: string; url: string; isWg: boolean }> = [];
    if (showMasterSub && qrLinks.master_link) {
      out.push({
        key: "master",
        title: copy.centralSub,
        subtitle: copy.aggregatedLink,
        url: qrLinks.master_link,
        isWg: false,
      });
    }
    for (const nl of qrLinks.node_links || []) {
      const link = resolveNodeLink(nl);
      if (!link) continue;
      const node = nodeMap.get(nl.node_id);
      const title = node?.name || nl.node_name || `Node #${nl.node_id}`;
      const isWg = (nl.panel_type || "").toLowerCase() === "wg_dashboard";
      out.push({
        key: `node-${nl.node_id}`,
        title,
        subtitle: `${panelLabel(nl.panel_type, lang)} (#${nl.node_id})`,
        url: link,
        isWg,
      });
    }
    return out;
  }, [nodeMap, qrLinks, showMasterSub]);

  async function op(userId: number, path: string, body: any) {
    setBusyId(userId);
    try {
      await apiFetch<OpResult>(path, { method: "POST", body: JSON.stringify(body) });
      await load();
      await refreshMe().catch(() => undefined);
      push({ title: "OK", type: "success" });
      return true;
    } catch (e: any) {
      push({ title: t("common.error"), desc: String(e.message || e), type: "error" });
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function setStatus(u: UserOut, active: boolean) {
    await op(u.id, `/api/v1/reseller/users/${u.id}/set-status`, { status: active ? "active" : "disabled" });
  }

  async function resetUsage(u: UserOut) {
    await op(u.id, `/api/v1/reseller/users/${u.id}/reset-usage`, {});
  }

  async function revoke(u: UserOut) {
    await op(u.id, `/api/v1/reseller/users/${u.id}/revoke`, {});
    if (linksOpen && linksUser?.id === u.id) {
      await openLinks(u);
    }
    if (qrOpen && qrUser?.id === u.id) {
      await openQr(u);
    }
  }

  function ask(kind: "reset" | "revoke" | "delete", u: UserOut) {
    setConfirmKind(kind);
    setConfirmUser(u);
    setConfirmOpen(true);
  }

  async function doConfirm() {
    if (!confirmUser || !confirmKind) return;
    const u = confirmUser;
    setConfirmOpen(false);
    if (confirmKind === "reset") await resetUsage(u);
    if (confirmKind === "revoke") await revoke(u);
    if (confirmKind === "delete") await op(u.id, `/api/v1/reseller/users/${u.id}/refund`, { action: "delete" });
  }

  function openQuickEdit(u: UserOut) {
    setEditUser(u);
    setQuickMode("renewal");
    setEditDays(31);
    setEditDecDays(7);
    setEditAddGb(10);
    setEditDecGb(5);
    setEditRenewDays(31);
    setEditRenewGb(30);
    const exp = new Date(u.expire_at);
    setEditTargetDate(Number.isNaN(exp.getTime()) ? new Date() : exp);
    setEditOpen(true);
  }

  function computeDaysDeltaFromTarget(currentExpireAt: string, target: Date | null) {
    if (!target || Number.isNaN(target.getTime())) return { ok: false as const, reason: "format" };
    const current = new Date(currentExpireAt);
    if (Number.isNaN(current.getTime())) return { ok: false as const, reason: "current" };
    const diffMs = target.getTime() - current.getTime();
    const diffDays = Math.ceil(Math.abs(diffMs) / (1000 * 60 * 60 * 24));
    return { ok: true as const, direction: diffMs >= 0 ? "up" : "down", diffDays };
  }

  function FilterButton({ value, label }: { value: StatusFilter; label: string }) {
    const active = filter === value;
    return (
      <button
        type="button"
        onClick={() => setFilter(value)}
        className={
          "rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all duration-200 " +
          (active
            ? "border-transparent bg-[hsl(var(--accent))] text-[hsl(var(--accent-fg))] shadow-soft"
            : "border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] hover:border-[hsl(var(--accent)/0.35)] hover:bg-[hsl(var(--surface-card-3))]")
        }
      >
        {label}
      </button>
    );
  }

  function UserActionButton({
    icon,
    label,
    title,
    disabled,
    onClick,
  }: {
    icon: React.ReactNode;
    label: string;
    title?: string;
    disabled?: boolean;
    onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  }) {
    return (
      <button
        type="button"
        title={title || label}
        aria-label={title || label}
        disabled={disabled}
        onClick={onClick}
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-transparent bg-transparent text-[hsl(var(--fg))]/74 transition-all duration-200 hover:-translate-y-0.5 hover:bg-[hsl(var(--accent)/0.10)] hover:text-[hsl(var(--accent))] disabled:pointer-events-none disabled:opacity-45"
      >
        <span className="flex items-center justify-center [&>svg]:h-5 [&>svg]:w-5">{icon}</span>
        <span className="sr-only">{label}</span>
      </button>
    );
  }

  const sortLabels: Record<SortMode, string> = copy.sortLabels;
  const sortMenuItems: MenuItem[] = [
    { label: sortLabels.priority, icon: <Sparkles size={16} />, onClick: () => setSortMode("priority") },
    { label: sortLabels.expiry, icon: <Clock3 size={16} />, onClick: () => setSortMode("expiry") },
    { label: sortLabels.usage, icon: <Gauge size={16} />, onClick: () => setSortMode("usage") },
    { label: sortLabels.usage_low, icon: <Gauge size={16} />, onClick: () => setSortMode("usage_low") },
    { label: sortLabels.volume_high, icon: <Layers size={16} />, onClick: () => setSortMode("volume_high") },
    { label: sortLabels.volume_low, icon: <Layers size={16} />, onClick: () => setSortMode("volume_low") },
    { label: sortLabels.newest, icon: <ArrowDownUp size={16} />, onClick: () => setSortMode("newest") },
    { label: sortLabels.oldest, icon: <ArrowDownUp size={16} />, onClick: () => setSortMode("oldest") },
    { label: sortLabels.name, icon: <Users size={16} />, onClick: () => setSortMode("name") },
  ];
  const sortLabel = sortLabels[sortMode];

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden rounded-xl border-[hsl(var(--border))]/80">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-2xl font-bold tracking-tight">{t("users.title")}</div>
              <div className="text-sm text-[hsl(var(--fg))]/70">{t("users.subtitle")} • {copy.autoRefresh}</div>
            </div>
            <a
              href={locked ? undefined : "/app/users/new"}
              aria-disabled={locked}
              onClick={(e) => {
                if (locked) e.preventDefault();
              }}
              className={
                "rounded-lg bg-[hsl(var(--accent))] px-4 py-2 text-sm font-semibold text-[hsl(var(--accent-fg))] shadow-soft transition-all duration-200 hover:translate-y-[-1px] hover:brightness-95 " +
                (locked ? "pointer-events-none opacity-55" : "")
              }
            >
              {t("users.create")}
            </a>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <div className="rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(135deg,rgba(59,130,246,0.10),rgba(14,165,233,0.06))] p-4">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-[hsl(var(--fg))]/70">{t("users.statsTotal")}</div>
                <Users size={18} className="opacity-70" />
              </div>
              <div className="mt-2 text-2xl font-bold">{fmtNumber(stats.total)}</div>
            </div>
            <div className="rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(135deg,rgba(16,185,129,0.14),rgba(5,150,105,0.06))] p-4">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-[hsl(var(--fg))]/70">{t("users.statsActive")}</div>
                <CheckCircle2 size={18} className="text-emerald-600" />
              </div>
              <div className="mt-2 text-2xl font-bold">{fmtNumber(stats.active)}</div>
            </div>
            <div className="rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(135deg,rgba(244,63,94,0.12),rgba(251,113,133,0.06))] p-4">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-[hsl(var(--fg))]/70">{copy.disabled}</div>
                <Ban size={18} className="text-rose-600" />
              </div>
              <div className="mt-2 text-2xl font-bold">{fmtNumber(stats.disabled)}</div>
            </div>
            <div className="rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(135deg,rgba(245,158,11,0.13),rgba(249,115,22,0.05))] p-4">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-[hsl(var(--fg))]/70">{copy.totalUsedTraffic}</div>
                <Gauge size={18} className="text-amber-600" />
              </div>
              <div className="mt-2 text-2xl font-bold">{fmtTrafficBytes(stats.usedGb * 1024 * 1024 * 1024, lang)}</div>
            </div>
            <div className="rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(135deg,rgba(129,140,248,0.14),rgba(56,189,248,0.06))] p-4">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-[hsl(var(--fg))]/70">{copy.soldTraffic}</div>
                <Layers size={18} className="text-indigo-600" />
              </div>
              <div className="mt-2 text-2xl font-bold">{fmtGig(stats.soldGb, lang)} {copy.gb}</div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Input
              placeholder={t("users.search")}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-11 max-w-xl rounded-lg"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              <FilterButton value="all" label={t("users.filterAll")} />
              <FilterButton value="active" label={t("users.filterActive")} />
              <FilterButton value="on_hold" label={copy.onHold} />
              <FilterButton value="limited" label={copy.limited} />
              <FilterButton value="disabled" label={t("users.filterDisabled")} />
              <FilterButton value="expired" label={t("users.filterExpired")} />
            </div>

            <div className="flex items-center gap-2">
              <div className="inline-flex items-center overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))]">
                <button
                  type="button"
                  onClick={() => setViewMode("single")}
                  className={
                    "inline-flex h-10 items-center gap-1.5 px-3 text-xs font-semibold transition-all duration-200 " +
                    (viewMode === "single"
                      ? "bg-[hsl(var(--accent))] text-[hsl(var(--accent-fg))]"
                      : "text-[hsl(var(--fg))]/75 hover:bg-[hsl(var(--surface-card-3))]")
                  }
                  title={copy.singleView}
                >
                  <List size={15} />
                  {copy.singleView}
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("grid2")}
                  className={
                    "inline-flex h-10 items-center gap-1.5 border-r border-[hsl(var(--border))] px-3 text-xs font-semibold transition-all duration-200 " +
                    (viewMode === "grid2"
                      ? "bg-[hsl(var(--accent))] text-[hsl(var(--accent-fg))]"
                      : "text-[hsl(var(--fg))]/75 hover:bg-[hsl(var(--surface-card-3))]")
                  }
                  title={copy.twoColumnView}
                >
                  <LayoutGrid size={15} />
                  {copy.twoColumnView}
                </button>
              </div>
              <Menu
                trigger={
                  <Button variant="outline" className="h-10 gap-2 rounded-lg">
                    <ArrowDownUp size={16} />
                    <span className="hidden sm:inline">{t("users.sort")}:</span>
                    <span>{sortLabel || t("users.sort")}</span>
                  </Button>
                }
                items={sortMenuItems}
              />
            </div>
          </div>

          {locked ? (
            <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-3))] p-3 text-xs">
              {t("users.balanceZero")}
            </div>
          ) : null}
          {err ? <div className="text-sm text-red-500">{err}</div> : null}
        </CardContent>
      </Card>

      {!data ? (
        <div className={"grid gap-4 " + (viewMode === "single" ? "grid-cols-1" : "grid-cols-1 xl:grid-cols-2")}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="rounded-xl">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                  <Skeleton className="h-7 w-24" />
                </div>
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-8 w-40" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className={"grid gap-4 " + (viewMode === "single" ? "grid-cols-1" : "grid-cols-1 xl:grid-cols-2")}>
          {items.map((u) => {
            const totalBytes = (u.total_gb || 0) * 1024 * 1024 * 1024;
            const usedBytes = Number(u.used_bytes || 0);
            const usedGb = bytesToGb(usedBytes);
            const pct = totalBytes > 0 ? clamp01((u.used_bytes || 0) / totalBytes) : 0;
            const percent = Math.round(pct * 100);
            const visiblePercent = usedBytes > 0 ? Math.max(1, percent) : 0;
            const remainingGb = Math.max((u.total_gb || 0) - usedGb, 0);

            const pr = computePriority(u);
            const expText = pr.days === null ? "—" : pr.days >= 0 ? t("users.expiresIn").replace("{days}", String(pr.days)) : t("users.expired");

            const sb = userStatusInfo(u, lang);
            const StatusIcon = sb.Icon;
            const isActive = (u.status || "").toLowerCase() === "active";
            const busy = busyId === u.id;
            const isSingle = viewMode === "single";
            const actionSize = isSingle ? "h-11 w-11" : "h-10 w-10";
            const iconButtonClass = `${actionSize} rounded-xl border border-transparent bg-transparent p-0 text-[hsl(var(--fg))]/72 shadow-none transition-all duration-200 hover:bg-[hsl(var(--accent)/0.10)] hover:text-[hsl(var(--accent))]`;
            const iconSize = isSingle ? 21 : 20;

            return (
              <Card
                key={u.id}
                role="button"
                tabIndex={0}
                onClick={() => openQuickEdit(u)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openQuickEdit(u);
                  }
                }}
                className="group relative cursor-pointer overflow-hidden rounded-xl border-[hsl(var(--border))]/85 bg-[linear-gradient(150deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-2))_52%,hsl(var(--surface-card-3))_100%)] transition-all duration-300 hover:-translate-y-0.5 hover:border-[hsl(var(--accent)/0.35)] hover:shadow-2xl hover:shadow-sky-500/10"
              >
                <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${sb.cardGlow} opacity-80 transition-opacity duration-300 group-hover:opacity-100`} />
                <CardContent className={"relative " + (isSingle ? "space-y-3 p-4" : "space-y-4 p-5")}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className={(isSingle ? "text-base" : "text-lg") + " font-bold break-all leading-relaxed"}>{u.label}</div>
                      </div>
                      <div className={(isSingle ? "mt-2 text-xs" : "mt-2 text-sm") + " inline-flex max-w-full items-center gap-1.5 rounded-full border border-[hsl(var(--border))]/75 bg-[hsl(var(--surface-card-1))]/75 px-2.5 py-1 font-medium text-[hsl(var(--fg))]/78 shadow-[inset_0_1px_0_hsl(var(--fg)/0.04)]"}>
                        <Clock3 size={16} className="shrink-0 text-[hsl(var(--accent))]" />
                        <span>{expText}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={sb.v} className={`gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-bold ${sb.badgeClass || ""}`}>
                        <StatusIcon size={15} />
                        {sb.label}
                      </Badge>
                      <div onClick={(e) => e.stopPropagation()}>
                        <Switch className="h-6 w-11" checked={isActive} disabled={locked || busy} onCheckedChange={(v) => setStatus(u, v)} />
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-[hsl(var(--border))]/70 bg-[hsl(var(--surface-card-1))]/72 p-3 shadow-[inset_0_1px_0_hsl(var(--fg)/0.04)]">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-[hsl(var(--fg))]/82">
                      <div className="font-bold">{usagePercentLabel(percent, usedBytes, lang)} {copy.usage}</div>
                      <div className="font-semibold">
                        {fmtTrafficBytes(usedBytes, lang)} / {fmtGig(u.total_gb, lang)} {copy.gb}
                      </div>
                    </div>
                    <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-[hsl(var(--surface-card-3))] ring-1 ring-[hsl(var(--border))]/45">
                      <div
                        className={"h-full rounded-full bg-gradient-to-r shadow-[0_0_14px_hsl(var(--accent)/0.22)] transition-[width] duration-500 ease-out " + progressTone(percent)}
                        style={{ width: `${visiblePercent}%` }}
                      />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-[hsl(var(--fg))]/70">
                      <div>{copy.used}: <span className="font-semibold text-[hsl(var(--fg))]/90">{fmtTrafficBytes(usedBytes, lang)}</span></div>
                      <div>{copy.remaining}: <span className="font-semibold text-[hsl(var(--fg))]/90">{fmtGig(remainingGb, lang)} {copy.gb}</span></div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <UserActionButton
                      icon={<Layers size={20} />}
                      label={t("users.links")}
                      title={t("users.links")}
                      disabled={busy}
                      onClick={(e) => {
                        e.stopPropagation();
                        openLinks(u);
                      }}
                    />
                    <UserActionButton
                      icon={<Copy size={20} />}
                      label={t("common.copy")}
                      title={copy.copyQuickSub}
                      disabled={busy}
                      onClick={(e) => {
                        e.stopPropagation();
                        copyPrimaryLinkForUser(u, e);
                      }}
                    />
                    <div onClick={(e) => e.stopPropagation()} onMouseEnter={() => ensureQuickLinks(u, false)}>
                      <Menu
                        className="min-w-[260px]"
                        trigger={
                          <UserActionButton
                            icon={<Link2 size={20} />}
                            label={copy.nodeLinks}
                            title={copy.pickNodeLink}
                            disabled={busy}
                            onClick={() => ensureQuickLinks(u, false)}
                          />
                        }
                        items={quickLinkMenuItems(u)}
                      />
                    </div>
                    <UserActionButton
                      icon={<QrCode size={20} />}
                      label="QR"
                      title={copy.qrLinks}
                      disabled={busy}
                      onClick={(e) => {
                        e.stopPropagation();
                        openQr(u);
                      }}
                    />
                    <div onClick={(e) => e.stopPropagation()}>
                      <Menu
                        trigger={
                          <UserActionButton
                            icon={<span className="text-xl font-black leading-none">...</span>}
                            label={copy.more}
                            title={t("users.actions")}
                            disabled={busy}
                          />
                        }
                        items={[
                          {
                            label: t("users.links"),
                            icon: <Layers size={16} />,
                            onClick: () => openLinks(u),
                          },
                          {
                            label: t("users.details"),
                            icon: <Pencil size={16} />,
                            onClick: () => router.push(`/app/users/${u.id}`),
                          },
                          {
                            label: copy.quickEdit,
                            icon: <SquarePen size={16} />,
                            onClick: () => openQuickEdit(u),
                          },
                          {
                            label: isActive ? t("common.disable") : t("common.enable"),
                            icon: <Power size={16} />,
                            disabled: locked || busy || renewalOnly,
                            onClick: () => setStatus(u, !isActive),
                          },
                          {
                            label: t("users.resetUsage"),
                            icon: <Gauge size={16} />,
                            disabled: locked || busy || renewalOnly,
                            onClick: () => ask("reset", u),
                          },
                          {
                            label: t("users.revoke"),
                            icon: <Unlink2 size={16} />,
                            disabled: busy,
                            danger: true,
                            onClick: () => ask("revoke", u),
                          },
                          {
                            label: t("users.delete"),
                            icon: <Trash2 size={16} />,
                            disabled: busy,
                            danger: true,
                            onClick: () => ask("delete", u),
                          },
                        ]}
                      />
                    </div>
                  </div>

                  <div className="hidden">
                    <Button
                      variant="ghost"
                      className={iconButtonClass}
                      size="sm"
                      title={t("users.links")}
                      aria-label={t("users.links")}
                      disabled={busy}
                      onClick={(e) => {
                        e.stopPropagation();
                        openLinks(u);
                      }}
                    >
                      <Layers size={iconSize} />
                    </Button>
                    <Button
                      variant="ghost"
                      className={iconButtonClass}
                      size="sm"
                      title={t("users.details")}
                      aria-label={t("users.details")}
                      disabled={busy}
                      onClick={(e) => {
                        e.stopPropagation();
                        router.push(`/app/users/${u.id}`);
                      }}
                    >
                      <SquarePen size={iconSize} />
                    </Button>
                    <Button
                      variant="ghost"
                      className={iconButtonClass}
                      size="sm"
                      title={copy.copyQuickSub}
                      aria-label={copy.copyQuickSub}
                      disabled={busy}
                      onClick={(e) => {
                        e.stopPropagation();
                        copyPrimaryLinkForUser(u, e);
                      }}
                    >
                      <Copy size={iconSize} />
                    </Button>
                    <div onClick={(e) => e.stopPropagation()} onMouseEnter={() => ensureQuickLinks(u, false)}>
                      <Menu
                        className="min-w-[260px]"
                        trigger={
                          <Button
                            variant="ghost"
                            className={iconButtonClass}
                            size="sm"
                            title={copy.copyQuickSub}
                            aria-label={copy.copyQuickSub}
                            disabled={busy}
                            onClick={() => ensureQuickLinks(u, false)}
                          >
                            <Link2 size={iconSize} />
                          </Button>
                        }
                        items={quickLinkMenuItems(u)}
                      />
                    </div>
                    <Button
                      variant="outline"
                      className={`hidden ${actionSize} rounded-lg border-[hsl(var(--border))]/90 p-0 transition-all duration-200 hover:-translate-y-0.5 hover:border-emerald-400/60 hover:bg-emerald-500/10`}
                      size="sm"
                      title={copy.copyMaster}
                      aria-label={copy.copyMaster}
                      disabled={busy}
                      onClick={(e) => {
                        e.stopPropagation();
                        copyMaster(u, e);
                      }}
                    >
                      <Copy size={18} />
                    </Button>
                    <Button
                      variant="outline"
                      className={`hidden ${actionSize} rounded-lg border-[hsl(var(--border))]/90 p-0 transition-all duration-200 hover:-translate-y-0.5 hover:border-cyan-400/60 hover:bg-cyan-500/10`}
                      size="sm"
                      title={copy.copyAllLinks}
                      aria-label={copy.copyAllLinks}
                      disabled={busy}
                      onClick={(e) => {
                        e.stopPropagation();
                        copyAllLinksForUser(u, e);
                      }}
                    >
                      <Link2 size={18} />
                    </Button>
                    <Button
                      variant="ghost"
                      className={iconButtonClass}
                      size="sm"
                      title={copy.qrLinks}
                      aria-label={copy.qrLinks}
                      disabled={busy}
                      onClick={(e) => {
                        e.stopPropagation();
                        openQr(u);
                      }}
                    >
                      <QrCode size={iconSize} />
                    </Button>
                    {isSingle ? (
                      <>
                        <Button
                          variant="ghost"
                          className={iconButtonClass}
                          size="sm"
                          title={t("users.resetUsage")}
                          aria-label={t("users.resetUsage")}
                          disabled={busy || locked || renewalOnly}
                          onClick={(e) => {
                            e.stopPropagation();
                            ask("reset", u);
                          }}
                        >
                          <Gauge size={iconSize} />
                        </Button>
                        <Button
                          variant="ghost"
                          className={iconButtonClass}
                          size="sm"
                          title={t("users.revoke")}
                          aria-label={t("users.revoke")}
                          disabled={busy}
                          onClick={(e) => {
                            e.stopPropagation();
                            ask("revoke", u);
                          }}
                        >
                          <Unlink2 size={iconSize} />
                        </Button>
                      </>
                    ) : null}

                    <div onClick={(e) => e.stopPropagation()}>
                      <Menu
                        trigger={
                          <Button
                            variant="ghost"
                            className={iconButtonClass}
                            size="sm"
                            title={t("users.actions")}
                            disabled={busy}
                            aria-label={t("users.actions")}
                          >
                            ⋯
                          </Button>
                        }
                        items={[
                          {
                            label: t("users.details"),
                            icon: <Pencil size={16} />,
                            onClick: () => router.push(`/app/users/${u.id}`),
                          },
                          {
                            label: copy.quickEdit,
                            icon: <SquarePen size={16} />,
                            onClick: () => openQuickEdit(u),
                          },
                          {
                            label: copy.copyMaster,
                            icon: <Copy size={16} />,
                            disabled: !showMasterSub,
                            onClick: () => copyMaster(u),
                          },
                          {
                            label: copy.copyAllLinks,
                            icon: <Copy size={16} />,
                            onClick: () => copyAllLinksForUser(u),
                          },
                          {
                            label: copy.qrLinks,
                            icon: <QrCode size={16} />,
                            onClick: () => openQr(u),
                          },
                          {
                            label: isActive ? t("common.disable") : t("common.enable"),
                            icon: <Power size={16} />,
                            disabled: locked || busy || renewalOnly,
                            onClick: () => setStatus(u, !isActive),
                          },
                          {
                            label: t("users.resetUsage"),
                            icon: <Gauge size={16} />,
                            disabled: locked || busy,
                            onClick: () => ask("reset", u),
                          },
                          {
                            label: t("users.revoke"),
                            icon: <Unlink2 size={16} />,
                            disabled: busy,
                            danger: true,
                            onClick: () => ask("revoke", u),
                          },
                          {
                            label: t("users.delete"),
                            icon: <Trash2 size={16} />,
                            disabled: busy,
                            danger: true,
                            onClick: () => ask("delete", u),
                          },
                        ]}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {data && items.length === 0 ? (
        <Card className="rounded-xl">
          <CardContent className="flex flex-col items-center justify-center gap-3 p-10 text-center">
            <div className="text-sm font-medium">
              {lang === "en" ? "No users found" : "کاربری یافت نشد"}
            </div>
            <div className="text-xs text-[hsl(var(--fg))]/60">
              {lang === "en"
                ? "Create your first user to get started."
                : "برای شروع، اولین کاربر خود را بسازید."}
            </div>
            <Button type="button" onClick={() => router.push("/app/users/new")}>
              {lang === "en" ? "Create user" : "ساخت کاربر"}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {data ? (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={data.total || 0}
          onPageChange={setPage}
          onPageSizeChange={(s) => {
            setPageSize(s);
            setPage(1);
          }}
        />
      ) : null}

      {copyHint ? (
        <div
          className="pointer-events-none fixed z-[70] rounded-md border border-emerald-400/35 bg-emerald-500/90 px-2.5 py-1 text-xs font-semibold text-white shadow-lg backdrop-blur-sm"
          style={{ left: copyHint.x + 12, top: copyHint.y - 10 }}
        >
          {copyHint.text}
        </div>
      ) : null}

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={confirmKind === "reset" ? t("users.confirmResetTitle") : confirmKind === "delete" ? t("users.confirmDeleteTitle") : t("users.confirmRevokeTitle")}
      >
        <div className="space-y-4">
          <div className="text-sm text-[hsl(var(--fg))]/80">
            {confirmKind === "reset" ? t("users.confirmResetBody") : confirmKind === "delete" ? t("users.confirmDeleteBody") : t("users.confirmRevokeBody")}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={doConfirm}>{t("common.confirm")}</Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title={copy.quickEditTitle(editUser?.label)}
      >
        {editUser ? (
          <div className="space-y-4 text-sm">
            {renewalOnly ? (
              <div className="flex max-w-full items-center justify-between gap-3 rounded-xl border border-violet-500/25 bg-violet-500/10 p-3 text-xs text-[hsl(var(--fg))]/78">
                <span className="font-medium">{copy.renewalOnlyTitle}</span>
                <HelpTip text={copy.renewalOnlyHelp} />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                <Button type="button" size="sm" variant={quickMode === "renewal" ? "primary" : "outline"} onClick={() => setQuickMode("renewal")}>
                  {copy.renewalPackage}
                </Button>
                <Button type="button" size="sm" variant={quickMode === "extend" ? "primary" : "outline"} onClick={() => setQuickMode("extend")}>
                  {copy.extendTime}
                </Button>
                <Button type="button" size="sm" variant={quickMode === "add" ? "primary" : "outline"} onClick={() => setQuickMode("add")}>
                  {copy.addTraffic}
                </Button>
                <Button type="button" size="sm" variant={quickMode === "dec" ? "primary" : "outline"} onClick={() => setQuickMode("dec")}>
                  {copy.decreaseTraffic}
                </Button>
                <Button type="button" size="sm" variant={quickMode === "time_dec" ? "primary" : "outline"} onClick={() => setQuickMode("time_dec")}>
                  {copy.decreaseTime}
                </Button>
              </div>
            )}

            {quickMode === "renewal" ? (
              <div className="rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(155deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3)/0.28)_100%)] p-3 space-y-3 transition-all duration-200 hover:border-[hsl(var(--accent)/0.35)] hover:shadow-soft">
                <div className="flex items-center gap-2">
                  <div className="font-medium">{copy.renewalPackage}</div>
                  <HelpTip text={copy.renewalHelp} />
                </div>
                <div className="space-y-2">
                  <div className="text-xs font-medium text-[hsl(var(--fg))]/75">{copy.renewalDuration}</div>
                  <div className="flex flex-wrap gap-2">
                    {renewalDurationPresets.map((p) => (
                      <Button key={p.key} type="button" size="sm" variant={editRenewDays === p.days ? "primary" : "outline"} onClick={() => setEditRenewDays(p.days)}>
                        {durationPresetLabel(p, lang)}
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="text-xs font-medium text-[hsl(var(--fg))]/75">{copy.renewalTraffic}</div>
                  <div className="flex flex-wrap gap-2">
                    {renewalTrafficPresets.map((g) => (
                      <Button key={g} type="button" size="sm" variant={editRenewGb === g ? "primary" : "outline"} onClick={() => setEditRenewGb(g)}>
                        {g} {copy.gb}
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-[1fr,1fr,auto]">
                  <label className="space-y-1">
                    <span className="text-[11px] font-medium text-[hsl(var(--fg))]/65">{copy.renewalDays}</span>
                    <Input className="min-w-0" type="number" min={1} value={editRenewDays} disabled={renewalOnly} onChange={(e) => setEditRenewDays(Math.max(1, Number(e.target.value) || 1))} />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] font-medium text-[hsl(var(--fg))]/65">{copy.renewalGb}</span>
                    <Input className="min-w-0" type="number" min={1} value={editRenewGb} disabled={renewalOnly} onChange={(e) => setEditRenewGb(Math.max(1, Number(e.target.value) || 1))} />
                  </label>
                  <Button
                    className="self-end"
                    disabled={busyId === editUser.id || locked}
                    onClick={async () => {
                      const ok = await op(editUser.id, `/api/v1/reseller/users/${editUser.id}/renew`, {
                        days: editRenewDays,
                        total_gb: editRenewGb,
                        pricing_mode: "bundle",
                      });
                      if (ok) setEditOpen(false);
                    }}
                  >
                    {copy.run}
                  </Button>
                </div>
              </div>
            ) : null}

            {!renewalOnly && quickMode === "extend" ? (
              <div className="rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(155deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3)/0.28)_100%)] p-3 space-y-3 transition-all duration-200 hover:border-[hsl(var(--accent)/0.35)] hover:shadow-soft">
                <div className="font-medium">{copy.extendTime} ({copy.days})</div>
                <div className="flex flex-wrap gap-2">
                  {[7, 31, 90, 180].map((d) => (
                    <Button key={d} type="button" size="sm" variant={editDays === d ? "primary" : "outline"} onClick={() => setEditDays(d)}>
                      {d}
                    </Button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Input className="min-w-[130px] flex-1" type="number" value={editDays} onChange={(e) => setEditDays(Math.max(1, Number(e.target.value) || 1))} />
                  <JalaliDateTimePicker
                    mode="icon"
                    value={editTargetDate}
                    onChange={(d) => {
                      setEditTargetDate(d);
                      if (!editUser) return;
                      const delta = computeDaysDeltaFromTarget(editUser.expire_at, d);
                      if (delta.ok && delta.direction === "up" && delta.diffDays > 0) {
                        setEditDays(Math.max(1, Math.min(3650, delta.diffDays)));
                      }
                    }}
                  />
                  <Button
                    disabled={busyId === editUser.id || locked}
                    onClick={async () => {
                      const ok = await op(editUser.id, `/api/v1/reseller/users/${editUser.id}/extend`, { days: editDays });
                      if (ok) setEditOpen(false);
                    }}
                  >
                    {copy.run}
                  </Button>
                </div>
                <div className="text-xs text-[hsl(var(--fg))]/75">
                  {copy.currentExpire}: <span className="font-semibold">{formatJalaliDateTime(new Date(editUser.expire_at))}</span>
                  {editTargetDate ? (
                    <span className="mr-2">
                      | {copy.selectedDate}: <span className="font-semibold">{formatJalaliDateTime(editTargetDate)}</span>
                    </span>
                  ) : null}
                </div>
              </div>
            ) : null}

            {!renewalOnly && quickMode === "add" ? (
              <div className="rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(155deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3)/0.24)_100%)] p-3 space-y-2 transition-all duration-200 hover:border-[hsl(var(--accent)/0.35)] hover:shadow-soft">
                <div className="font-medium">{copy.addTraffic} ({copy.gb})</div>
                <div className="flex flex-wrap gap-2">
                  {[5, 10, 20, 50].map((g) => (
                    <Button key={g} type="button" size="sm" variant={editAddGb === g ? "primary" : "outline"} onClick={() => setEditAddGb(g)}>
                      +{g}
                    </Button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Input className="min-w-[130px] flex-1" type="number" value={editAddGb} onChange={(e) => setEditAddGb(Math.max(1, Number(e.target.value) || 1))} />
                  <Button
                    disabled={busyId === editUser.id || locked}
                    onClick={async () => {
                      const ok = await op(editUser.id, `/api/v1/reseller/users/${editUser.id}/add-traffic`, { add_gb: editAddGb });
                      if (ok) setEditOpen(false);
                    }}
                  >
                    {copy.run}
                  </Button>
                </div>
              </div>
            ) : null}

            {!renewalOnly && quickMode === "dec" ? (
              <div className="rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(155deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3)/0.24)_100%)] p-3 space-y-2 transition-all duration-200 hover:border-[hsl(var(--accent)/0.35)] hover:shadow-soft">
                <div className="font-medium">{copy.decreaseTraffic}</div>
                <div className="flex flex-wrap gap-2">
                  {[1, 5, 10, 20].map((g) => (
                    <Button key={g} type="button" size="sm" variant={editDecGb === g ? "primary" : "outline"} onClick={() => setEditDecGb(g)}>
                      -{g}
                    </Button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Input className="min-w-[130px] flex-1" type="number" value={editDecGb} onChange={(e) => setEditDecGb(Math.max(1, Number(e.target.value) || 1))} />
                  <Button
                    variant="outline"
                    disabled={busyId === editUser.id || locked}
                    onClick={async () => {
                      const ok = await op(editUser.id, `/api/v1/reseller/users/${editUser.id}/refund`, {
                        action: "decrease",
                        decrease_gb: editDecGb,
                      });
                      if (ok) setEditOpen(false);
                    }}
                  >
                    {copy.run}
                  </Button>
                </div>
              </div>
            ) : null}

            {!renewalOnly && quickMode === "time_dec" ? (
              <div className="rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(155deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3)/0.28)_100%)] p-3 space-y-3 transition-all duration-200 hover:border-[hsl(var(--accent)/0.35)] hover:shadow-soft">
                <div className="font-medium">{copy.decreaseTime}</div>
                <div className="flex flex-wrap gap-2">
                  {[1, 3, 7, 15, 31].map((d) => (
                    <Button key={d} type="button" size="sm" variant={editDecDays === d ? "primary" : "outline"} onClick={() => setEditDecDays(d)}>
                      -{d} {copy.days}
                    </Button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Input className="min-w-[130px] flex-1" type="number" min={1} value={editDecDays} onChange={(e) => setEditDecDays(Math.max(1, Number(e.target.value) || 1))} />
                  <JalaliDateTimePicker
                    mode="icon"
                    value={editTargetDate}
                    onChange={(d) => {
                      setEditTargetDate(d);
                      if (!editUser) return;
                      const delta = computeDaysDeltaFromTarget(editUser.expire_at, d);
                      if (delta.ok && delta.direction === "down" && delta.diffDays > 0) {
                        setEditDecDays(Math.max(1, Math.min(3650, delta.diffDays)));
                      }
                    }}
                  />
                  <Button
                    variant="outline"
                    disabled={busyId === editUser.id || locked}
                    onClick={async () => {
                      const ok = await op(editUser.id, `/api/v1/reseller/users/${editUser.id}/decrease-time`, { days: editDecDays });
                      if (ok) setEditOpen(false);
                    }}
                  >
                    {copy.run}
                  </Button>
                </div>
                <div className="text-xs text-[hsl(var(--fg))]/75">
                  {copy.currentExpire}: <span className="font-semibold">{formatJalaliDateTime(new Date(editUser.expire_at))}</span>
                  {editTargetDate ? (
                    <span className="mr-2">
                      | {copy.selectedDate}: <span className="font-semibold">{formatJalaliDateTime(editTargetDate)}</span>
                    </span>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(150deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3)/0.3)_100%)] p-3 space-y-2 transition-all duration-200 hover:border-[hsl(var(--accent)/0.35)] hover:shadow-soft">
              <div className="font-medium">{copy.quickControl}</div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="gap-2"
                  disabled={busyId === editUser.id || locked || renewalOnly}
                  onClick={() => {
                    setEditOpen(false);
                    ask("reset", editUser);
                  }}
                >
                  <Gauge size={15} /> {copy.resetUsage}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="gap-2"
                  disabled={busyId === editUser.id}
                  onClick={() => {
                    setEditOpen(false);
                    ask("revoke", editUser);
                  }}
                >
                  <Unlink2 size={15} /> {copy.rebuildLink}
                </Button>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditOpen(false)}>{t("common.cancel")}</Button>
              <Button variant="outline" className="gap-2" onClick={() => router.push(`/app/users/${editUser.id}`)}>
                <SquarePen size={16} /> {copy.goDetails}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={qrOpen}
        onClose={() => setQrOpen(false)}
        title={qrUser ? `${copy.qrLinks}: ${qrUser.label}` : copy.qrLinks}
        className="max-w-4xl"
      >
        {qrErr ? <div className="text-sm text-red-500">{qrErr}</div> : null}
        {!qrLinks && !qrErr ? <div className="text-sm text-[hsl(var(--fg))]/70">{t("common.loading")}</div> : null}

        {qrLinks ? (
          <div className="space-y-4">
            <div className="max-w-full overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-3))] p-3 text-xs text-[hsl(var(--fg))]/80 break-words [overflow-wrap:anywhere]">
              {copy.qrHelp}
            </div>

            {qrItems.length ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {qrItems.map((item) => (
                  <article key={item.key} className="space-y-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))]/72 p-3 sm:p-4">
                    <div>
                      <div className="font-semibold break-all">{item.title}</div>
                      <div className="text-xs text-[hsl(var(--fg))]/70">{item.subtitle}</div>
                    </div>
                    <div className="mx-auto flex aspect-square w-full max-w-[260px] items-center justify-center rounded-2xl border border-[hsl(var(--border))] bg-white p-3 shadow-inner">
                      <img src={qrImageUrl(item.url, 280)} alt={`QR ${item.title}`} width={280} height={280} className="h-full w-full object-contain" />
                    </div>
                    <div className="max-h-24 overflow-auto rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-3))]/50 p-2 font-mono text-[11px] leading-5 break-all [overflow-wrap:anywhere]">
                      {item.url}
                    </div>
                    <div className="grid gap-2 sm:flex sm:flex-wrap">
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full gap-2 sm:w-auto"
                        onClick={() => {
                          copyText(item.url).then((ok) => push({ title: ok ? t("common.copied") : t("common.failed"), type: ok ? "success" : "error" }));
                        }}
                      >
                        <Copy size={14} /> {t("common.copy")}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full gap-2 sm:w-auto"
                        onClick={() => {
                          window.open(item.url, "_blank", "noopener,noreferrer");
                        }}
                      >
                        <ExternalLink size={14} /> {copy.open}
                      </Button>
                      {item.isWg ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full gap-2 sm:w-auto"
                          onClick={() => {
                            window.open(item.url, "_blank", "noopener,noreferrer");
                          }}
                        >
                          <Download size={14} /> {copy.downloadConf}
                        </Button>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="text-sm text-[hsl(var(--fg))]/70">{copy.noQrLink}</div>
            )}
          </div>
        ) : null}
      </Modal>

      <Modal open={linksOpen} onClose={() => setLinksOpen(false)} title={t("users.linksTitle").replace("{label}", linksUser?.label || "")} className="max-w-4xl">
        {linksErr ? <div className="text-sm text-red-500">{linksErr}</div> : null}
        {!links && !linksErr ? <div className="text-sm text-[hsl(var(--fg))]/70">{t("common.loading")}</div> : null}

        {links ? (
          <div className="space-y-4 text-sm">
            <div className="max-w-full overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-3))] p-3 text-xs text-[hsl(var(--fg))]/80 break-words [overflow-wrap:anywhere]">
              {copy.linksHint}
            </div>
            {showMasterSub && links.master_link ? (
            <div className="space-y-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))]/72 p-3 sm:p-4">
              <div className="font-semibold">{t("users.masterSub")}</div>
              <div className="max-h-32 overflow-auto rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-3))]/70 p-3 font-mono text-xs leading-5 break-all [overflow-wrap:anywhere]">{links.master_link}</div>
              <div className="grid gap-2 sm:flex sm:flex-wrap">
                <Button
                  variant="outline"
                  className="w-full sm:w-auto"
                  onClick={() => {
                    copyText(links.master_link || "").then((ok) => push({ title: ok ? t("common.copied") : t("common.failed"), type: ok ? "success" : "error" }));
                  }}
                >
                  {t("common.copy")}
                </Button>
                <Button
                  variant="outline"
                  className="w-full gap-2 sm:w-auto"
                  onClick={() => {
                    const directList = extractDirectLinks(links);
                    if (!directList.length) {
                      push({ title: copy.noDirectLink, type: "warning" });
                      return;
                    }
                    const direct = directList.join("\n");
                    copyText(direct).then((ok) => push({ title: ok ? t("common.copied") : t("common.failed"), type: ok ? "success" : "error" }));
                  }}
                >
                  <Link2 size={15} /> {copy.copyDirectLinks}
                </Button>
                <Button
                  variant="outline"
                  className="w-full gap-2 sm:w-auto"
                  onClick={() => {
                    const direct = extractDirectLinks(links);
                    const all = [...direct, showMasterSub ? links.master_link : null].filter(Boolean).join("\n");
                    copyText(all).then((ok) => push({ title: ok ? t("common.copied") : t("common.failed"), type: ok ? "success" : "error" }));
                  }}
                >
                  <Copy size={15} /> {copy.copyAllLinks}
                </Button>
              </div>
            </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => {
                  const directList = extractDirectLinks(links);
                  if (!directList.length) {
                    push({ title: copy.noDirectLink, type: "warning" });
                    return;
                  }
                  copyText(directList.join("\n")).then((ok) => push({ title: ok ? t("common.copied") : t("common.failed"), type: ok ? "success" : "error" }));
                }}
              >
                <Link2 size={15} /> {copy.copyDirectLinks}
              </Button>
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => {
                  const direct = extractDirectLinks(links);
                  const all = [...direct, showMasterSub ? links.master_link : null].filter(Boolean).join("\n");
                  if (!all) {
                    push({ title: copy.noLinkToCopy, type: "warning" });
                    return;
                  }
                  copyText(all).then((ok) => push({ title: ok ? t("common.copied") : t("common.failed"), type: ok ? "success" : "error" }));
                }}
              >
                <Copy size={15} /> {copy.copyAllLinks}
              </Button>
            </div>

            <div className="space-y-2">
              <div className="font-semibold">{t("users.panelSubs")}</div>
              <div className="space-y-2">
                {links.node_links.map((nl) => {
                  const node = nodeMap.get(nl.node_id);
                  const nodeName = node?.name || nl.node_name;
                  const isWg = (nl.panel_type || "").toLowerCase() === "wg_dashboard";
                  const full = nl.config_download_url
                    ? nl.config_download_url
                    : nl.full_url
                    ? nl.full_url
                    : nl.direct_url
                    ? normalizeUrl(nl.direct_url, node?.base_url)
                    : "";
                  return (
                  <div key={nl.node_id} className="space-y-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))]/68 p-3 sm:p-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs text-[hsl(var(--fg))]/70">{nodeName ? `${nodeName} (#${nl.node_id})` : `Node #${nl.node_id}`}</div>
                      <Badge variant={nl.status === "ok" ? "success" : nl.status === "missing" ? "warning" : "danger"}>{nl.status}</Badge>
                    </div>
                    {full ? (
                      <>
                        <div className="max-h-32 overflow-auto rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-3))]/60 p-3 font-mono text-xs leading-5 break-all [overflow-wrap:anywhere]">{full}</div>
                        <div>
                          <div className="grid gap-2 sm:flex sm:flex-wrap">
                            <Button
                              variant="outline"
                              className="w-full sm:w-auto"
                              onClick={() => {
                                if (!full) return;
                                copyText(full).then((ok) => push({ title: ok ? t("common.copied") : t("common.failed"), type: ok ? "success" : "error" }));
                              }}
                            >
                              {t("common.copy")}
                            </Button>
                            {isWg ? (
                              <Button
                                variant="outline"
                                className="w-full gap-2 sm:w-auto"
                                onClick={() => {
                                  window.open(full, "_blank", "noopener,noreferrer");
                                }}
                              >
                                <Download size={15} /> {copy.downloadConf}
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="mt-2 text-xs text-[hsl(var(--fg))]/70">{nl.detail || t("users.noLink")}</div>
                    )}
                  </div>
                );
                })}
              </div>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
