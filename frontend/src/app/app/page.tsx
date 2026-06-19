"use client";

import * as React from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  Boxes,
  CheckCircle2,
  Clock3,
  Coins,
  Database,
  Download,
  Gauge,
  Network,
  Server,
  ShieldAlert,
  ShoppingCart,
  TrendingUp,
  UsersRound,
  Wallet,
} from "lucide-react";

import { apiFetch } from "@/lib/api";
import { useAuth } from "@/components/auth-context";
import { useI18n } from "@/components/i18n-context";
import { fmtNumber, formatNumberWithDigits, localizeDigits } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatJalaliDateTime } from "@/lib/jalali";

type DashboardSeriesPoint = { date: string; value: number };

type AdminStats = {
  resellers_total: number;
  users_total: number;
  users_active?: number;
  users_disabled?: number;
  users_expired?: number;
  users_limited?: number;
  users_on_hold?: number;
  users_deleted?: number;
  nodes_total: number;
  orders_total: number;
  ledger_entries_total: number;
  ledger_net_30d: number;
  price_per_gb_avg?: number | null;
  used_bytes_total: number;
  sold_gb_total: number;
  daily_sales?: DashboardSeriesPoint[];
  daily_traffic_gb?: DashboardSeriesPoint[];
  daily_used_gb?: DashboardSeriesPoint[];
};

type ResellerStats = {
  reseller_id: number;
  balance: number;
  status: string;
  price_per_gb: number;
  bundle_price_per_gb: number;
  price_per_day: number;
  users_total: number;
  users_active: number;
  users_disabled: number;
  users_expired?: number;
  users_limited?: number;
  users_on_hold?: number;
  users_deleted?: number;
  used_bytes_total: number;
  sold_gb_total: number;
  nodes_allowed: number;
  orders_total: number;
  orders_30d: number;
  spent_30d: number;
  daily_sales?: DashboardSeriesPoint[];
  daily_traffic_gb?: DashboardSeriesPoint[];
  daily_used_gb?: DashboardSeriesPoint[];
};

type AccountOption = {
  id: number;
  username: string;
  role?: string;
  status?: string;
};

type AccountList = { items: AccountOption[]; total: number };

type NodeLite = {
  id: number;
  name: string;
  panel_type?: string;
  is_enabled?: boolean;
  is_visible_in_sub?: boolean;
  default_for_reseller?: boolean;
  price_per_gb_override?: number | null;
  last_sync_at?: string | null;
};

type UserLite = { id: number; label: string; status: string };

type OrderRow = {
  id: number;
  reseller_id: number;
  user_id: number | null;
  type: string;
  status: string;
  purchased_gb: number | null;
  price_per_gb_snapshot: number | null;
  created_at: string | null;
};

type LedgerRow = {
  id: number;
  reseller_id: number;
  order_id: number | null;
  amount: number;
  reason: string;
  balance_after: number;
  occurred_at: string | null;
};

type BadgeVariant = "default" | "success" | "warning" | "danger" | "muted";
type TileTone = "blue" | "green" | "orange" | "rose" | "cyan" | "violet" | "slate";
type ChartMetric = "sold" | "used";

const REPORT_LIMIT = 200;
const CHART_DAYS = 14;
const CHART_RANGE_OPTIONS = [
  { days: 1, fa: "۱ روز اخیر", en: "Last 24 hours" },
  { days: 7, fa: "۷ روز اخیر", en: "Last 7 days" },
  { days: 30, fa: "۱ ماه اخیر", en: "Last month" },
  { days: 90, fa: "۳ ماه اخیر", en: "Last 3 months" },
  { days: 180, fa: "۶ ماه اخیر", en: "Last 6 months" },
  { days: 365, fa: "۱ سال اخیر", en: "Last year" },
  { days: 3650, fa: "کلی", en: "All time" },
] as const;

function isEnglish(lang: string) {
  return lang === "en";
}

function chartRangeLabel(days: number, lang: string) {
  const option = CHART_RANGE_OPTIONS.find((item) => item.days === days) || CHART_RANGE_OPTIONS[1];
  return localizeDigits(isEnglish(lang) ? option.en : option.fa);
}

function accountRoleLabel(role: string | undefined, lang: string) {
  const isAdmin = (role || "reseller") === "admin";
  if (isEnglish(lang)) return isAdmin ? "Super admin" : "Reseller";
  return isAdmin ? "سوپرادمین" : "رسیلر";
}

function compactSeries(data: Array<{ label: string; value: number }>, maxPoints = 60) {
  if (data.length <= maxPoints) return data;
  const chunkSize = Math.ceil(data.length / maxPoints);
  const compacted: Array<{ label: string; value: number }> = [];
  for (let index = 0; index < data.length; index += chunkSize) {
    const chunk = data.slice(index, index + chunkSize);
    const first = chunk[0];
    const last = chunk[chunk.length - 1];
    compacted.push({
      label: first?.label === last?.label ? first?.label || "" : `${first?.label || ""} - ${last?.label || ""}`,
      value: chunk.reduce((acc, point) => acc + Number(point.value || 0), 0),
    });
  }
  return compacted;
}

