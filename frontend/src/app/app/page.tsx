"use client";

import * as React from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/components/auth-context";
import { useI18n } from "@/components/i18n-context";
import { fmtNumber } from "@/lib/format";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  Boxes,
  Coins,
  Database,
  Gauge,
  Network,
  ShoppingCart,
  UsersRound,
  Wallet,
} from "lucide-react";

type AdminStats = {
  resellers_total: number;
  users_total: number;
  nodes_total: number;
  orders_total: number;
  ledger_entries_total: number;
  ledger_net_30d: number;
  price_per_gb_avg?: number | null;
  used_bytes_total: number;
  sold_gb_total: number;
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
  used_bytes_total: number;
  sold_gb_total: number;
  nodes_allowed: number;
  orders_total: number;
  orders_30d: number;
  spent_30d: number;
};

type NodeLite = {
  id: number;
  name: string;
  panel_type?: string;
  is_enabled?: boolean;
  is_visible_in_sub?: boolean;
};
type UserLite = { id: number; label: string; status: string };

type Tone = "blue" | "green" | "orange" | "rose" | "cyan" | "violet";

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

function toneClasses(tone: Tone) {
  const map: Record<Tone, string> = {
    blue: "bg-[linear-gradient(145deg,rgba(59,130,246,0.14),rgba(14,165,233,0.08))]",
    green: "bg-[linear-gradient(145deg,rgba(16,185,129,0.14),rgba(5,150,105,0.08))]",
    orange: "bg-[linear-gradient(145deg,rgba(249,115,22,0.15),rgba(245,158,11,0.08))]",
    rose: "bg-[linear-gradient(145deg,rgba(244,63,94,0.14),rgba(251,113,133,0.08))]",
    cyan: "bg-[linear-gradient(145deg,rgba(6,182,212,0.14),rgba(14,165,233,0.08))]",
    violet: "bg-[linear-gradient(145deg,rgba(139,92,246,0.14),rgba(99,102,241,0.08))]",
  };
  return map[tone];
}

function StatCard({
  title,
  value,
  hint,
  icon,
  tone = "blue",
}: {
  title: string;
  value: string;
  hint?: string;
  icon?: React.ReactNode;
  tone?: Tone;
}) {
  return (
    <Card className="overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_16px_30px_-18px_hsl(var(--accent)/0.45)]">
      <CardHeader className={toneClasses(tone)}>
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-medium text-[hsl(var(--fg))]/70">{title}</div>
          {icon ? <span className="text-[hsl(var(--fg))]/65">{icon}</span> : null}
        </div>
        <div className="mt-1 text-2xl font-bold tracking-tight">{value}</div>
        {hint ? <div className="mt-1 text-xs text-[hsl(var(--fg))]/60">{hint}</div> : null}
      </CardHeader>
    </Card>
  );
}

