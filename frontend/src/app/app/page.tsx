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
import { fmtNumber } from "@/lib/format";
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
  nodes_total: number;
  orders_total: number;
  ledger_entries_total: number;
  ledger_net_30d: number;
  price_per_gb_avg?: number | null;
  used_bytes_total: number;
  sold_gb_total: number;
  daily_sales?: DashboardSeriesPoint[];
  daily_traffic_gb?: DashboardSeriesPoint[];
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
  used_bytes_total: number;
  sold_gb_total: number;
  nodes_allowed: number;
  orders_total: number;
  orders_30d: number;
  spent_30d: number;
  daily_sales?: DashboardSeriesPoint[];
  daily_traffic_gb?: DashboardSeriesPoint[];
};

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

const REPORT_LIMIT = 200;
const CHART_DAYS = 14;

function bytesToGb(bytes: number) {
  return Number(bytes || 0) / (1024 * 1024 * 1024);
}

function fmtGig(value: number) {
  return new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 1 }).format(Number.isFinite(value) ? value : 0);
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

function panelLabel(panel?: string) {
  if (panel === "wg_dashboard") return "WireGuard";
  if (panel === "pasarguard") return "Pasarguard";
  if (panel === "marzban") return "Marzban";
  return panel || "نامشخص";
}

function panelVariant(panel?: string): BadgeVariant {
  if (panel === "wg_dashboard") return "success";
  if (panel === "pasarguard") return "warning";
  if (panel === "marzban") return "default";
  return "muted";
}

function orderStatusMeta(status: string): { label: string; variant: BadgeVariant } {
  const s = (status || "").toLowerCase();
  if (s === "completed") return { label: "تکمیل شده", variant: "success" };
  if (s === "pending") return { label: "در انتظار", variant: "warning" };
  if (s === "failed") return { label: "ناموفق", variant: "danger" };
  if (s === "rolled_back") return { label: "برگشتی", variant: "muted" };
  return { label: status || "نامشخص", variant: "muted" };
}

function orderTypeLabel(type: string) {
  const t = (type || "").toLowerCase();
  if (t === "create") return "ساخت کاربر";
  if (t === "add_traffic") return "افزایش حجم";
  if (t === "extend") return "تمدید";
  if (t === "change_nodes") return "تغییر نود";
  if (t === "refund") return "بازگشت وجه";
  if (t === "delete") return "حذف کاربر";
  return type || "نامشخص";
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function chartDays(days = CHART_DAYS) {
  const today = new Date();
  return Array.from({ length: days }, (_, index) => {
    const d = new Date(today);
    d.setHours(0, 0, 0, 0);
    d.setDate(today.getDate() - (days - 1 - index));
    return {
      key: dateKey(d),
      label: d.toLocaleDateString("fa-IR-u-ca-persian", { month: "short", day: "numeric" }),
    };
  });
}

function labelForDateKey(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  if (!year || !month || !day) return key;
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString("fa-IR-u-ca-persian", { month: "short", day: "numeric" });
}

function normalizeApiSeries(points: DashboardSeriesPoint[] | undefined, fallback: Array<{ label: string; value: number }>, days = CHART_DAYS) {
  if (!points?.length) return fallback;
  const base = chartDays(days);
  const values = new Map(base.map((d) => [d.key, 0]));
  for (const point of points) {
    const key = String(point.date || "").slice(0, 10);
    if (values.has(key)) values.set(key, Number(point.value || 0));
  }
  return base.map((d) => ({ ...d, label: labelForDateKey(d.key), value: values.get(d.key) || 0 }));
}

function buildLedgerDebitSeries(items: LedgerRow[], days = CHART_DAYS) {
  const base = chartDays(days);
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

function buildOrderGbSeries(items: OrderRow[], days = CHART_DAYS) {
  const base = chartDays(days);
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

function formatSync(value?: string | null) {
  if (!value) return "ثبت نشده";
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
}: {
  data: Array<{ label: string; value: number }>;
  valueLabel: (value: number) => string;
  tone?: TileTone;
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
              هنوز داده‌ای برای این بازه ثبت نشده است.
            </div>
          ) : null}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px] text-[hsl(var(--fg))]/48">
        <span>{data[data.length - 1]?.label || ""}</span>
        <span>۱۴ روز اخیر</span>
        <span>{data[0]?.label || ""}</span>
      </div>
    </div>
  );
}