function dashboardCopy(lang: string) {
  if (isEnglish(lang)) {
    return {
      heroBadge: "Guardino Command Center",
      adminTitle: "Super Admin Dashboard",
      resellerTitle: "Reseller Dashboard",
      adminSubtitle: "Track users, traffic, reseller health and panel usage from one clean view.",
      resellerSubtitle: "Review your users, balance, traffic and assigned nodes faster.",
      createUser: "Create user",
      users: "Users",
      nodes: "Nodes",
      csv: "CSV export",
      sold: "Sold volume",
      used: "Used volume",
      remaining: "Remaining capacity",
      usage: "Usage",
      lowBalance: "Low balance warning",
      lowBalanceBody: (balance: string, gb?: string) => `Your balance is ${balance} Toman.${gb ? ` At the current price, about ${gb} GB is available.` : ""}`,
      userOverviewTitleAdmin: "Panel user overview",
      userOverviewTitleReseller: "My user overview",
      userOverviewSubtitleAdmin: "Fast split of active, expired, limited, on-hold and disabled users.",
      userOverviewSubtitleReseller: "User status for this account and the selected period.",
      trafficTitle: "Usage and sold volume",
      trafficSubtitle: "Compare recorded usage and sold volume for the selected account and period. The top cards still show the whole account total.",
      updating: "Updating",
      range: "Range",
      account: "Account",
      allAccounts: "All accounts",
      myAccount: "My account",
      metric: "Metric",
      both: "Both",
      soldMetric: "Sold volume",
      usedMetric: "Recorded usage",
      soldHint: "Completed order volume in the selected period",
      usedHint: "Daily usage snapshots for the selected account",
      totalSold: "Total sold volume",
      totalUsed: "Total recorded usage",
      totalRemaining: "Remaining capacity",
      noData: "No data has been recorded for this range yet.",
      trend: "Trend",
      recentDays: (count: string) => `Last ${count} days`,
      gbUnit: "GB",
      usageLabel: "Usage",
      soldShort: "Sold",
      usedShort: "Used",
      remainingShort: "Remaining",
      nodeDefault: "Default",
      lastSync: "Last sync",
      customPrice: "Custom price",
      enabled: "Enabled",
      off: "Off",
      visibleInSub: "Visible in sub",
      hidden: "Hidden",
      noNodes: "No nodes to show.",
      pendingOperations: "Pending operations",
      ordersSample: (count: string) => `From the last ${count} fetched orders`,
      failedOrRolledBack: "Failed / rolled back",
      remoteErrorHint: "For remote panel errors, start from the orders report.",
      noTime: "No time",
      noIssues: "No pending or failed item was found in recent data.",
      viewOrders: "View order reports",
      manageUsers: "Manage users",
      recentUsersEmpty: "No recent users to show.",
      analysisTitle: "Sales and usage analysis",
      analysisSubtitle: "Charts are built from order reports and the ledger.",
      dailySales: "Daily sales",
      selectedRangeOutput: "Output for the selected range from usage transactions",
      orderVolume: "Order volume",
      orderVolumeSubtitle: "Total GB purchased in recent orders",
      capacityTitle: "Total capacity usage",
      capacitySubtitle: "User usage ratio against sold volume.",
      nodeHealthTitle: "Node health",
      nodeHealthSubtitle: "Badges show enabled status, subscription visibility and last sync for each node.",
      manageNodes: "Manage nodes",
      operationsTitle: "Operations and errors",
      operationsSubtitle: "For professional sales, pending/failed items should be visible quickly.",
      needsReview: "Needs review",
      stable: "Stable",
      mySalesTitle: "My sales and usage",
      mySalesSubtitle: "Charts are built from your account orders and ledger transactions.",
      walletUsage: "Wallet usage",
      selectedRange: "Selected range",
      myCapacityTitle: "User capacity",
      myCapacitySubtitle: "Your users' total usage against sold volume.",
      assignedNodesTitle: "Assigned nodes",
      assignedNodesSubtitle: "Node, panel and last sync status for your users.",
      viewNodes: "View nodes",
      recentUsersTitle: "Recent users",
      recentUsersSubtitle: "Quick access to newly created users.",
      allUsers: "All users",
      recentOperationsTitle: "Recent operations",
      recentOperationsSubtitle: "Pending or failed orders to prevent sales mistakes.",
      userStatus: {
        total: "Total users",
        active: "Active users",
        expired: "Expired",
        limited: "Volume ended",
        onHold: "On Hold",
        disabled: "Disabled",
        deleted: "Deleted / archived",
      },
      adminCards: {
        resellers: "Resellers",
        totalUsers: "Total users",
        nodes: "Nodes",
        orders: "Orders",
        ledger30: "30-day ledger",
        recentTurnover: "Recent turnover",
        avgPrice: "Avg price/GB",
        ledgerEntries: "Ledger entries",
        notSet: "Not set",
      },
      resellerCards: {
        balance: "Balance",
        users: "Users",
        allowedNodes: "Allowed nodes",
        orders30: "30-day orders",
        wallet30: "30-day wallet usage",
        priceGb: "Price/GB",
        bundleGb: "Bundle/GB",
        priceDay: "Price/day",
      },
    };
  }
  return {
    heroBadge: "Guardino Command Center",
    adminTitle: "داشبورد سوپرادمین",
    resellerTitle: "داشبورد رسیلر",
    adminSubtitle: "فروش، مصرف، سلامت نودها و عملیات ناموفق را در یک نمای مرتب کنترل کنید.",
    resellerSubtitle: "وضعیت فروش، مصرف کاربران، موجودی و نودهای اختصاص داده شده را سریع‌تر ببینید.",
    createUser: "ساخت کاربر",
    users: "کاربران",
    nodes: "نودها",
    csv: "خروجی CSV",
    sold: "حجم فروخته شده",
    used: "حجم مصرف شده",
    remaining: "ظرفیت باقی مانده",
    usage: "مصرف کل",
    lowBalance: "هشدار موجودی پایین",
    lowBalanceBody: (balance: string, gb?: string) => `موجودی شما ${balance} تومان است.${gb ? ` با قیمت فعلی تقریبا ${gb} گیگ قابل خرید است.` : ""}`,
    userOverviewTitleAdmin: "نمای کاربران کل پنل",
    userOverviewTitleReseller: "نمای کاربران من",
    userOverviewSubtitleAdmin: "تفکیک سریع کاربران فعال، منقضی، حجمی، On Hold و غیرفعال.",
    userOverviewSubtitleReseller: "وضعیت کاربران همین حساب و بازه انتخاب‌شده.",
    trafficTitle: "مصرف و حجم زده‌شده",
    trafficSubtitle: "مقایسه مصرف ثبت‌شده و حجم زده‌شده برای بازه و حساب انتخابی. اعداد کل بالای داشبورد همیشه کل حساب را نشان می‌دهند.",
    updating: "در حال بروزرسانی",
    range: "بازه",
    account: "حساب",
    allAccounts: "همه حساب‌ها",
    myAccount: "حساب من",
    metric: "نوع داده",
    both: "هر دو",
    soldMetric: "حجم زده‌شده",
    usedMetric: "مصرف ثبت‌شده",
    soldHint: "GB ثبت‌شده در سفارش‌های تکمیل‌شده همین بازه",
    usedHint: "آخرین snapshot روزانه از مصرف کاربران برای همین حساب",
    totalSold: "حجم کل ثبت‌شده",
    totalUsed: "مصرف کل ثبت‌شده",
    totalRemaining: "ظرفیت باقی‌مانده",
    noData: "هنوز داده‌ای برای این بازه ثبت نشده است.",
    trend: "روند",
    recentDays: (count: string) => `${count} روز اخیر`,
    gbUnit: "گیگ",
    usageLabel: "مصرف",
    soldShort: "فروخته شده",
    usedShort: "مصرف شده",
    remainingShort: "باقی مانده",
    nodeDefault: "پیش فرض",
    lastSync: "آخرین sync",
    customPrice: "قیمت اختصاصی",
    enabled: "فعال",
    off: "خاموش",
    visibleInSub: "نمایش در ساب",
    hidden: "مخفی",
    noNodes: "نودی برای نمایش وجود ندارد.",
    pendingOperations: "عملیات در انتظار",
    ordersSample: (count: string) => `از آخرین ${count} سفارش دریافت شده`,
    failedOrRolledBack: "خطا / برگشتی",
    remoteErrorHint: "برای خطاهای remote panel از گزارش سفارش‌ها شروع کن.",
    noTime: "بدون زمان",
    noIssues: "مورد pending یا failed در داده‌های اخیر دیده نشد.",
    viewOrders: "مشاهده گزارش سفارش‌ها",
    manageUsers: "مدیریت کاربران",
    recentUsersEmpty: "کاربر جدیدی برای نمایش وجود ندارد.",
    analysisTitle: "تحلیل فروش و مصرف",
    analysisSubtitle: "نمودارها از گزارش سفارش‌ها و دفترکل موجود ساخته می‌شوند.",
    dailySales: "فروش روزانه",
    selectedRangeOutput: "خروجی بازه انتخاب‌شده از تراکنش‌های مصرف",
    orderVolume: "حجم سفارش‌ها",
    orderVolumeSubtitle: "مجموع GB خریداری شده در سفارش‌های اخیر",
    capacityTitle: "مصرف کل ظرفیت",
    capacitySubtitle: "نسبت مصرف کاربران به حجم فروخته شده.",
    nodeHealthTitle: "سلامت نودها",
    nodeHealthSubtitle: "Badgeها وضعیت فعال بودن، نمایش در ساب و آخرین sync هر نود را نشان می‌دهند.",
    manageNodes: "مدیریت نودها",
    operationsTitle: "عملیات و خطاها",
    operationsSubtitle: "برای فروش حرفه‌ای، pending/failed باید سریع دیده شود.",
    needsReview: "نیازمند بررسی",
    stable: "پایدار",
    mySalesTitle: "فروش و مصرف من",
    mySalesSubtitle: "نمودارها از سفارش‌ها و تراکنش‌های حساب شما ساخته می‌شوند.",
    walletUsage: "مصرف کیف پول",
    selectedRange: "بازه انتخاب‌شده",
    myCapacityTitle: "ظرفیت کاربران",
    myCapacitySubtitle: "مصرف کل کاربران شما نسبت به حجم فروخته شده.",
    assignedNodesTitle: "نودهای اختصاص داده شده",
    assignedNodesSubtitle: "وضعیت نودها، پنل و آخرین sync مربوط به کاربران شما.",
    viewNodes: "مشاهده نودها",
    recentUsersTitle: "آخرین کاربران",
    recentUsersSubtitle: "دسترسی سریع به کاربرهای تازه ساخته شده.",
    allUsers: "همه کاربران",
    recentOperationsTitle: "عملیات اخیر",
    recentOperationsSubtitle: "سفارش‌های در انتظار یا ناموفق برای جلوگیری از خطای فروش.",
    userStatus: {
      total: "کل کاربران",
      active: "کاربران فعال",
      expired: "منقضی شده",
      limited: "حجم تمام شده",
      onHold: "On Hold",
      disabled: "غیرفعال",
      deleted: "حذف‌شده / آرشیو",
    },
    adminCards: {
      resellers: "رسیلرها",
      totalUsers: "کاربران کل",
      nodes: "نودها",
      orders: "سفارش‌ها",
      ledger30: `فروش/مصرف ${formatNumberWithDigits(30)} روز`,
      recentTurnover: "گردش فروش اخیر",
      avgPrice: "میانگین قیمت/GB",
      ledgerEntries: "تراکنش‌های دفتر کل",
      notSet: "ثبت نشده",
    },
    resellerCards: {
      balance: "موجودی",
      users: "کاربران",
      allowedNodes: "نودهای مجاز",
      orders30: `سفارش ${formatNumberWithDigits(30)} روز`,
      wallet30: `مصرف کیف پول ${formatNumberWithDigits(30)} روز`,
      priceGb: "قیمت/GB",
      bundleGb: "باندل/GB",
      priceDay: "قیمت/روز",
    },
  };
}

function bytesToGb(bytes: number) {
  return Number(bytes || 0) / (1024 * 1024 * 1024);
}

function fmtGig(value: number) {
  return formatNumberWithDigits(Number.isFinite(value) ? value : 0, { maximumFractionDigits: 1 });
}