export default function Dashboard() {
  const { me } = useAuth();
  const { t } = useI18n();

  const [adminStats, setAdminStats] = React.useState<AdminStats | null>(null);
  const [resellerStats, setResellerStats] = React.useState<ResellerStats | null>(null);

  const [nodes, setNodes] = React.useState<NodeLite[]>([]);
  const [recentUsers, setRecentUsers] = React.useState<UserLite[]>([]);
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
          const st = await apiFetch<AdminStats>("/api/v1/admin/stats");
          if (!cancelled) setAdminStats(st);

          const ns = await apiFetch<any>("/api/v1/admin/nodes?offset=0&limit=100");
          const arr = Array.isArray(ns) ? ns : ns?.items || [];
          if (!cancelled) {
            setNodes(
              arr.map((n: any) => ({
                id: n.id,
                name: n.name,
                panel_type: n.panel_type,
                is_enabled: n.is_enabled,
                is_visible_in_sub: n.is_visible_in_sub,
              }))
            );
          }

          setRecentUsers([]);
        } else {
          const st = await apiFetch<ResellerStats>("/api/v1/reseller/stats");
          if (!cancelled) setResellerStats(st);

          const ns = await apiFetch<any>("/api/v1/reseller/nodes");
          const arr = Array.isArray(ns) ? ns : ns?.items || [];
          if (!cancelled) {
            setNodes(
              arr.map((n: any) => ({
                id: n.id,
                name: n.name,
                panel_type: n.panel_type,
                is_visible_in_sub: n.is_visible_in_sub,
              }))
            );
          }

          const up = await apiFetch<any>("/api/v1/reseller/users?offset=0&limit=6");
          if (!cancelled) {
            setRecentUsers((up?.items || []).slice(0, 6).map((u: any) => ({ id: u.id, label: u.label, status: u.status })));
          }
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

  const traffic = React.useMemo(() => {
    if (me?.role === "admin" && adminStats) {
      const soldGb = Number(adminStats.sold_gb_total || 0);
      const usedGb = bytesToGb(Number(adminStats.used_bytes_total || 0));
      const ratio = soldGb > 0 ? (usedGb / soldGb) * 100 : 0;
      return {
        soldGb,
        usedGb,
        remainingGb: Math.max(soldGb - usedGb, 0),
        ratio: pct(ratio),
      };
    }
    if (me?.role !== "admin" && resellerStats) {
      const soldGb = Number(resellerStats.sold_gb_total || 0);
      const usedGb = bytesToGb(Number(resellerStats.used_bytes_total || 0));
      const ratio = soldGb > 0 ? (usedGb / soldGb) * 100 : 0;
      return {
        soldGb,
        usedGb,
        remainingGb: Math.max(soldGb - usedGb, 0),
        ratio: pct(ratio),
      };
    }
    return { soldGb: 0, usedGb: 0, remainingGb: 0, ratio: 0 };
  }, [me?.role, adminStats, resellerStats]);

  if (!me) return null;

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(115deg,hsl(var(--card))_0%,hsl(var(--muted))_100%)] p-4 shadow-[0_16px_30px_-20px_hsl(var(--fg)/0.35)] sm:p-6">
        <div className="grid gap-4 xl:grid-cols-[1.2fr,0.8fr] xl:items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-1 text-xs text-[hsl(var(--fg))]/75">
              <Gauge size={13} />
              {me.role === "admin" ? "نمای کلی پنل مدیریت" : "نمای کلی پنل فروش"}
            </div>
            <h1 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">{me.role === "admin" ? "داشبورد مدیریتی" : "داشبورد رسیلر"}</h1>
            <p className="mt-2 text-sm text-[hsl(var(--fg))]/70">
              {me.role === "admin"
                ? "وضعیت کاربران، سفارش‌ها، مصرف و سلامت زیرساخت را یک‌جا مدیریت کنید."
                : "نمای فروش، مصرف کاربران، ظرفیت باقی‌مانده و عملیات سریع مدیریت اکانت."}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Link href="/app/users/new">
                <Button className="gap-2">
                  ساخت کاربر
                  <ArrowUpRight size={15} />
                </Button>
              </Link>
              <Link href="/app/users">
                <Button variant="outline">مدیریت کاربران</Button>
              </Link>
              {me.role === "admin" ? (
                <Link href="/app/admin/nodes">
                  <Button variant="outline">مدیریت نودها</Button>
                </Link>
              ) : (
                <Link href="/app/nodes">
                  <Button variant="outline">نودهای من</Button>
                </Link>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(145deg,rgba(16,185,129,0.12),rgba(5,150,105,0.06))] p-3">
              <div className="text-xs text-[hsl(var(--fg))]/70">حجم فروخته‌شده</div>
              <div className="mt-1 text-lg font-bold">{fmtGig(traffic.soldGb)} گیگ</div>
            </div>
            <div className="rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(145deg,rgba(59,130,246,0.12),rgba(14,165,233,0.06))] p-3">
              <div className="text-xs text-[hsl(var(--fg))]/70">حجم مصرف‌شده</div>
              <div className="mt-1 text-lg font-bold">{fmtGig(traffic.usedGb)} گیگ</div>
            </div>
            <div className="rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(145deg,rgba(249,115,22,0.12),rgba(245,158,11,0.06))] p-3">
              <div className="text-xs text-[hsl(var(--fg))]/70">ظرفیت باقی‌مانده</div>
              <div className="mt-1 text-lg font-bold">{fmtGig(traffic.remainingGb)} گیگ</div>
            </div>
            <div className="rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(145deg,rgba(139,92,246,0.14),rgba(99,102,241,0.06))] p-3">
              <div className="text-xs text-[hsl(var(--fg))]/70">درصد مصرف کل</div>
              <div className="mt-1 text-lg font-bold">{fmtNumber(traffic.ratio)}٪</div>
            </div>
          </div>
        </div>
      </section>

      {err ? (
        <Card>
          <CardContent className="py-6 text-sm text-red-600 dark:text-red-300">{err}</CardContent>
        </Card>
      ) : null}

      {loading ? (
        <Card>
          <CardContent className="py-6 text-sm text-[hsl(var(--fg))]/70">{t("common.loading")}</CardContent>
        </Card>
      ) : null}

      {!loading && me.role === "admin" && adminStats ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard title="تعداد رسیلرها" value={fmtNumber(adminStats.resellers_total)} icon={<UsersRound size={16} />} tone="blue" />
            <StatCard title="تعداد کاربران" value={fmtNumber(adminStats.users_total)} icon={<UsersRound size={16} />} tone="cyan" />
            <StatCard title="تعداد نودها" value={fmtNumber(adminStats.nodes_total)} icon={<Network size={16} />} tone="green" />
            <StatCard title="تعداد سفارش‌ها" value={fmtNumber(adminStats.orders_total)} icon={<ShoppingCart size={16} />} tone="orange" />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard title="حجم فروخته‌شده کل" value={`${fmtGig(traffic.soldGb)} گیگ`} icon={<Boxes size={16} />} tone="violet" />
            <StatCard title="حجم مصرف‌شده کل" value={`${fmtGig(traffic.usedGb)} گیگ`} icon={<Gauge size={16} />} tone="rose" />
            <StatCard title="تراکنش‌های دفتر کل" value={fmtNumber(adminStats.ledger_entries_total)} icon={<Database size={16} />} tone="blue" />
            <StatCard title="خالص تراکنش ۳۰ روز" value={fmtNumber(adminStats.ledger_net_30d)} hint="(+ شارژ / - مصرف)" icon={<BarChart3 size={16} />} tone="green" />
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <StatCard
              title="میانگین قیمت/GB رسیلرها"
              value={adminStats.price_per_gb_avg == null ? "—" : fmtNumber(adminStats.price_per_gb_avg)}
              icon={<Coins size={16} />}
              tone="orange"
            />
            <StatCard title="درصد مصرف سراسری" value={`${fmtNumber(traffic.ratio)}٪`} hint="نسبت مصرف به حجم فروخته‌شده" icon={<Gauge size={16} />} tone="cyan" />
            <StatCard title="حجم باقی‌مانده سراسری" value={`${fmtGig(traffic.remainingGb)} گیگ`} icon={<Wallet size={16} />} tone="violet" />
          </div>

          <Card>
            <CardHeader>
              <div className="text-sm font-semibold">وضعیت نودها</div>
              <div className="text-xs text-[hsl(var(--fg))]/70">آخرین نودهای ثبت‌شده و وضعیت فعال‌سازی</div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {nodes.slice(0, 10).map((n) => (
                  <div key={n.id} className="flex items-center justify-between gap-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2.5 transition-all duration-200 hover:-translate-y-0.5 hover:border-[hsl(var(--accent)/0.35)]">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{n.name}</div>
                      <div className="text-xs text-[hsl(var(--fg))]/70">#{n.id} • {n.panel_type || "—"}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={n.is_enabled === false ? "danger" : "success"}>{n.is_enabled === false ? "disabled" : "enabled"}</Badge>
                      <Badge variant={n.is_visible_in_sub === false ? "muted" : "default"}>{n.is_visible_in_sub === false ? "hidden" : "visible"}</Badge>
                    </div>
                  </div>
                ))}
                {nodes.length === 0 ? <div className="text-sm text-[hsl(var(--fg))]/70">{t("common.empty")}</div> : null}
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}

      {!loading && me.role !== "admin" && resellerStats ? (
        <>
          {lowBalanceWarn ? (
            <Card>
              <CardContent className="py-4">
                <div className="rounded-xl border border-amber-400/45 bg-[linear-gradient(140deg,rgba(251,191,36,0.22),rgba(245,158,11,0.08))] px-4 py-3 text-sm text-amber-950 dark:text-amber-100">
                  <div className="flex items-center gap-2 font-semibold">
                    <AlertTriangle size={16} />
                    هشدار موجودی پایین
                  </div>
                  <div className="mt-1 text-xs">
                    موجودی شما {fmtNumber(lowBalanceWarn.balance)} تومان است.
                    {lowBalanceWarn.affordableGb != null ? ` با قیمت فعلی تقریباً ${Math.max(0, Math.floor(lowBalanceWarn.affordableGb))} گیگ قابل خرید است.` : ""}
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard title="موجودی" value={fmtNumber(resellerStats.balance)} icon={<Wallet size={16} />} tone="green" />
            <StatCard title="کل کاربران" value={fmtNumber(resellerStats.users_total)} hint={`فعال: ${fmtNumber(resellerStats.users_active)} • غیرفعال: ${fmtNumber(resellerStats.users_disabled)}`} icon={<UsersRound size={16} />} tone="blue" />
            <StatCard title="نودهای مجاز" value={fmtNumber(resellerStats.nodes_allowed)} icon={<Network size={16} />} tone="cyan" />
            <StatCard title="سفارش ۳۰ روز" value={fmtNumber(resellerStats.orders_30d)} icon={<ShoppingCart size={16} />} tone="orange" />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard title="حجم فروخته‌شده" value={`${fmtGig(traffic.soldGb)} گیگ`} icon={<Boxes size={16} />} tone="violet" />
            <StatCard title="حجم مصرف‌شده" value={`${fmtGig(traffic.usedGb)} گیگ`} icon={<Gauge size={16} />} tone="rose" />
            <StatCard title="ظرفیت باقی‌مانده" value={`${fmtGig(traffic.remainingGb)} گیگ`} icon={<Database size={16} />} tone="blue" />
            <StatCard title="درصد مصرف کاربران" value={`${fmtNumber(traffic.ratio)}٪`} icon={<BarChart3 size={16} />} tone="green" />
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <StatCard title="قیمت/GB" value={fmtNumber(resellerStats.price_per_gb)} hint="مدل Per-Node" icon={<Coins size={16} />} tone="cyan" />
            <StatCard title="باندل/GB" value={fmtNumber(resellerStats.bundle_price_per_gb)} hint="مدل Bundle" icon={<Boxes size={16} />} tone="violet" />
            <StatCard title="قیمت/روز" value={fmtNumber(resellerStats.price_per_day)} hint="تمدید زمانی" icon={<Coins size={16} />} tone="orange" />
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <div className="text-sm font-semibold">وضعیت نودهای شما</div>
                <div className="text-xs text-[hsl(var(--fg))]/70">نودهای تخصیص داده‌شده برای فروش</div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {nodes.slice(0, 8).map((n) => (
                    <div key={n.id} className="flex items-center justify-between gap-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2.5 transition-all duration-200 hover:-translate-y-0.5 hover:border-[hsl(var(--accent)/0.35)]">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{n.name}</div>
                        <div className="text-xs text-[hsl(var(--fg))]/70">#{n.id} • {n.panel_type || "—"}</div>
                      </div>
                      <Badge variant={n.is_visible_in_sub === false ? "muted" : "default"}>{n.is_visible_in_sub === false ? "hidden" : "visible"}</Badge>
                    </div>
                  ))}
                  {nodes.length === 0 ? <div className="text-sm text-[hsl(var(--fg))]/70">{t("common.empty")}</div> : null}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="text-sm font-semibold">آخرین کاربران</div>
                <div className="text-xs text-[hsl(var(--fg))]/70">آخرین ۶ کاربر ساخته‌شده</div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {recentUsers.map((u) => (
                    <Link key={u.id} href={`/app/users/${u.id}`} className="block">
                      <div className="flex items-center justify-between gap-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2.5 transition-all duration-200 hover:-translate-y-0.5 hover:border-[hsl(var(--accent)/0.35)] hover:bg-[linear-gradient(125deg,hsl(var(--accent)/0.08),hsl(var(--card)))]">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{u.label}</div>
                          <div className="text-xs text-[hsl(var(--fg))]/70">#{u.id}</div>
                        </div>
                        <Badge variant={u.status === "active" ? "success" : u.status === "disabled" ? "muted" : "default"}>{u.status}</Badge>
                      </div>
                    </Link>
                  ))}
                  {recentUsers.length === 0 ? <div className="text-sm text-[hsl(var(--fg))]/70">{t("common.empty")}</div> : null}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <StatCard title="مصرف کیف پول (۳۰ روز)" value={fmtNumber(resellerStats.spent_30d)} hint="جمع هزینه ثبت‌شده" icon={<BarChart3 size={16} />} tone="rose" />
            <StatCard title="کل سفارش‌ها" value={fmtNumber(resellerStats.orders_total)} icon={<ShoppingCart size={16} />} tone="blue" />
          </div>
        </>
      ) : null}
    </div>
  );
}