function UsageGauge({ percent, usedGb, soldGb, remainingGb }: { percent: number; usedGb: number; soldGb: number; remainingGb: number }) {
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
          <div className="text-[10px] text-[hsl(var(--fg))]/55">مصرف</div>
        </div>
      </div>
      <div className="space-y-2">
        <TrafficRow label="فروخته شده" value={`${fmtGig(soldGb)} گیگ`} color="bg-emerald-500" />
        <TrafficRow label="مصرف شده" value={`${fmtGig(usedGb)} گیگ`} color="bg-blue-500" />
        <TrafficRow label="باقی مانده" value={`${fmtGig(remainingGb)} گیگ`} color="bg-amber-500" />
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
}: {
  total: number;
  active: number;
  disabled: number;
  expired: number;
  limited: number;
  onHold: number;
}) {
  const rows = [
    { label: "کاربران فعال", value: active, color: "bg-emerald-500", Icon: CheckCircle2 },
    { label: "منقضی شده", value: expired, color: "bg-orange-500", Icon: Clock3 },
    { label: "حجم تمام شده", value: limited, color: "bg-red-500", Icon: AlertTriangle },
    { label: "On Hold", value: onHold, color: "bg-violet-500", Icon: Clock3 },
    { label: "غیرفعال", value: disabled, color: "bg-slate-500", Icon: ShieldAlert },
  ];

  return (
    <div className="space-y-2">
      <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1)/0.78)] px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <UsersRound size={18} className="text-[hsl(var(--fg))]/62" />
            <span className="truncate text-sm font-semibold">کل کاربران</span>
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

function NodeHealthList({ nodes, showSync = true }: { nodes: NodeLite[]; showSync?: boolean }) {
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
                <Badge variant={panelVariant(node.panel_type)}>{panelLabel(node.panel_type)}</Badge>
                {node.default_for_reseller ? <Badge variant="success">پیش فرض</Badge> : null}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[hsl(var(--fg))]/56">
                <span>#{node.id}</span>
                {showSync ? <span>آخرین sync: {formatSync(node.last_sync_at)}</span> : null}
                {node.price_per_gb_override != null ? <span>قیمت اختصاصی: {fmtNumber(node.price_per_gb_override)}</span> : null}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
              <Badge variant={enabled ? "success" : "danger"}>{enabled ? "فعال" : "خاموش"}</Badge>
              <Badge variant={visible ? "default" : "muted"}>{visible ? "نمایش در ساب" : "مخفی"}</Badge>
            </div>
          </div>
        );
      })}
      {nodes.length === 0 ? <div className="rounded-xl border border-dashed border-[hsl(var(--border))] p-4 text-sm text-[hsl(var(--fg))]/62">نودی برای نمایش وجود ندارد.</div> : null}
    </div>
  );
}