function pct(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function sum<T>(items: T[], pick: (item: T) => number) {
  return items.reduce((acc, item) => acc + (Number(pick(item)) || 0), 0);
}

async function safeApi<T>(task: Promise<T>, fallback: T): Promise<T> {
  try {
    return await task;
  } catch {
    return fallback;
  }
}

function normalizeNodes(raw: any): NodeLite[] {
  const arr = Array.isArray(raw) ? raw : raw?.items || [];
  return arr.map((n: any) => ({
    id: Number(n.id),
    name: String(n.name || `Node #${n.id}`),
    panel_type: n.panel_type,
    is_enabled: n.is_enabled,
    is_visible_in_sub: n.is_visible_in_sub,
    default_for_reseller: n.default_for_reseller,
    price_per_gb_override: n.price_per_gb_override,
    last_sync_at: n.last_sync_at || null,
  }));
}

function panelLabel(panel?: string, lang = "fa") {
  if (panel === "wg_dashboard") return "WireGuard";
  if (panel === "pasarguard") return "Pasarguard";
  if (panel === "marzban") return "Marzban";
  return panel || (isEnglish(lang) ? "Unknown" : "نامشخص");
}

function panelVariant(panel?: string): BadgeVariant {
  if (panel === "wg_dashboard") return "success";
  if (panel === "pasarguard") return "warning";
  if (panel === "marzban") return "default";
  return "muted";
}

function orderStatusMeta(status: string, lang = "fa"): { label: string; variant: BadgeVariant } {
  const en = isEnglish(lang);
  const s = (status || "").toLowerCase();
  if (s === "completed") return { label: en ? "Completed" : "تکمیل شده", variant: "success" };
  if (s === "pending") return { label: en ? "Pending" : "در انتظار", variant: "warning" };
  if (s === "failed") return { label: en ? "Failed" : "ناموفق", variant: "danger" };
  if (s === "rolled_back") return { label: en ? "Rolled back" : "برگشتی", variant: "muted" };
  return { label: status || (en ? "Unknown" : "نامشخص"), variant: "muted" };
}

function orderTypeLabel(type: string, lang = "fa") {
  const en = isEnglish(lang);
  const t = (type || "").toLowerCase();
  if (t === "create") return en ? "Create user" : "ساخت کاربر";
  if (t === "add_traffic") return en ? "Add traffic" : "افزایش حجم";
  if (t === "extend") return en ? "Renew / extend" : "تمدید";
  if (t === "change_nodes") return en ? "Change nodes" : "تغییر نود";
  if (t === "refund") return en ? "Refund" : "بازگشت وجه";
  if (t === "delete") return en ? "Delete user" : "حذف کاربر";
  return type || (en ? "Unknown" : "نامشخص");
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function chartDays(days = CHART_DAYS, lang = "fa") {
  const today = new Date();
  return Array.from({ length: days }, (_, index) => {
    const d = new Date(today);
    d.setHours(0, 0, 0, 0);
    d.setDate(today.getDate() - (days - 1 - index));
    return {
      key: dateKey(d),
      label: localizeDigits(d.toLocaleDateString(isEnglish(lang) ? "en-US" : "fa-IR-u-ca-persian", { month: "short", day: "numeric" })),
    };
  });
}

function labelForDateKey(key: string, lang = "fa") {
  const [year, month, day] = key.split("-").map(Number);
  if (!year || !month || !day) return key;
  const d = new Date(year, month - 1, day);
  return localizeDigits(d.toLocaleDateString(isEnglish(lang) ? "en-US" : "fa-IR-u-ca-persian", { month: "short", day: "numeric" }));
}

function normalizeApiSeries(points: DashboardSeriesPoint[] | undefined, fallback: Array<{ label: string; value: number }>, days = CHART_DAYS, lang = "fa") {
  if (!points?.length) return fallback;
  const base = chartDays(days, lang);
  const values = new Map(base.map((d) => [d.key, 0]));
  for (const point of points) {
    const key = String(point.date || "").slice(0, 10);
    if (values.has(key)) values.set(key, Number(point.value || 0));
  }
  return base.map((d) => ({ ...d, label: labelForDateKey(d.key, lang), value: values.get(d.key) || 0 }));
}

function buildLedgerDebitSeries(items: LedgerRow[], days = CHART_DAYS, lang = "fa") {
  const base = chartDays(days, lang);
  const values = new Map(base.map((d) => [d.key, 0]));
  for (const item of items) {
    if (!item.occurred_at) continue;
    const d = new Date(item.occurred_at);
    if (Number.isNaN(d.getTime())) continue;
    const key = dateKey(d);
    if (!values.has(key)) continue;
    const amount = Number(item.amount || 0);
    if (amount < 0) values.set(key, (values.get(key) || 0) + Math.abs(amount));
  }
  return base.map((d) => ({ ...d, value: values.get(d.key) || 0 }));
}

function buildOrderGbSeries(items: OrderRow[], days = CHART_DAYS, lang = "fa") {
  const base = chartDays(days, lang);
  const values = new Map(base.map((d) => [d.key, 0]));
  for (const item of items) {
    if (!item.created_at) continue;
    const d = new Date(item.created_at);
    if (Number.isNaN(d.getTime())) continue;
    const key = dateKey(d);
    if (!values.has(key)) continue;
    values.set(key, (values.get(key) || 0) + (Number(item.purchased_gb || 0) || 0));
  }
  return base.map((d) => ({ ...d, value: values.get(d.key) || 0 }));
}

function formatSync(value: string | null | undefined, lang = "fa") {
  if (!value) return isEnglish(lang) ? "Not set" : "ثبت نشده";
  const d = new Date(value);
  if (isEnglish(lang) && !Number.isNaN(d.getTime())) return localizeDigits(d.toLocaleString("en-US"));
  return formatJalaliDateTime(value);
}

function csvEscape(value: unknown) {
  const raw = value == null ? "" : String(value);
  return `"${raw.replace(/"/g, '""')}"`;
}

function downloadCsv(filename: string, rows: Array<Record<string, unknown>>) {
  if (typeof window === "undefined" || rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const csv = [headers.join(","), ...rows.map((row) => headers.map((h) => csvEscape(row[h])).join(","))].join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function toneClass(tone: TileTone) {
  const tones: Record<TileTone, string> = {
    blue: "bg-[linear-gradient(145deg,rgba(59,130,246,0.14),rgba(14,165,233,0.06))]",
    green: "bg-[linear-gradient(145deg,rgba(16,185,129,0.14),rgba(20,184,166,0.06))]",
    orange: "bg-[linear-gradient(145deg,rgba(249,115,22,0.14),rgba(245,158,11,0.06))]",
    rose: "bg-[linear-gradient(145deg,rgba(244,63,94,0.13),rgba(251,113,133,0.06))]",
    cyan: "bg-[linear-gradient(145deg,rgba(6,182,212,0.13),rgba(59,130,246,0.06))]",
    violet: "bg-[linear-gradient(145deg,rgba(139,92,246,0.13),rgba(99,102,241,0.06))]",
    slate: "bg-[linear-gradient(145deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)]",
  };
  return tones[tone];
}

function KpiTile({
  title,
  value,
  hint,
  icon,
  tone = "slate",
}: {
  title: string;
  value: string;
  hint?: string;
  icon: React.ReactNode;
  tone?: TileTone;
}) {
  return (
    <div
      className={`min-w-0 rounded-xl border border-[hsl(var(--border))] ${toneClass(
        tone
      )} p-3 shadow-[0_10px_24px_-22px_hsl(var(--fg)/0.55)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[hsl(var(--accent)/0.35)]`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-xs font-medium text-[hsl(var(--fg))]/68">{title}</div>
          <div className="mt-1 truncate text-xl font-bold tracking-tight sm:text-2xl">{value}</div>
        </div>
        <div className="shrink-0 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1)/0.78)] p-2 text-[hsl(var(--fg))]/68">
          {icon}
        </div>
      </div>
      {hint ? <div className="mt-2 line-clamp-2 text-xs leading-5 text-[hsl(var(--fg))]/58">{hint}</div> : null}
    </div>
  );
}

function SectionPanel({
  title,
  subtitle,
  icon,
  action,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`min-w-0 overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(165deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-2))_56%,hsl(var(--surface-card-3))_100%)] shadow-[0_14px_30px_-24px_hsl(var(--fg)/0.48)] ${className || ""}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[hsl(var(--border))] bg-[linear-gradient(110deg,hsl(var(--surface-header-accent)/0.12),transparent_72%)] px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold sm:text-base">
            {icon ? <span className="text-[hsl(var(--accent))]">{icon}</span> : null}
            <span className="truncate">{title}</span>
          </div>
          {subtitle ? <div className="mt-1 text-xs leading-5 text-[hsl(var(--fg))]/62">{subtitle}</div> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function MiniBars({
  data,
  valueLabel,
  tone = "blue",
  rangeLabel,
  emptyLabel = "No data has been recorded for this range yet.",
}: {
  data: Array<{ label: string; value: number }>;
  valueLabel: (value: number) => string;
  tone?: TileTone;
  rangeLabel?: string;
  emptyLabel?: string;
}) {
  const max = Math.max(1, ...data.map((d) => Number(d.value) || 0));
  const hasData = data.some((d) => Number(d.value) > 0);
  const barClass: Record<TileTone, string> = {
    blue: "bg-[linear-gradient(180deg,#2563eb,#38bdf8)]",
    green: "bg-[linear-gradient(180deg,#059669,#2dd4bf)]",
    orange: "bg-[linear-gradient(180deg,#ea580c,#fbbf24)]",
    rose: "bg-[linear-gradient(180deg,#e11d48,#fb7185)]",
    cyan: "bg-[linear-gradient(180deg,#0891b2,#60a5fa)]",
    violet: "bg-[linear-gradient(180deg,#7c3aed,#818cf8)]",
    slate: "bg-[linear-gradient(180deg,#475569,#94a3b8)]",
  };
  const tickValues = [max, max / 2, 0];
  const labelStep = Math.max(1, Math.ceil(data.length / 5));

  return (
    <div className="min-w-0 rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(180deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] p-3">
      <div className="grid min-w-0 grid-cols-[44px_minmax(0,1fr)] gap-3 [direction:ltr]">
        <div className="flex h-48 flex-col justify-between pb-7 pt-1 text-right text-[10px] text-[hsl(var(--fg))]/50">
          {tickValues.map((tick) => (
            <span key={tick}>{valueLabel(tick)}</span>
          ))}
        </div>
        <div className="relative min-w-0">
          <div className="pointer-events-none absolute inset-x-0 top-1 h-px border-t border-dashed border-[hsl(var(--border))]" />
          <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px border-t border-dashed border-[hsl(var(--border))]" />
          <div className="pointer-events-none absolute inset-x-0 bottom-7 h-px border-t border-dashed border-[hsl(var(--border))]" />
          <div className="flex h-48 min-w-0 items-end gap-1.5 pb-7 pt-1">
            {data.map((d, index) => {
              const raw = Math.max(0, Number(d.value) || 0);
              const height = raw > 0 ? Math.max(10, (raw / max) * 100) : 2;
              const showLabel = index === 0 || index === data.length - 1 || index % labelStep === 0;
              return (
                <div key={`${d.label}-${index}`} className="group relative flex min-w-0 flex-1 flex-col items-center justify-end" title={`${d.label}: ${valueLabel(raw)}`}>
                  <div
                    className={`w-full max-w-10 rounded-t-md ${barClass[tone]} shadow-[0_10px_20px_-14px_currentColor] transition-all duration-200 group-hover:brightness-110`}
                    style={{ height: `${height}%`, opacity: raw > 0 ? 1 : 0.28 }}
                  />
                  {showLabel ? (
                    <span className="absolute -bottom-0 translate-y-full whitespace-nowrap text-[10px] text-[hsl(var(--fg))]/48">{d.label}</span>
                  ) : null}
                </div>
              );
            })}
          </div>
          {!hasData ? (
            <div className="absolute inset-x-4 top-1/2 -translate-y-1/2 rounded-xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1)/0.72)] px-3 py-2 text-center text-xs text-[hsl(var(--fg))]/58 [direction:rtl]">
              {emptyLabel}
            </div>
          ) : null}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px] text-[hsl(var(--fg))]/48">
        <span>{data[data.length - 1]?.label || ""}</span>
        <span>{rangeLabel || `Last ${fmtNumber(data.length)} days`}</span>
        <span>{data[0]?.label || ""}</span>
      </div>
    </div>
  );
}

function UsageBarChart({
  data,
  title,
  subtitle,
  valueLabel,
  tone = "blue",
  rangeLabel,
  emptyLabel = "No data has been recorded for this range yet.",
  totalLabel,
  totalValue,
  trendLabel,
}: {
  data: Array<{ label: string; value: number }>;
  title: string;
  subtitle?: string;
  valueLabel: (value: number) => string;
  tone?: TileTone;
  rangeLabel?: string;
  emptyLabel?: string;
  totalLabel: string;
  totalValue?: number;
  trendLabel?: string;
}) {
  const values = data.map((point) => Math.max(0, Number(point.value) || 0));
  const max = Math.max(1, ...values);
  const total = totalValue ?? values.reduce((acc, value) => acc + value, 0);
  const first = values.find((value) => value > 0) || 0;
  const last = [...values].reverse().find((value) => value > 0) || 0;
  const trend = first > 0 ? Math.round(((last - first) / first) * 100) : last > 0 ? 100 : 0;
  const hasData = values.some((value) => value > 0);
  const tickValues = [max, max * 0.75, max * 0.5, max * 0.25, 0];
  const labelStep = Math.max(1, Math.ceil(data.length / 6));
  const gradientId = React.useId().replace(/:/g, "");
  const toneGradient: Record<TileTone, [string, string, string]> = {
    blue: ["#60a5fa", "#2563eb", "#1d4ed8"],
    green: ["#34d399", "#10b981", "#059669"],
    orange: ["#fbbf24", "#f97316", "#ea580c"],
    rose: ["#fb7185", "#f43f5e", "#e11d48"],
    cyan: ["#38bdf8", "#3b82f6", "#315f9c"],
    violet: ["#a78bfa", "#8b5cf6", "#7c3aed"],
    slate: ["#94a3b8", "#64748b", "#475569"],
  };
  const trendClass = trend < 0 ? "text-rose-600 dark:text-rose-300" : trend > 0 ? "text-emerald-600 dark:text-emerald-300" : "text-[hsl(var(--fg))]/58";
  const width = 680;
  const height = 238;
  const pad = { top: 16, right: 12, bottom: 34, left: 58 };
  const chartWidth = width - pad.left - pad.right;
  const chartHeight = height - pad.top - pad.bottom;
  const count = Math.max(1, data.length);
  const step = chartWidth / count;
  const barWidth = Math.max(6, Math.min(38, step * 0.56));
  const gradient = toneGradient[tone];

  return (
    <div className="min-w-0 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1)/0.86)] p-3 shadow-[0_14px_28px_-26px_hsl(var(--fg)/0.5)] sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold">{title}</div>
          {subtitle ? <div className="mt-1 text-xs leading-5 text-[hsl(var(--fg))]/58">{subtitle}</div> : null}
        </div>
        {rangeLabel ? (
          <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-2)/0.86)] px-3 py-1.5 text-xs font-semibold text-[hsl(var(--fg))]/72">
            {rangeLabel}
          </div>
        ) : null}
      </div>

      <div className="relative mt-4 min-w-0 overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(180deg,hsl(var(--surface-card-2)/0.58),hsl(var(--surface-card-1)/0.72))] px-1.5 py-2 sm:mt-5 sm:px-2">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-[210px] w-full [direction:ltr] sm:h-[238px]" role="img" aria-label={title}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={gradient[0]} />
              <stop offset="52%" stopColor={gradient[1]} />
              <stop offset="100%" stopColor={gradient[2]} />
            </linearGradient>
          </defs>
          {tickValues.map((tick, index) => {
            const y = pad.top + (index / (tickValues.length - 1)) * chartHeight;
            return (
              <g key={`${tick}-${index}`}>
                <line x1={pad.left} y1={y} x2={width - pad.right} y2={y} stroke="currentColor" strokeOpacity="0.12" strokeDasharray="5 6" />
                <text x={pad.left - 10} y={y + 4} textAnchor="end" className="fill-current text-[11px] text-[hsl(var(--fg))]/50">
                  {valueLabel(tick)}
                </text>
              </g>
            );
          })}
          {data.map((point, index) => {
            const raw = Math.max(0, Number(point.value) || 0);
            const barHeight = raw > 0 ? Math.max(4, (raw / max) * chartHeight) : 0;
            const x = pad.left + index * step + (step - barWidth) / 2;
            const y = pad.top + chartHeight - barHeight;
            const showLabel = index === 0 || index === data.length - 1 || index % labelStep === 0;
            return (
              <g key={`${point.label}-${index}`}>
                {raw > 0 ? (
                  <rect
                    x={x}
                    y={y}
                    width={barWidth}
                    height={barHeight}
                    rx={Math.min(8, barWidth / 2)}
                    fill={`url(#${gradientId})`}
                    opacity="0.96"
                  />
                ) : null}
                {showLabel ? (
                  <text x={x + barWidth / 2} y={height - 14} textAnchor="middle" className="fill-current text-[10px] text-[hsl(var(--fg))]/48">
                    {point.label}
                  </text>
                ) : null}
                <title>{`${point.label} | ${valueLabel(raw)}`}</title>
              </g>
            );
          })}
          <line x1={pad.left} y1={pad.top + chartHeight} x2={width - pad.right} y2={pad.top + chartHeight} stroke="currentColor" strokeOpacity="0.14" />
        </svg>
          {!hasData ? (
            <div className="absolute inset-x-5 top-1/2 -translate-y-1/2 rounded-xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1)/0.92)] px-3 py-2 text-center text-xs text-[hsl(var(--fg))]/58">
              {emptyLabel}
            </div>
          ) : null}
      </div>

      <div className="mt-4 grid gap-2 border-t border-[hsl(var(--border))] pt-3 text-xs text-[hsl(var(--fg))]/64 sm:grid-cols-2">
        <div className={trendClass}>
          {trendLabel || "Trend"}: {trend > 0 ? "+" : ""}{fmtNumber(trend)}%
        </div>
        <div className="sm:text-right">
          {totalLabel}: {valueLabel(total)}
        </div>
      </div>
    </div>
  );
}

