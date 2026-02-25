"use client";

import * as React from "react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/components/auth-context";
import { useI18n } from "@/components/i18n-context";
import { fmtNumber } from "@/lib/format";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { AlertTriangle, BarChart3, Boxes, Coins, Database, Network, ShoppingCart, UsersRound, Wallet } from "lucide-react";

type AdminStats = {
  resellers_total: number;
  users_total: number;
  nodes_total: number;
  orders_total: number;
  ledger_entries_total: number;
  ledger_net_30d: number;
  price_per_gb_avg?: number | null;
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
  nodes_allowed: number;
  orders_total: number;
  orders_30d: number;
  spent_30d: number;
};

type NodeLite = { id: number; name: string; panel_type?: string; is_enabled?: boolean; is_visible_in_sub?: boolean };
type UserLite = { id: number; label: string; status: string };

function StatCard({ title, value, hint, icon }: { title: string; value: string; hint?: string; icon?: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs text-[hsl(var(--fg))]/70">{title}</div>
          {icon ? <span className="text-[hsl(var(--fg))]/55">{icon}</span> : null}
        </div>
        <div className="text-2xl font-semibold">{value}</div>
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
          if (!cancelled) setNodes(arr.map((n: any) => ({ id: n.id, name: n.name, panel_type: n.panel_type, is_enabled: n.is_enabled, is_visible_in_sub: n.is_visible_in_sub })));

          // show a few latest users (admin view doesn't have a dedicated endpoint; keep it simple)
          setRecentUsers([]);
        } else {
          const st = await apiFetch<ResellerStats>("/api/v1/reseller/stats");
          if (!cancelled) setResellerStats(st);

          const ns = await apiFetch<any>("/api/v1/reseller/nodes");
          const arr = Array.isArray(ns) ? ns : ns?.items || [];
          if (!cancelled) setNodes(arr.map((n: any) => ({ id: n.id, name: n.name, panel_type: n.panel_type, is_visible_in_sub: n.is_visible_in_sub })));

          const up = await apiFetch<any>("/api/v1/reseller/users?offset=0&limit=6");
          if (!cancelled) setRecentUsers((up?.items || []).slice(0, 6).map((u: any) => ({ id: u.id, label: u.label, status: u.status })));
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

  const lowBalanceWarn = me && me.role !== "admin" && resellerStats
    ? (() => {
    const balance = Number(resellerStats.balance || 0);
    const priceCandidates = [Number(resellerStats.bundle_price_per_gb || 0), Number(resellerStats.price_per_gb || 0)].filter((x) => x > 0);
    const bestGbPrice = priceCandidates.length ? Math.min(...priceCandidates) : null;
    const affordableGb = bestGbPrice ? balance / bestGbPrice : null;
    const lowByCash = balance <= 300_000;
    const lowByTraffic = affordableGb != null && affordableGb < 100;
    if (!lowByCash && !lowByTraffic) return null;
    return {
      balance,
      affordableGb,
      lowByCash,
      lowByTraffic,
    };
    })()
    : null;

  if (!me) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm text-[hsl(var(--fg))]/70">{t("sidebar.dashboard")}</div>
          <div className="text-xl font-semibold">
            {me.role === "admin" ? "پنل مدیریت" : "پنل رسیلر"}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/app/users/new">
            <Button variant="outline">{t("users.create")}</Button>
          </Link>
          <Link href="/app/users">
            <Button>{t("sidebar.users")}</Button>
          </Link>
        </div>
      </div>

      {err ? (
        <Card>
          <CardContent className="py-6 text-sm text-[hsl(var(--fg))]/80">{err}</CardContent>
        </Card>
      ) : null}

      {loading ? (
        <Card>
          <CardContent className="py-6 text-sm text-[hsl(var(--fg))]/70">{t("common.loading")}</CardContent>
        </Card>
      ) : null}

      {!loading && me.role === "admin" && adminStats ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard title="تعداد رسیلرها" value={fmtNumber(adminStats.resellers_total)} icon={<UsersRound size={16} />} />
            <StatCard title="تعداد کاربران" value={fmtNumber(adminStats.users_total)} icon={<UsersRound size={16} />} />
            <StatCard title="تعداد نودها" value={fmtNumber(adminStats.nodes_total)} icon={<Network size={16} />} />
            <StatCard title="تعداد سفارش‌ها" value={fmtNumber(adminStats.orders_total)} icon={<ShoppingCart size={16} />} />
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <StatCard title="تراکنش‌های دفتر کل" value={fmtNumber(adminStats.ledger_entries_total)} icon={<Database size={16} />} />
            <StatCard title="خالص تراکنش ۳۰ روز" value={fmtNumber(adminStats.ledger_net_30d)} hint="(+ شارژ، - مصرف)" icon={<BarChart3 size={16} />} />
            <StatCard
              title="میانگین قیمت/GB رسیلرها"
              value={adminStats.price_per_gb_avg == null ? "—" : fmtNumber(adminStats.price_per_gb_avg)}
              icon={<Coins size={16} />}
            />
          </div>

          <Card>
            <CardHeader>
              <div className="text-sm font-semibold">وضعیت نودها</div>
              <div className="text-xs text-[hsl(var(--fg))]/70">آخرین نودهای ثبت‌شده</div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {nodes.slice(0, 8).map((n) => (
                  <div key={n.id} className="flex items-center justify-between gap-3 rounded-xl border p-3">
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
                <div className="rounded-xl border border-amber-400/40 bg-amber-100/40 px-4 py-3 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
                  <div className="flex items-center gap-2 font-semibold">
                    <AlertTriangle size={16} />
                    هشدار موجودی پایین
                  </div>
                  <div className="mt-1 text-xs">
                    موجودی شما {fmtNumber(lowBalanceWarn.balance)} تومان است.
                    {lowBalanceWarn.affordableGb != null
                      ? ` با قیمت فعلی تقریباً ${Math.max(0, Math.floor(lowBalanceWarn.affordableGb))}GB قابل خرید است.`
                      : ""}
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard title="موجودی" value={fmtNumber(resellerStats.balance)} icon={<Wallet size={16} />} />
            <StatCard title="کاربران" value={fmtNumber(resellerStats.users_total)} hint={`فعال: ${fmtNumber(resellerStats.users_active)} • غیرفعال: ${fmtNumber(resellerStats.users_disabled)}`} icon={<UsersRound size={16} />} />
            <StatCard title="نودهای مجاز" value={fmtNumber(resellerStats.nodes_allowed)} icon={<Network size={16} />} />
            <StatCard title="سفارش‌ها (۳۰ روز)" value={fmtNumber(resellerStats.orders_30d)} icon={<ShoppingCart size={16} />} />
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <StatCard title="قیمت/GB" value={fmtNumber(resellerStats.price_per_gb)} hint="مدل per-node" icon={<Coins size={16} />} />
            <StatCard title="باندل/GB" value={fmtNumber(resellerStats.bundle_price_per_gb)} hint="مدل bundle" icon={<Boxes size={16} />} />
            <StatCard title="قیمت/روز" value={fmtNumber(resellerStats.price_per_day)} hint="هزینه تمدید" icon={<Coins size={16} />} />
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <div className="text-sm font-semibold">وضعیت نودهای شما</div>
                <div className="text-xs text-[hsl(var(--fg))]/70">نودهای تخصیص داده‌شده</div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {nodes.slice(0, 8).map((n) => (
                    <div key={n.id} className="flex items-center justify-between gap-3 rounded-xl border p-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{n.name}</div>
                        <div className="text-xs text-[hsl(var(--fg))]/70">#{n.id} • {n.panel_type || "—"}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={n.is_visible_in_sub === false ? "muted" : "default"}>{n.is_visible_in_sub === false ? "hidden" : "visible"}</Badge>
                      </div>
                    </div>
                  ))}
                  {nodes.length === 0 ? <div className="text-sm text-[hsl(var(--fg))]/70">{t("common.empty")}</div> : null}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="text-sm font-semibold">آخرین کاربران</div>
                <div className="text-xs text-[hsl(var(--fg))]/70">آخرین ۶ مورد</div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {recentUsers.map((u) => (
                    <Link key={u.id} href={`/app/users/${u.id}`} className="block">
                      <div className="flex items-center justify-between gap-3 rounded-xl border p-3 hover:bg-[hsl(var(--muted))]">
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
            <StatCard title="مصرف شما (۳۰ روز)" value={fmtNumber(resellerStats.spent_30d)} hint="جمع کسر شده از کیف پول" icon={<BarChart3 size={16} />} />
            <StatCard title="کل سفارش‌ها" value={fmtNumber(resellerStats.orders_total)} icon={<ShoppingCart size={16} />} />
          </div>
        </>
      ) : null}
    </div>
  );
}