function OperationsPanel({ orders, isAdmin }: { orders: OrderRow[]; isAdmin: boolean }) {
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
            عملیات در انتظار
          </div>
          <div className="mt-2 text-2xl font-bold">{fmtNumber(pending.length)}</div>
          <div className="mt-1 text-xs text-[hsl(var(--fg))]/60">از آخرین {fmtNumber(orders.length)} سفارش دریافت شده</div>
        </div>
        <div className="rounded-xl border border-red-400/30 bg-red-500/10 p-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-red-700 dark:text-red-300">
            <ShieldAlert size={16} />
            خطا / برگشتی
          </div>
          <div className="mt-2 text-2xl font-bold">{fmtNumber(failed.length)}</div>
          <div className="mt-1 text-xs text-[hsl(var(--fg))]/60">برای خطاهای remote panel از گزارش سفارش‌ها شروع کن.</div>
        </div>
      </div>

      <div className="space-y-2">
        {issues.map((order) => {
          const status = orderStatusMeta(order.status);
          return (
            <div key={order.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1)/0.72)] px-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="font-medium">#{order.id} - {orderTypeLabel(order.type)}</div>
                <div className="text-xs text-[hsl(var(--fg))]/58">
                  {order.created_at ? formatJalaliDateTime(order.created_at) : "بدون زمان"} {isAdmin ? `- reseller #${order.reseller_id}` : ""}
                </div>
              </div>
              <Badge variant={status.variant}>{status.label}</Badge>
            </div>
          );
        })}
        {issues.length === 0 ? (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-3 text-sm text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 size={16} />
            مورد pending یا failed در داده‌های اخیر دیده نشد.
          </div>
        ) : null}
      </div>

      <Link href={isAdmin ? "/app/admin/reports/orders" : "/app/users"}>
        <Button type="button" variant="outline" className="w-full gap-2">
          {isAdmin ? "مشاهده گزارش سفارش‌ها" : "مدیریت کاربران"}
          <ArrowUpRight size={15} />
        </Button>
      </Link>
    </div>
  );
}

function RecentUsersPanel({ users }: { users: UserLite[] }) {
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
      {users.length === 0 ? <div className="rounded-xl border border-dashed border-[hsl(var(--border))] p-4 text-sm text-[hsl(var(--fg))]/62">کاربر جدیدی برای نمایش وجود ندارد.</div> : null}
    </div>
  );
}