function UsageGauge({
  percent,
  usedGb,
  soldGb,
  remainingGb,
  copy = dashboardCopy("fa"),
}: {
  percent: number;
  usedGb: number;
  soldGb: number;
  remainingGb: number;
  copy?: ReturnType<typeof dashboardCopy>;
}) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (circumference * pct(percent)) / 100;

  return (
    <div className="grid gap-4 sm:grid-cols-[150px,1fr] sm:items-center">
      <div className="relative mx-auto grid h-36 w-36 place-items-center rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(145deg,hsl(var(--surface-card-1)),hsl(var(--surface-card-3)))]">
        <svg viewBox="0 0 110 110" className="h-28 w-28 -rotate-90">
          <circle cx="55" cy="55" r={radius} fill="none" stroke="hsl(var(--border))" strokeWidth="10" />
          <circle
            cx="55"
            cy="55"
            r={radius}
            fill="none"
            stroke="hsl(var(--accent))"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            strokeWidth="10"
          />
        </svg>
        <div className="pointer-events-none absolute text-center">
          <div className="text-2xl font-bold">{fmtNumber(pct(percent))}%</div>
          <div className="text-[10px] text-[hsl(var(--fg))]/55">{copy.usageLabel}</div>
        </div>
      </div>
      <div className="space-y-2">
        <TrafficRow label={copy.soldShort} value={`${fmtGig(soldGb)} ${copy.gbUnit}`} color="bg-emerald-500" />
        <TrafficRow label={copy.usedShort} value={`${fmtGig(usedGb)} ${copy.gbUnit}`} color="bg-blue-500" />
        <TrafficRow label={copy.remainingShort} value={`${fmtGig(remainingGb)} ${copy.gbUnit}`} color="bg-amber-500" />
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-[hsl(var(--muted))]">
          <div className="h-full rounded-full bg-[linear-gradient(90deg,#2563eb,#06b6d4)]" style={{ width: `${pct(percent)}%` }} />
        </div>
      </div>
    </div>
  );
}

function TrafficRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1)/0.72)] px-3 py-2 text-sm">
      <span className="flex min-w-0 items-center gap-2 text-[hsl(var(--fg))]/68">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${color}`} />
        <span className="truncate">{label}</span>
      </span>
      <span className="shrink-0 font-semibold">{value}</span>
    </div>
  );
}

function UserStatusOverview({
  total,
  active,
  disabled,
  expired,
  limited,
  onHold,
  deleted,
  copy,
}: {
  total: number;
  active: number;
  disabled: number;
  expired: number;
  limited: number;
  onHold: number;
  deleted: number;
  copy?: ReturnType<typeof dashboardCopy>["userStatus"];
}) {
  const labels = copy || dashboardCopy("fa").userStatus;
  const rows = [
    { label: labels.active, value: active, color: "bg-emerald-500", Icon: CheckCircle2 },
    { label: labels.expired, value: expired, color: "bg-orange-500", Icon: Clock3 },
    { label: labels.limited, value: limited, color: "bg-red-500", Icon: AlertTriangle },
    { label: labels.onHold, value: onHold, color: "bg-violet-500", Icon: Clock3 },
    { label: labels.disabled, value: disabled, color: "bg-slate-500", Icon: ShieldAlert },
    { label: labels.deleted, value: deleted, color: "bg-zinc-400", Icon: Database },
  ];

  return (
    <div className="space-y-2">
      <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1)/0.78)] px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <UsersRound size={18} className="text-[hsl(var(--fg))]/62" />
            <span className="truncate text-sm font-semibold">{labels.total}</span>
          </div>
          <span className="shrink-0 text-xl font-bold">{fmtNumber(total)}</span>
        </div>
      </div>

      {rows.map(({ label, value, color, Icon }) => {
        const percent = total > 0 ? pct((value / total) * 100) : 0;
        return (
          <div key={label} className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1)/0.72)] px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${color}`} />
                <Icon size={16} className="shrink-0 text-[hsl(var(--fg))]/55" />
                <span className="truncate text-sm">{label}</span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="rounded-full bg-[hsl(var(--muted))] px-2 py-0.5 text-xs text-[hsl(var(--fg))]/62">{fmtNumber(percent)}%</span>
                <span className="min-w-8 text-left text-sm font-bold">{fmtNumber(value)}</span>
              </div>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[hsl(var(--muted))]">
              <div className={`h-full rounded-full ${color}`} style={{ width: `${percent}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function NodeHealthList({
  nodes,
  showSync = true,
  copy = dashboardCopy("fa"),
  lang = "fa",
}: {
  nodes: NodeLite[];
  showSync?: boolean;
  copy?: ReturnType<typeof dashboardCopy>;
  lang?: string;
}) {
  const sorted = [...nodes].sort((a, b) => Number(b.is_enabled !== false) - Number(a.is_enabled !== false));

  return (
    <div className="space-y-2">
      {sorted.slice(0, 8).map((node) => {
        const enabled = node.is_enabled !== false;
        const visible = node.is_visible_in_sub !== false;
        return (
          <div
            key={node.id}
            className="grid gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1)/0.78)] px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
          >
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="truncate text-sm font-semibold">{node.name}</span>
                <Badge variant={panelVariant(node.panel_type)}>{panelLabel(node.panel_type, lang)}</Badge>
                {node.default_for_reseller ? <Badge variant="success">{copy.nodeDefault}</Badge> : null}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[hsl(var(--fg))]/56">
                <span>#{node.id}</span>
                {showSync ? <span>{copy.lastSync}: {formatSync(node.last_sync_at, lang)}</span> : null}
                {node.price_per_gb_override != null ? <span>{copy.customPrice}: {fmtNumber(node.price_per_gb_override)}</span> : null}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
              <Badge variant={enabled ? "success" : "danger"}>{enabled ? copy.enabled : copy.off}</Badge>
              <Badge variant={visible ? "default" : "muted"}>{visible ? copy.visibleInSub : copy.hidden}</Badge>
            </div>
          </div>
        );
      })}
      {nodes.length === 0 ? <div className="rounded-xl border border-dashed border-[hsl(var(--border))] p-4 text-sm text-[hsl(var(--fg))]/62">{copy.noNodes}</div> : null}
    </div>
  );
}

function OperationsPanel({
  orders,
  isAdmin,
  copy = dashboardCopy("fa"),
  lang = "fa",
}: {
  orders: OrderRow[];
  isAdmin: boolean;
  copy?: ReturnType<typeof dashboardCopy>;
  lang?: string;
}) {
  const pending = orders.filter((x) => (x.status || "").toLowerCase() === "pending");
  const failed = orders.filter((x) => {
    const s = (x.status || "").toLowerCase();
    return s === "failed" || s === "rolled_back";
  });
  const issues = [...pending, ...failed].slice(0, 5);

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-300">
            <Clock3 size={16} />
            {copy.pendingOperations}
          </div>
          <div className="mt-2 text-2xl font-bold">{fmtNumber(pending.length)}</div>
          <div className="mt-1 text-xs text-[hsl(var(--fg))]/60">{copy.ordersSample(fmtNumber(orders.length))}</div>
        </div>
        <div className="rounded-xl border border-red-400/30 bg-red-500/10 p-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-red-700 dark:text-red-300">
            <ShieldAlert size={16} />
            {copy.failedOrRolledBack}
          </div>
          <div className="mt-2 text-2xl font-bold">{fmtNumber(failed.length)}</div>
          <div className="mt-1 text-xs text-[hsl(var(--fg))]/60">{copy.remoteErrorHint}</div>
        </div>
      </div>

      <div className="space-y-2">
        {issues.map((order) => {
          const status = orderStatusMeta(order.status, lang);
          return (
            <div key={order.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1)/0.72)] px-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="font-medium">#{order.id} - {orderTypeLabel(order.type, lang)}</div>
                <div className="text-xs text-[hsl(var(--fg))]/58">
                  {order.created_at ? formatSync(order.created_at, lang) : copy.noTime} {isAdmin ? `- reseller #${order.reseller_id}` : ""}
                </div>
              </div>
              <Badge variant={status.variant}>{status.label}</Badge>
            </div>
          );
        })}
        {issues.length === 0 ? (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-3 text-sm text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 size={16} />
            {copy.noIssues}
          </div>
        ) : null}
      </div>

      <Link href={isAdmin ? "/app/admin/reports/orders" : "/app/users"}>
        <Button type="button" variant="outline" className="w-full gap-2">
          {isAdmin ? copy.viewOrders : copy.manageUsers}
          <ArrowUpRight size={15} />
        </Button>
      </Link>
    </div>
  );
}

function RecentUsersPanel({ users, copy = dashboardCopy("fa") }: { users: UserLite[]; copy?: ReturnType<typeof dashboardCopy> }) {
  return (
    <div className="space-y-2">
      {users.map((u) => (
        <Link key={u.id} href={`/app/users/${u.id}`} className="block">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1)/0.72)] px-3 py-2.5 transition-all duration-200 hover:-translate-y-0.5 hover:border-[hsl(var(--accent)/0.35)]">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{u.label}</div>
              <div className="text-xs text-[hsl(var(--fg))]/58">#{u.id}</div>
            </div>
            <Badge variant={u.status === "active" ? "success" : u.status === "disabled" ? "muted" : "default"}>{u.status}</Badge>
          </div>
        </Link>
      ))}
      {users.length === 0 ? <div className="rounded-xl border border-dashed border-[hsl(var(--border))] p-4 text-sm text-[hsl(var(--fg))]/62">{copy.recentUsersEmpty}</div> : null}
    </div>
  );
}