export default function Dashboard() {
  const { me } = useAuth();
  const { t } = useI18n();

  const [adminStats, setAdminStats] = React.useState<AdminStats | null>(null);
  const [resellerStats, setResellerStats] = React.useState<ResellerStats | null>(null);
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
          const [statsRes, nodesRes, ordersRes, ledgerRes] = await Promise.all([
            apiFetch<AdminStats>("/api/v1/admin/stats"),
            safeApi(apiFetch<any>("/api/v1/admin/nodes?offset=0&limit=100"), { items: [] }),
            safeApi(apiFetch<any>(`/api/v1/admin/reports/orders?offset=0&limit=${REPORT_LIMIT}`), { items: [] }),
            safeApi(apiFetch<any>(`/api/v1/admin/reports/ledger?offset=0&limit=${REPORT_LIMIT}`), { items: [] }),
          ]);
          if (cancelled) return;
          setAdminStats(statsRes);
          setResellerStats(null);
          setNodes(normalizeNodes(nodesRes));
          setOrders((ordersRes.items || []) as OrderRow[]);
          setLedger((ledgerRes.items || []) as LedgerRow[]);
          setRecentUsers([]);
        } else {
          const [statsRes, nodesRes, usersRes, ordersRes, ledgerRes] = await Promise.all([
            apiFetch<ResellerStats>("/api/v1/reseller/stats"),
            safeApi(apiFetch<any>("/api/v1/reseller/nodes"), { items: [] }),
            safeApi(apiFetch<any>("/api/v1/reseller/users?offset=0&limit=6"), { items: [] }),
            safeApi(apiFetch<any>(`/api/v1/reseller/reports/orders?offset=0&limit=${REPORT_LIMIT}`), { items: [] }),
            safeApi(apiFetch<any>(`/api/v1/reseller/reports/ledger?offset=0&limit=${REPORT_LIMIT}`), { items: [] }),
          ]);
          if (cancelled) return;
          setResellerStats(statsRes);
          setAdminStats(null);
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
    const fallback = buildLedgerDebitSeries(ledger);
    const points = me?.role === "admin" ? adminStats?.daily_sales : resellerStats?.daily_sales;
    return normalizeApiSeries(points, fallback);
  }, [me?.role, adminStats?.daily_sales, resellerStats?.daily_sales, ledger]);

  const trafficSeries = React.useMemo(() => {
    const fallback = buildOrderGbSeries(orders);
    const points = me?.role === "admin" ? adminStats?.daily_traffic_gb : resellerStats?.daily_traffic_gb;
    return normalizeApiSeries(points, fallback);
  }, [me?.role, adminStats?.daily_traffic_gb, resellerStats?.daily_traffic_gb, orders]);

  const userSummary = React.useMemo(() => {
    if (me?.role === "admin" && adminStats) {
      return {
        total: Number(adminStats.users_total || 0),
        active: Number(adminStats.users_active || 0),
        disabled: Number(adminStats.users_disabled || 0),
        expired: Number(adminStats.users_expired || 0),
        limited: Number(adminStats.users_limited || 0),
        onHold: Number(adminStats.users_on_hold || 0),
      };
    }
    if (resellerStats) {
      return {
        total: Number(resellerStats.users_total || 0),
        active: Number(resellerStats.users_active || 0),
        disabled: Number(resellerStats.users_disabled || 0),
        expired: Number(resellerStats.users_expired || 0),
        limited: Number(resellerStats.users_limited || 0),
        onHold: Number(resellerStats.users_on_hold || 0),
      };
    }
    return { total: 0, active: 0, disabled: 0, expired: 0, limited: 0, onHold: 0 };
  }, [me?.role, adminStats, resellerStats]);

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
      { section: "orders", label: "recent_completed", value: orderStats.completed, meta: "" },
      { section: "orders", label: "recent_pending", value: orderStats.pending, meta: "" },
      { section: "orders", label: "recent_failed", value: orderStats.failed, meta: "" },
      { section: "ledger", label: "recent_debit", value: ledgerStats.debit, meta: "" },
      { section: "ledger", label: "recent_credit", value: ledgerStats.credit, meta: "" },
      { section: "ledger", label: "recent_net", value: ledgerStats.net, meta: "" },
      ...salesSeries.map((point) => ({ section: "daily_sales", label: point.label, value: point.value, meta: "" })),
      ...trafficSeries.map((point) => ({ section: "daily_traffic_gb", label: point.label, value: point.value, meta: "" })),
      ...nodes.map((node) => ({
        section: "nodes",
        label: node.name,
        value: node.is_enabled !== false ? "enabled" : "disabled",
        meta: `${panelLabel(node.panel_type)} | sync=${node.last_sync_at || ""}`,
      })),
    ];
    downloadCsv(`guardino-dashboard-${me?.role || "user"}-${dateKey(new Date())}.csv`, rows);
  }

  if (!me) return null;

  const isAdmin = me.role === "admin";
  const title = isAdmin ? "داشبورد سوپرادمین" : "داشبورد رسیلر";
  const subtitle = isAdmin
    ? "فروش، مصرف، سلامت نودها و عملیات ناموفق را در یک نمای مرتب کنترل کنید."
    : "وضعیت فروش، مصرف کاربران، موجودی و نودهای اختصاص داده شده را سریع‌تر ببینید.";

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(112deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-2))_52%,hsl(var(--surface-card-3))_100%)] p-4 shadow-[0_16px_32px_-24px_hsl(var(--fg)/0.45)] sm:p-5">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.68fr)] xl:items-center">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1)/0.84)] px-3 py-1 text-xs text-[hsl(var(--fg))]/72">
              <Gauge size={13} />
              Guardino Command Center
            </div>
            <h1 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[hsl(var(--fg))]/68">{subtitle}</p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Link href="/app/users/new">
                <Button className="gap-2">
                  ساخت کاربر
                  <ArrowUpRight size={15} />
                </Button>
              </Link>
              <Link href="/app/users">
                <Button variant="outline">کاربران</Button>
              </Link>
              <Link href={isAdmin ? "/app/admin/nodes" : "/app/nodes"}>
                <Button variant="outline">نودها</Button>
              </Link>
              <Button type="button" variant="outline" className="gap-2" onClick={exportCsv} disabled={loading}>
                <Download size={15} />
                خروجی CSV
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <KpiTile title="حجم فروخته شده" value={`${fmtGig(traffic.soldGb)} گیگ`} icon={<Boxes size={16} />} tone="green" />
            <KpiTile title="حجم مصرف شده" value={`${fmtGig(traffic.usedGb)} گیگ`} icon={<Gauge size={16} />} tone="cyan" />
            <KpiTile title="ظرفیت باقی مانده" value={`${fmtGig(traffic.remainingGb)} گیگ`} icon={<Database size={16} />} tone="orange" />
            <KpiTile title="مصرف کل" value={`${fmtNumber(traffic.ratio)}%`} icon={<BarChart3 size={16} />} tone="violet" />
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

      {!loading && !err && ((isAdmin && adminStats) || (!isAdmin && resellerStats)) ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(300px,0.82fr)_minmax(0,1.18fr)]">
          <SectionPanel
            title={isAdmin ? "نمای کاربران کل پنل" : "نمای کاربران من"}
            subtitle={isAdmin ? "تفکیک سریع کاربران فعال، منقضی، حجمی، On Hold و غیرفعال." : "وضعیت کاربران همین حساب، جدا از آمار مدیریتی سوپرادمین."}
            icon={<UsersRound size={18} />}
          >
            <UserStatusOverview
              total={userSummary.total}
              active={userSummary.active}
              disabled={userSummary.disabled}
              expired={userSummary.expired}
              limited={userSummary.limited}
              onHold={userSummary.onHold}
            />
          </SectionPanel>

          <SectionPanel
            title={isAdmin ? "حجم سفارش‌های تکمیل‌شده" : "حجم فروش من"}
            subtitle="نمودار ۱۴ روز اخیر از سفارش‌های تکمیل‌شده ساخته می‌شود؛ برای مصرف لحظه‌ای از کارت ظرفیت استفاده کن."
            icon={<BarChart3 size={18} />}
            action={<Badge variant="default">{fmtGig(orderStats.gb)} GB</Badge>}
          >
            <MiniBars data={trafficSeries} valueLabel={(v) => `${fmtGig(v)} GB`} tone="cyan" />
          </SectionPanel>
        </div>
      ) : null}

      {!loading && isAdmin && adminStats ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiTile title="رسیلرها" value={fmtNumber(adminStats.resellers_total)} hint={`${fmtNumber(nodeStats.panels)} نوع پنل فعال در سیستم`} icon={<UsersRound size={16} />} tone="blue" />
            <KpiTile title="کاربران کل" value={fmtNumber(adminStats.users_total)} hint={`${fmtNumber(orderStats.gb)} GB در سفارش‌های اخیر`} icon={<UsersRound size={16} />} tone="cyan" />
            <KpiTile title="نودها" value={fmtNumber(adminStats.nodes_total)} hint={`${fmtNumber(nodeStats.enabled)} فعال، ${fmtNumber(nodeStats.visible)} قابل نمایش، ${fmtNumber(nodeStats.stale)} بدون sync`} icon={<Network size={16} />} tone="green" />
            <KpiTile title="سفارش‌ها" value={fmtNumber(adminStats.orders_total)} hint={`${fmtNumber(orderStats.pending)} pending، ${fmtNumber(orderStats.failed)} failed در داده اخیر`} icon={<ShoppingCart size={16} />} tone="orange" />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiTile title="فروش/مصرف ۳۰ روز" value={fmtNumber(adminStats.ledger_net_30d)} hint="+ شارژ، - مصرف از دفترکل" icon={<TrendingUp size={16} />} tone="green" />
            <KpiTile title="گردش فروش اخیر" value={fmtNumber(ledgerStats.debit)} hint={`آخرین ${fmtNumber(ledger.length)} تراکنش، برآورد سفارش: ${fmtNumber(orderStats.estimatedRevenue)}`} icon={<Coins size={16} />} tone="violet" />
            <KpiTile title="میانگین قیمت/GB" value={adminStats.price_per_gb_avg == null ? "ثبت نشده" : fmtNumber(adminStats.price_per_gb_avg)} icon={<Wallet size={16} />} tone="orange" />
            <KpiTile title="تراکنش‌های دفتر کل" value={fmtNumber(adminStats.ledger_entries_total)} hint={`شارژ اخیر: ${fmtNumber(ledgerStats.credit)}`} icon={<Database size={16} />} tone="blue" />
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
            <SectionPanel title="تحلیل فروش و مصرف" subtitle="نمودارها از گزارش سفارش‌ها و دفترکل موجود ساخته می‌شوند." icon={<BarChart3 size={18} />}>
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold">فروش روزانه</div>
                      <div className="text-xs text-[hsl(var(--fg))]/58">خروجی ۱۴ روز اخیر از تراکنش‌های مصرف</div>
                    </div>
                    <Badge variant="success">{fmtNumber(ledgerStats.debit)}</Badge>
                  </div>
                  <MiniBars data={salesSeries} valueLabel={(v) => fmtNumber(v)} tone="green" />
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold">حجم سفارش‌ها</div>
                      <div className="text-xs text-[hsl(var(--fg))]/58">مجموع GB خریداری شده در سفارش‌های اخیر</div>
                    </div>
                    <Badge variant="default">{fmtGig(orderStats.gb)} GB</Badge>
                  </div>
                  <MiniBars data={trafficSeries} valueLabel={(v) => `${fmtGig(v)} GB`} tone="cyan" />
                </div>
              </div>
            </SectionPanel>

            <SectionPanel title="مصرف کل ظرفیت" subtitle="نسبت مصرف کاربران به حجم فروخته شده." icon={<Gauge size={18} />}>
              <UsageGauge percent={traffic.ratio} usedGb={traffic.usedGb} soldGb={traffic.soldGb} remainingGb={traffic.remainingGb} />
            </SectionPanel>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <SectionPanel title="سلامت نودها" subtitle="Badgeها وضعیت فعال بودن، نمایش در ساب و آخرین sync هر نود را نشان می‌دهند." icon={<Server size={18} />} action={<Link href="/app/admin/nodes"><Button type="button" variant="outline" size="sm">مدیریت نودها</Button></Link>}>
              <NodeHealthList nodes={nodes} />
            </SectionPanel>

            <SectionPanel title="عملیات و خطاها" subtitle="برای فروش حرفه‌ای، pending/failed باید سریع دیده شود." icon={<Activity size={18} />} action={<Badge variant={orderStats.failed ? "danger" : "success"}>{orderStats.failed ? "نیازمند بررسی" : "پایدار"}</Badge>}>
              <OperationsPanel orders={orders} isAdmin />
            </SectionPanel>
          </div>
        </>
      ) : null}

      {!loading && !isAdmin && resellerStats ? (
        <>
          {lowBalanceWarn ? (
            <div className="rounded-xl border border-amber-400/45 bg-[linear-gradient(140deg,rgba(251,191,36,0.18),rgba(245,158,11,0.07))] px-4 py-3 text-sm text-amber-900 dark:text-amber-100">
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle size={16} />
                هشدار موجودی پایین
              </div>
              <div className="mt-1 text-xs leading-5">
                موجودی شما {fmtNumber(lowBalanceWarn.balance)} تومان است.
                {lowBalanceWarn.affordableGb != null ? ` با قیمت فعلی تقریبا ${fmtNumber(Math.max(0, Math.floor(lowBalanceWarn.affordableGb)))} گیگ قابل خرید است.` : ""}
              </div>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiTile title="موجودی" value={fmtNumber(resellerStats.balance)} hint={`وضعیت حساب: ${resellerStats.status}`} icon={<Wallet size={16} />} tone="green" />
            <KpiTile title="کاربران" value={fmtNumber(resellerStats.users_total)} hint={`فعال: ${fmtNumber(resellerStats.users_active)}، غیرفعال: ${fmtNumber(resellerStats.users_disabled)}`} icon={<UsersRound size={16} />} tone="blue" />
            <KpiTile title="نودهای مجاز" value={fmtNumber(resellerStats.nodes_allowed)} hint={`${fmtNumber(nodeStats.visible)} قابل نمایش، ${fmtNumber(nodeStats.stale)} بدون sync`} icon={<Network size={16} />} tone="cyan" />
            <KpiTile title="سفارش ۳۰ روز" value={fmtNumber(resellerStats.orders_30d)} hint={`کل سفارش‌ها: ${fmtNumber(resellerStats.orders_total)}`} icon={<ShoppingCart size={16} />} tone="orange" />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiTile title="مصرف کیف پول ۳۰ روز" value={fmtNumber(resellerStats.spent_30d)} hint={`گردش اخیر: ${fmtNumber(ledgerStats.debit)}، برآورد سفارش: ${fmtNumber(orderStats.estimatedRevenue)}`} icon={<TrendingUp size={16} />} tone="rose" />
            <KpiTile title="قیمت/GB" value={fmtNumber(resellerStats.price_per_gb)} hint="مدل Per-Node" icon={<Coins size={16} />} tone="cyan" />
            <KpiTile title="باندل/GB" value={fmtNumber(resellerStats.bundle_price_per_gb)} hint="مدل Bundle" icon={<Boxes size={16} />} tone="violet" />
            <KpiTile title="قیمت/روز" value={fmtNumber(resellerStats.price_per_day)} hint="تمدید زمانی" icon={<Coins size={16} />} tone="orange" />
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
            <SectionPanel title="فروش و مصرف من" subtitle="نمودارها از سفارش‌ها و تراکنش‌های حساب شما ساخته می‌شوند." icon={<BarChart3 size={18} />}>
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold">مصرف کیف پول</div>
                      <div className="text-xs text-[hsl(var(--fg))]/58">۱۴ روز اخیر</div>
                    </div>
                    <Badge variant="danger">{fmtNumber(ledgerStats.debit)}</Badge>
                  </div>
                  <MiniBars data={salesSeries} valueLabel={(v) => fmtNumber(v)} tone="rose" />
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold">حجم سفارش‌ها</div>
                      <div className="text-xs text-[hsl(var(--fg))]/58">GB خریداری شده در سفارش‌های اخیر</div>
                    </div>
                    <Badge variant="default">{fmtGig(orderStats.gb)} GB</Badge>
                  </div>
                  <MiniBars data={trafficSeries} valueLabel={(v) => `${fmtGig(v)} GB`} tone="cyan" />
                </div>
              </div>
            </SectionPanel>

            <SectionPanel title="ظرفیت کاربران" subtitle="مصرف کل کاربران شما نسبت به حجم فروخته شده." icon={<Gauge size={18} />}>
              <UsageGauge percent={traffic.ratio} usedGb={traffic.usedGb} soldGb={traffic.soldGb} remainingGb={traffic.remainingGb} />
            </SectionPanel>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <SectionPanel title="نودهای اختصاص داده شده" subtitle="وضعیت نودها، پنل و آخرین sync مربوط به کاربران شما." icon={<Server size={18} />} action={<Link href="/app/nodes"><Button type="button" variant="outline" size="sm">مشاهده نودها</Button></Link>}>
              <NodeHealthList nodes={nodes} />
            </SectionPanel>

            <SectionPanel title="آخرین کاربران" subtitle="دسترسی سریع به کاربرهای تازه ساخته شده." icon={<UsersRound size={18} />} action={<Link href="/app/users"><Button type="button" variant="outline" size="sm">همه کاربران</Button></Link>}>
              <RecentUsersPanel users={recentUsers} />
            </SectionPanel>
          </div>

          <SectionPanel title="عملیات اخیر" subtitle="سفارش‌های در انتظار یا ناموفق برای جلوگیری از خطای فروش." icon={<Activity size={18} />}>
            <OperationsPanel orders={orders} isAdmin={false} />
          </SectionPanel>
        </>
      ) : null}

      {!loading && !err && ((isAdmin && !adminStats) || (!isAdmin && !resellerStats)) ? (
        <div className="rounded-xl border border-dashed border-[hsl(var(--border))] p-4 text-sm text-[hsl(var(--fg))]/62">{t("common.empty")}</div>
      ) : null}
    </div>
  );
}