export default function Dashboard() {
  const { me } = useAuth();
  const { t, lang } = useI18n();
  const d = React.useMemo(() => dashboardCopy(lang), [lang]);

  const [adminStats, setAdminStats] = React.useState<AdminStats | null>(null);
  const [resellerStats, setResellerStats] = React.useState<ResellerStats | null>(null);
  const [adminChartStats, setAdminChartStats] = React.useState<AdminStats | null>(null);
  const [resellerChartStats, setResellerChartStats] = React.useState<ResellerStats | null>(null);
  const [accountOptions, setAccountOptions] = React.useState<AccountOption[]>([]);
  const [chartRangeDays, setChartRangeDays] = React.useState(7);
  const [chartScope, setChartScope] = React.useState<string>("all");
  const [chartMetric, setChartMetric] = React.useState<ChartMetric>("used");
  const [chartLoading, setChartLoading] = React.useState(false);
  const [nodes, setNodes] = React.useState<NodeLite[]>([]);
  const [recentUsers, setRecentUsers] = React.useState<UserLite[]>([]);
  const [orders, setOrders] = React.useState<OrderRow[]>([]);
  const [ledger, setLedger] = React.useState<LedgerRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!me) return;
      setLoading(true);
      setErr(null);

      try {
        if (me.role === "admin") {
          const [statsRes, nodesRes, ordersRes, ledgerRes, accountsRes] = await Promise.all([
            apiFetch<AdminStats>("/api/v1/admin/stats?days=7"),
            safeApi(apiFetch<any>("/api/v1/admin/nodes?offset=0&limit=100"), { items: [] }),
            safeApi(apiFetch<any>(`/api/v1/admin/reports/orders?offset=0&limit=${REPORT_LIMIT}`), { items: [] }),
            safeApi(apiFetch<any>(`/api/v1/admin/reports/ledger?offset=0&limit=${REPORT_LIMIT}`), { items: [] }),
            safeApi(apiFetch<AccountList>("/api/v1/admin/resellers?offset=0&limit=1000"), { items: [], total: 0 }),
          ]);
          if (cancelled) return;
          setAdminStats(statsRes);
          setAdminChartStats(statsRes);
          setResellerStats(null);
          setResellerChartStats(null);
          setAccountOptions(
            (accountsRes.items || []).filter((a) => (a.status || "").toLowerCase() !== "deleted").sort((a, b) => {
              const ar = (a.role || "reseller") === "admin" ? 0 : 1;
              const br = (b.role || "reseller") === "admin" ? 0 : 1;
              return ar - br || a.username.localeCompare(b.username);
            })
          );
          setNodes(normalizeNodes(nodesRes));
          setOrders((ordersRes.items || []) as OrderRow[]);
          setLedger((ledgerRes.items || []) as LedgerRow[]);
          setRecentUsers([]);
        } else {
          const [statsRes, nodesRes, usersRes, ordersRes, ledgerRes] = await Promise.all([
            apiFetch<ResellerStats>("/api/v1/reseller/stats?days=7"),
            safeApi(apiFetch<any>("/api/v1/reseller/nodes"), { items: [] }),
            safeApi(apiFetch<any>("/api/v1/reseller/users?offset=0&limit=6"), { items: [] }),
            safeApi(apiFetch<any>(`/api/v1/reseller/reports/orders?offset=0&limit=${REPORT_LIMIT}`), { items: [] }),
            safeApi(apiFetch<any>(`/api/v1/reseller/reports/ledger?offset=0&limit=${REPORT_LIMIT}`), { items: [] }),
          ]);
          if (cancelled) return;
          setResellerStats(statsRes);
          setResellerChartStats(statsRes);
          setAdminStats(null);
          setAdminChartStats(null);
          setAccountOptions([]);
          setNodes(normalizeNodes(nodesRes));
          setRecentUsers((usersRes.items || []).slice(0, 6).map((u: any) => ({ id: u.id, label: u.label, status: u.status })));
          setOrders((ordersRes.items || []) as OrderRow[]);
          setLedger((ledgerRes.items || []) as LedgerRow[]);
        }
      } catch (e: any) {
        if (!cancelled) setErr(String(e?.message || e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [me]);

  React.useEffect(() => {
    const currentUser = me;
    if (!currentUser) return;
    const currentRole = currentUser.role;
    let cancelled = false;

    async function loadChartStats() {
      setChartLoading(true);
      try {
        if (currentRole === "admin") {
          const params = new URLSearchParams({ days: String(chartRangeDays) });
          if (chartScope !== "all") params.set("reseller_id", chartScope);
          const stats = await apiFetch<AdminStats>(`/api/v1/admin/stats?${params.toString()}`);
          if (!cancelled) setAdminChartStats(stats);
        } else {
          const stats = await apiFetch<ResellerStats>(`/api/v1/reseller/stats?days=${chartRangeDays}`);
          if (!cancelled) setResellerChartStats(stats);
        }
      } catch (e: any) {
        if (!cancelled) setErr(String(e?.message || e));
      } finally {
        if (!cancelled) setChartLoading(false);
      }
    }

    loadChartStats();
    return () => {
      cancelled = true;
    };
  }, [me, chartRangeDays, chartScope]);

  const scopedAdminStats = adminChartStats || adminStats;
  const scopedResellerStats = resellerChartStats || resellerStats;

  const traffic = React.useMemo(() => {
    const source =
      me?.role === "admin" && adminStats
        ? { sold: Number(adminStats.sold_gb_total || 0), usedBytes: Number(adminStats.used_bytes_total || 0) }
        : resellerStats
          ? { sold: Number(resellerStats.sold_gb_total || 0), usedBytes: Number(resellerStats.used_bytes_total || 0) }
          : { sold: 0, usedBytes: 0 };
    const used = bytesToGb(source.usedBytes);
    return {
      soldGb: source.sold,
      usedGb: used,
      remainingGb: Math.max(source.sold - used, 0),
      ratio: source.sold > 0 ? pct((used / source.sold) * 100) : 0,
    };
  }, [me?.role, adminStats, resellerStats]);

  const orderStats = React.useMemo(() => {
    const completedOrders = orders.filter((x) => (x.status || "").toLowerCase() === "completed");
    const completed = completedOrders.length;
    const pending = orders.filter((x) => (x.status || "").toLowerCase() === "pending").length;
    const failed = orders.filter((x) => {
      const s = (x.status || "").toLowerCase();
      return s === "failed" || s === "rolled_back";
    }).length;
    const gb = sum(completedOrders, (x) => Number(x.purchased_gb || 0));
    const estimatedRevenue = sum(completedOrders, (x) => Number(x.purchased_gb || 0) * Number(x.price_per_gb_snapshot || 0));
    return { completed, pending, failed, gb, estimatedRevenue };
  }, [orders]);

  const ledgerStats = React.useMemo(() => {
    const debit = sum(ledger, (x) => (Number(x.amount || 0) < 0 ? Math.abs(Number(x.amount || 0)) : 0));
    const credit = sum(ledger, (x) => (Number(x.amount || 0) > 0 ? Number(x.amount || 0) : 0));
    const net = sum(ledger, (x) => Number(x.amount || 0));
    return { debit, credit, net };
  }, [ledger]);

  const salesSeries = React.useMemo(() => {
    const fallback = buildLedgerDebitSeries(ledger, chartRangeDays, lang);
    const points = me?.role === "admin" ? scopedAdminStats?.daily_sales : scopedResellerStats?.daily_sales;
    return normalizeApiSeries(points, fallback, chartRangeDays, lang);
  }, [me?.role, scopedAdminStats?.daily_sales, scopedResellerStats?.daily_sales, ledger, chartRangeDays, lang]);

  const trafficSeries = React.useMemo(() => {
    const fallback = buildOrderGbSeries(orders, chartRangeDays, lang);
    const points = me?.role === "admin" ? scopedAdminStats?.daily_traffic_gb : scopedResellerStats?.daily_traffic_gb;
    return normalizeApiSeries(points, fallback, chartRangeDays, lang);
  }, [me?.role, scopedAdminStats?.daily_traffic_gb, scopedResellerStats?.daily_traffic_gb, orders, chartRangeDays, lang]);

  const usedSeries = React.useMemo(() => {
    const points = me?.role === "admin" ? scopedAdminStats?.daily_used_gb : scopedResellerStats?.daily_used_gb;
    return normalizeApiSeries(points, chartDays(chartRangeDays, lang).map((d) => ({ ...d, value: 0 })), chartRangeDays, lang);
  }, [me?.role, scopedAdminStats?.daily_used_gb, scopedResellerStats?.daily_used_gb, chartRangeDays, lang]);

  const visibleTrafficSeries = React.useMemo(() => compactSeries(trafficSeries, chartRangeDays > 90 ? 54 : 42), [trafficSeries, chartRangeDays]);
  const visibleUsedSeries = React.useMemo(() => compactSeries(usedSeries, chartRangeDays > 90 ? 54 : 42), [usedSeries, chartRangeDays]);
  const chartPeriodTraffic = React.useMemo(() => {
    const soldGb = sum(trafficSeries, (point) => Number(point.value || 0));
    const usedGb = [...usedSeries].reverse().find((point) => Number(point.value || 0) > 0)?.value || 0;
    return {
      soldGb,
      usedGb,
      remainingGb: Math.max(soldGb - Number(usedGb || 0), 0),
      ratio: soldGb > 0 ? pct((Number(usedGb || 0) / soldGb) * 100) : 0,
    };
  }, [trafficSeries, usedSeries]);
  const activeChartSeries = chartMetric === "sold" ? visibleTrafficSeries : visibleUsedSeries;
  const activeChartTitle = chartMetric === "sold" ? d.soldMetric : d.usedMetric;
  const activeChartSubtitle = chartMetric === "sold" ? d.soldHint : d.usedHint;
  const activeChartTone: TileTone = chartMetric === "sold" ? "cyan" : "green";
  const activeChartTotalLabel = chartMetric === "sold" ? d.totalSold : d.totalUsed;
  const activeChartTotalValue = chartMetric === "sold" ? chartPeriodTraffic.soldGb : chartPeriodTraffic.usedGb;

  const userSummary = React.useMemo(() => {
    if (me?.role === "admin" && scopedAdminStats) {
      return {
        total: Number(scopedAdminStats.users_total || 0),
        active: Number(scopedAdminStats.users_active || 0),
        disabled: Number(scopedAdminStats.users_disabled || 0),
        expired: Number(scopedAdminStats.users_expired || 0),
        limited: Number(scopedAdminStats.users_limited || 0),
        onHold: Number(scopedAdminStats.users_on_hold || 0),
        deleted: Number(scopedAdminStats.users_deleted || 0),
      };
    }
    if (scopedResellerStats) {
      return {
        total: Number(scopedResellerStats.users_total || 0),
        active: Number(scopedResellerStats.users_active || 0),
        disabled: Number(scopedResellerStats.users_disabled || 0),
        expired: Number(scopedResellerStats.users_expired || 0),
        limited: Number(scopedResellerStats.users_limited || 0),
        onHold: Number(scopedResellerStats.users_on_hold || 0),
        deleted: Number(scopedResellerStats.users_deleted || 0),
      };
    }
    return { total: 0, active: 0, disabled: 0, expired: 0, limited: 0, onHold: 0, deleted: 0 };
  }, [me?.role, scopedAdminStats, scopedResellerStats]);

  const nodeStats = React.useMemo(() => {
    const enabled = nodes.filter((n) => n.is_enabled !== false).length;
    const visible = nodes.filter((n) => n.is_visible_in_sub !== false).length;
    const stale = nodes.filter((n) => !n.last_sync_at).length;
    const panels = new Set(nodes.map((n) => n.panel_type).filter(Boolean)).size;
    return { enabled, visible, stale, panels };
  }, [nodes]);

  const lowBalanceWarn =
    me && me.role !== "admin" && resellerStats
      ? (() => {
          const balance = Number(resellerStats.balance || 0);
          const priceCandidates = [Number(resellerStats.bundle_price_per_gb || 0), Number(resellerStats.price_per_gb || 0)].filter((x) => x > 0);
          const bestGbPrice = priceCandidates.length ? Math.min(...priceCandidates) : null;
          const affordableGb = bestGbPrice ? balance / bestGbPrice : null;
          const lowByCash = balance <= 300_000;
          const lowByTraffic = affordableGb != null && affordableGb < 100;
          if (!lowByCash && !lowByTraffic) return null;
          return { balance, affordableGb };
        })()
      : null;

  function exportCsv() {
    const rows: Array<Record<string, unknown>> = [
      { section: "traffic", label: "sold_gb", value: traffic.soldGb, meta: "" },
      { section: "traffic", label: "used_gb", value: traffic.usedGb.toFixed(2), meta: "" },
      { section: "traffic", label: "remaining_gb", value: traffic.remainingGb.toFixed(2), meta: "" },
      { section: "traffic", label: "usage_percent", value: traffic.ratio, meta: "" },
      { section: "users", label: "active", value: userSummary.active, meta: "" },
      { section: "users", label: "expired", value: userSummary.expired, meta: "" },
      { section: "users", label: "limited", value: userSummary.limited, meta: "" },
      { section: "users", label: "on_hold", value: userSummary.onHold, meta: "" },
      { section: "users", label: "disabled", value: userSummary.disabled, meta: "" },
      { section: "users", label: "deleted", value: userSummary.deleted, meta: "" },
      { section: "orders", label: "recent_completed", value: orderStats.completed, meta: "" },
      { section: "orders", label: "recent_pending", value: orderStats.pending, meta: "" },
      { section: "orders", label: "recent_failed", value: orderStats.failed, meta: "" },
      { section: "ledger", label: "recent_debit", value: ledgerStats.debit, meta: "" },
      { section: "ledger", label: "recent_credit", value: ledgerStats.credit, meta: "" },
      { section: "ledger", label: "recent_net", value: ledgerStats.net, meta: "" },
      ...salesSeries.map((point) => ({ section: "daily_sales", label: point.label, value: point.value, meta: "" })),
      ...trafficSeries.map((point) => ({ section: "daily_traffic_gb", label: point.label, value: point.value, meta: "" })),
      ...usedSeries.map((point) => ({ section: "daily_used_gb", label: point.label, value: point.value, meta: "" })),
      ...nodes.map((node) => ({
        section: "nodes",
        label: node.name,
        value: node.is_enabled !== false ? "enabled" : "disabled",
        meta: `${panelLabel(node.panel_type, lang)} | sync=${node.last_sync_at || ""}`,
      })),
    ];
    downloadCsv(`guardino-dashboard-${me?.role || "user"}-${dateKey(new Date())}.csv`, rows);
  }

  if (!me) return null;

  const isAdmin = me.role === "admin";
  const title = isAdmin ? d.adminTitle : d.resellerTitle;
  const subtitle = isAdmin ? d.adminSubtitle : d.resellerSubtitle;
  const selectedAccount = isAdmin && chartScope !== "all" ? accountOptions.find((account) => String(account.id) === String(chartScope)) : null;
  const chartScopeLabel = isAdmin
    ? selectedAccount
      ? `${accountRoleLabel(selectedAccount.role, lang)} - ${selectedAccount.username}`
      : d.allAccounts
    : d.myAccount;
  const chartRangeText = chartRangeLabel(chartRangeDays, lang);
  const chartContextText = `${d.account}: ${chartScopeLabel} • ${d.range}: ${chartRangeText}`;

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(112deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-2))_52%,hsl(var(--surface-card-3))_100%)] p-4 shadow-[0_16px_32px_-24px_hsl(var(--fg)/0.45)] sm:p-5">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.68fr)] xl:items-center">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1)/0.84)] px-3 py-1 text-xs text-[hsl(var(--fg))]/72">
              <Gauge size={13} />
              {d.heroBadge}
            </div>
            <h1 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[hsl(var(--fg))]/68">{subtitle}</p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Link href="/app/users/new">
                <Button className="gap-2">
                  {d.createUser}
                  <ArrowUpRight size={15} />
                </Button>
              </Link>
              <Link href="/app/users">
                <Button variant="outline">{d.users}</Button>
              </Link>
              <Link href={isAdmin ? "/app/admin/nodes" : "/app/nodes"}>
                <Button variant="outline">{d.nodes}</Button>
              </Link>
              <Button type="button" variant="outline" className="gap-2" onClick={exportCsv} disabled={loading}>
                <Download size={15} />
                {d.csv}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <KpiTile title={d.sold} value={`${fmtGig(traffic.soldGb)} GB`} icon={<Boxes size={16} />} tone="green" />
            <KpiTile title={d.used} value={`${fmtGig(traffic.usedGb)} GB`} icon={<Gauge size={16} />} tone="cyan" />
            <KpiTile title={d.remaining} value={`${fmtGig(traffic.remainingGb)} GB`} icon={<Database size={16} />} tone="orange" />
            <KpiTile title={d.usage} value={`${fmtNumber(traffic.ratio)}%`} icon={<BarChart3 size={16} />} tone="violet" />
          </div>
        </div>
      </section>

      {err ? (
        <div className="rounded-xl border border-red-400/35 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">{err}</div>
      ) : null}

      {loading ? (
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1)/0.74)] px-4 py-3 text-sm text-[hsl(var(--fg))]/65">
          {t("common.loading")}
        </div>
      ) : null}

      {!loading && !isAdmin && lowBalanceWarn ? (
        <div className="rounded-xl border border-amber-400/45 bg-[linear-gradient(140deg,rgba(251,191,36,0.18),rgba(245,158,11,0.07))] px-4 py-3 text-sm text-amber-900 shadow-[0_12px_28px_-24px_rgba(245,158,11,0.8)] dark:text-amber-100">
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle size={16} />
            {d.lowBalance}
          </div>
          <div className="mt-1 text-xs leading-5">
            {d.lowBalanceBody(
              fmtNumber(lowBalanceWarn.balance),
              lowBalanceWarn.affordableGb != null ? fmtNumber(Math.max(0, Math.floor(lowBalanceWarn.affordableGb))) : undefined
            )}
          </div>
        </div>
      ) : null}

      {!loading && isAdmin && adminStats ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiTile title={d.adminCards.resellers} value={fmtNumber(adminStats.resellers_total)} hint={`${fmtNumber(nodeStats.panels)} ${isEnglish(lang) ? "active panel types" : "نوع پنل فعال در سیستم"}`} icon={<UsersRound size={16} />} tone="blue" />
            <KpiTile title={d.adminCards.totalUsers} value={fmtNumber(adminStats.users_total)} hint={`${fmtNumber(orderStats.gb)} GB ${isEnglish(lang) ? "in recent orders" : "در سفارش‌های اخیر"}`} icon={<UsersRound size={16} />} tone="cyan" />
            <KpiTile title={d.adminCards.nodes} value={fmtNumber(adminStats.nodes_total)} hint={isEnglish(lang) ? `${fmtNumber(nodeStats.enabled)} enabled, ${fmtNumber(nodeStats.visible)} visible, ${fmtNumber(nodeStats.stale)} without sync` : `${fmtNumber(nodeStats.enabled)} فعال، ${fmtNumber(nodeStats.visible)} قابل نمایش، ${fmtNumber(nodeStats.stale)} بدون sync`} icon={<Network size={16} />} tone="green" />
            <KpiTile title={d.adminCards.orders} value={fmtNumber(adminStats.orders_total)} hint={`${fmtNumber(orderStats.pending)} pending، ${fmtNumber(orderStats.failed)} failed`} icon={<ShoppingCart size={16} />} tone="orange" />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiTile title={d.adminCards.ledger30} value={fmtNumber(adminStats.ledger_net_30d)} hint={isEnglish(lang) ? "+ credit, - usage from ledger" : "+ شارژ، - مصرف از دفترکل"} icon={<TrendingUp size={16} />} tone="green" />
            <KpiTile title={d.adminCards.recentTurnover} value={fmtNumber(ledgerStats.debit)} hint={isEnglish(lang) ? `Last ${fmtNumber(ledger.length)} transactions, order estimate: ${fmtNumber(orderStats.estimatedRevenue)}` : `آخرین ${fmtNumber(ledger.length)} تراکنش، برآورد سفارش: ${fmtNumber(orderStats.estimatedRevenue)}`} icon={<Coins size={16} />} tone="violet" />
            <KpiTile title={d.adminCards.avgPrice} value={adminStats.price_per_gb_avg == null ? d.adminCards.notSet : fmtNumber(adminStats.price_per_gb_avg)} icon={<Wallet size={16} />} tone="orange" />
            <KpiTile title={d.adminCards.ledgerEntries} value={fmtNumber(adminStats.ledger_entries_total)} hint={isEnglish(lang) ? `Recent credit: ${fmtNumber(ledgerStats.credit)}` : `شارژ اخیر: ${fmtNumber(ledgerStats.credit)}`} icon={<Database size={16} />} tone="blue" />
          </div>

          <div className="hidden">
            <SectionPanel title={d.analysisTitle} subtitle={d.analysisSubtitle} icon={<BarChart3 size={18} />}>
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold">{d.dailySales}</div>
                      <div className="text-xs text-[hsl(var(--fg))]/58">{d.selectedRangeOutput}</div>
                    </div>
                    <Badge variant="success">{fmtNumber(ledgerStats.debit)}</Badge>
                  </div>
                  <MiniBars data={salesSeries} valueLabel={(v) => fmtNumber(v)} tone="green" rangeLabel={chartRangeText} emptyLabel={d.noData} />
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold">{d.orderVolume}</div>
                      <div className="text-xs text-[hsl(var(--fg))]/58">{d.orderVolumeSubtitle}</div>
                    </div>
                    <Badge variant="default">{fmtGig(orderStats.gb)} GB</Badge>
                  </div>
                  <MiniBars data={trafficSeries} valueLabel={(v) => `${fmtGig(v)} GB`} tone="cyan" rangeLabel={chartRangeText} emptyLabel={d.noData} />
                </div>
              </div>
            </SectionPanel>

            <SectionPanel className="hidden" title={d.capacityTitle} subtitle={d.capacitySubtitle} icon={<Gauge size={18} />}>
              <UsageGauge percent={traffic.ratio} usedGb={traffic.usedGb} soldGb={traffic.soldGb} remainingGb={traffic.remainingGb} copy={d} />
            </SectionPanel>
          </div>

          <div className="hidden">
            <SectionPanel title={d.nodeHealthTitle} subtitle={d.nodeHealthSubtitle} icon={<Server size={18} />} action={<Link href="/app/admin/nodes"><Button type="button" variant="outline" size="sm">{d.manageNodes}</Button></Link>}>
              <NodeHealthList nodes={nodes} copy={d} lang={lang} />
            </SectionPanel>

            <SectionPanel title={d.operationsTitle} subtitle={d.operationsSubtitle} icon={<Activity size={18} />} action={<Badge variant={orderStats.failed ? "danger" : "success"}>{orderStats.failed ? d.needsReview : d.stable}</Badge>}>
              <OperationsPanel orders={orders} isAdmin copy={d} lang={lang} />
            </SectionPanel>
          </div>
        </>
      ) : null}

      {!loading && !isAdmin && resellerStats ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiTile title={d.resellerCards.balance} value={fmtNumber(resellerStats.balance)} hint={isEnglish(lang) ? `Account status: ${resellerStats.status}` : `وضعیت حساب: ${resellerStats.status}`} icon={<Wallet size={16} />} tone="green" />
            <KpiTile title={d.resellerCards.users} value={fmtNumber(resellerStats.users_total)} hint={isEnglish(lang) ? `Active: ${fmtNumber(resellerStats.users_active)}, disabled: ${fmtNumber(resellerStats.users_disabled)}` : `فعال: ${fmtNumber(resellerStats.users_active)}، غیرفعال: ${fmtNumber(resellerStats.users_disabled)}`} icon={<UsersRound size={16} />} tone="blue" />
            <KpiTile title={d.resellerCards.allowedNodes} value={fmtNumber(resellerStats.nodes_allowed)} hint={isEnglish(lang) ? `${fmtNumber(nodeStats.visible)} visible, ${fmtNumber(nodeStats.stale)} without sync` : `${fmtNumber(nodeStats.visible)} قابل نمایش، ${fmtNumber(nodeStats.stale)} بدون sync`} icon={<Network size={16} />} tone="cyan" />
            <KpiTile title={d.resellerCards.orders30} value={fmtNumber(resellerStats.orders_30d)} hint={isEnglish(lang) ? `Total orders: ${fmtNumber(resellerStats.orders_total)}` : `کل سفارش‌ها: ${fmtNumber(resellerStats.orders_total)}`} icon={<ShoppingCart size={16} />} tone="orange" />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiTile title={d.resellerCards.wallet30} value={fmtNumber(resellerStats.spent_30d)} hint={isEnglish(lang) ? `Recent turnover: ${fmtNumber(ledgerStats.debit)}, order estimate: ${fmtNumber(orderStats.estimatedRevenue)}` : `گردش اخیر: ${fmtNumber(ledgerStats.debit)}، برآورد سفارش: ${fmtNumber(orderStats.estimatedRevenue)}`} icon={<TrendingUp size={16} />} tone="rose" />
            <KpiTile title={d.resellerCards.priceGb} value={fmtNumber(resellerStats.price_per_gb)} hint="Per-Node" icon={<Coins size={16} />} tone="cyan" />
            <KpiTile title={d.resellerCards.bundleGb} value={fmtNumber(resellerStats.bundle_price_per_gb)} hint="Bundle" icon={<Boxes size={16} />} tone="violet" />
            <KpiTile title={d.resellerCards.priceDay} value={fmtNumber(resellerStats.price_per_day)} hint={isEnglish(lang) ? "Time renewal" : "تمدید زمانی"} icon={<Coins size={16} />} tone="orange" />
          </div>

          <div className="hidden">
            <SectionPanel title={d.mySalesTitle} subtitle={d.mySalesSubtitle} icon={<BarChart3 size={18} />}>
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold">{d.walletUsage}</div>
                      <div className="text-xs text-[hsl(var(--fg))]/58">{d.selectedRange}</div>
                    </div>
                    <Badge variant="danger">{fmtNumber(ledgerStats.debit)}</Badge>
                  </div>
                  <MiniBars data={salesSeries} valueLabel={(v) => fmtNumber(v)} tone="rose" rangeLabel={chartRangeText} emptyLabel={d.noData} />
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold">{d.orderVolume}</div>
                      <div className="text-xs text-[hsl(var(--fg))]/58">{d.orderVolumeSubtitle}</div>
                    </div>
                    <Badge variant="default">{fmtGig(orderStats.gb)} GB</Badge>
                  </div>
                  <MiniBars data={trafficSeries} valueLabel={(v) => `${fmtGig(v)} GB`} tone="cyan" rangeLabel={chartRangeText} emptyLabel={d.noData} />
                </div>
              </div>
            </SectionPanel>

            <SectionPanel className="hidden" title={d.myCapacityTitle} subtitle={d.myCapacitySubtitle} icon={<Gauge size={18} />}>
              <UsageGauge percent={traffic.ratio} usedGb={traffic.usedGb} soldGb={traffic.soldGb} remainingGb={traffic.remainingGb} copy={d} />
            </SectionPanel>
          </div>

          <div className="hidden">
            <SectionPanel title={d.assignedNodesTitle} subtitle={d.assignedNodesSubtitle} icon={<Server size={18} />} action={<Link href="/app/nodes"><Button type="button" variant="outline" size="sm">{d.viewNodes}</Button></Link>}>
              <NodeHealthList nodes={nodes} copy={d} lang={lang} />
            </SectionPanel>

            <SectionPanel title={d.recentUsersTitle} subtitle={d.recentUsersSubtitle} icon={<UsersRound size={18} />} action={<Link href="/app/users"><Button type="button" variant="outline" size="sm">{d.allUsers}</Button></Link>}>
              <RecentUsersPanel users={recentUsers} copy={d} />
            </SectionPanel>
          </div>

          <SectionPanel className="hidden" title={d.recentOperationsTitle} subtitle={d.recentOperationsSubtitle} icon={<Activity size={18} />}>
            <OperationsPanel orders={orders} isAdmin={false} copy={d} lang={lang} />
          </SectionPanel>
        </>
      ) : null}

      {!loading && !err && ((isAdmin && adminStats) || (!isAdmin && resellerStats)) ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(320px,0.82fr)_minmax(0,1.18fr)] xl:items-stretch">
          <SectionPanel
            className="h-full"
            title={isAdmin ? d.userOverviewTitleAdmin : d.userOverviewTitleReseller}
            subtitle={`${isAdmin ? d.userOverviewSubtitleAdmin : d.userOverviewSubtitleReseller} ${chartContextText}`}
            icon={<UsersRound size={18} />}
          >
            <UserStatusOverview
              total={userSummary.total}
              active={userSummary.active}
              disabled={userSummary.disabled}
              expired={userSummary.expired}
              limited={userSummary.limited}
              onHold={userSummary.onHold}
              deleted={userSummary.deleted}
              copy={d.userStatus}
            />
          </SectionPanel>

          <SectionPanel
            className="h-full"
            title={d.trafficTitle}
            subtitle={`${d.trafficSubtitle} ${chartContextText}`}
            icon={<BarChart3 size={18} />}
            action={<Badge variant={chartLoading ? "warning" : "default"}>{chartLoading ? d.updating : `${fmtNumber(chartPeriodTraffic.ratio)}%`}</Badge>}
          >
            <div className="space-y-4">
              <div className="grid gap-2 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                <label className="space-y-1">
                  <span className="text-xs text-[hsl(var(--fg))]/65">{d.range}</span>
                  <select
                    className="w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[hsl(var(--accent)/0.35)]"
                    value={chartRangeDays}
                    onChange={(e) => setChartRangeDays(Number(e.target.value))}
                  >
                    {CHART_RANGE_OPTIONS.map((option) => (
                      <option key={option.days} value={option.days}>
                        {localizeDigits(isEnglish(lang) ? option.en : option.fa)}
                      </option>
                    ))}
                  </select>
                </label>
                {isAdmin ? (
                  <label className="space-y-1">
                    <span className="text-xs text-[hsl(var(--fg))]/65">{d.account}</span>
                    <select
                      className="w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[hsl(var(--accent)/0.35)]"
                      value={chartScope}
                      onChange={(e) => setChartScope(e.target.value)}
                    >
                      <option value="all">{d.allAccounts}</option>
                      {accountOptions.map((account) => (
                        <option key={account.id} value={account.id}>
                          {accountRoleLabel(account.role, lang)} - {account.username}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <div className="space-y-1">
                    <span className="text-xs text-[hsl(var(--fg))]/65">{d.account}</span>
                    <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1)/0.76)] px-3 py-2 text-sm">{d.myAccount}</div>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-medium text-[hsl(var(--fg))]/65">{d.metric}</div>
                <div className="inline-flex rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-2)/0.75)] p-1">
                  {([
                    ["used", d.usedMetric],
                    ["sold", d.soldMetric],
                  ] as Array<[ChartMetric, string]>).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setChartMetric(value)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                        chartMetric === value
                          ? "bg-[hsl(var(--accent))] text-white shadow-[0_10px_24px_-18px_hsl(var(--accent))]"
                          : "text-[hsl(var(--fg))]/66 hover:text-[hsl(var(--fg))]"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <UsageBarChart
                data={activeChartSeries}
                title={activeChartTitle}
                subtitle={activeChartSubtitle}
                valueLabel={(v) => `${fmtGig(v)} GB`}
                tone={activeChartTone}
                rangeLabel={chartRangeText}
                emptyLabel={d.noData}
                totalLabel={activeChartTotalLabel}
                totalValue={activeChartTotalValue}
                trendLabel={d.trend}
              />

              <div className="grid gap-2 sm:grid-cols-3">
                <TrafficRow label={d.totalSold} value={`${fmtGig(chartPeriodTraffic.soldGb)} GB`} color="bg-emerald-500" />
                <TrafficRow label={d.totalUsed} value={`${fmtGig(chartPeriodTraffic.usedGb)} GB`} color="bg-blue-500" />
                <TrafficRow label={d.totalRemaining} value={`${fmtGig(chartPeriodTraffic.remainingGb)} GB`} color="bg-amber-500" />
              </div>
            </div>
          </SectionPanel>
        </div>
      ) : null}

      {!loading && !err && ((isAdmin && !adminStats) || (!isAdmin && !resellerStats)) ? (
        <div className="rounded-xl border border-dashed border-[hsl(var(--border))] p-4 text-sm text-[hsl(var(--fg))]/62">{t("common.empty")}</div>
      ) : null}
    </div>
  );
}
