"use client";

import * as React from "react";
import { Activity, ChartNoAxesCombined, ShoppingCart, UserRound } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { fmtNumber } from "@/lib/format";
import { Pagination } from "@/components/ui/pagination";
import { useAuth } from "@/components/auth-context";

type ResellerMini = { id: number; username: string };
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

const ADMIN_FETCH_LIMIT = 200;

async function fetchAllResellersForAdmin(maxPages = 50): Promise<ResellerMini[]> {
  const all: ResellerMini[] = [];
  let offset = 0;
  let total = 0;
  for (let i = 0; i < maxPages; i++) {
    const r = await apiFetch<any>(`/api/v1/admin/resellers?offset=${offset}&limit=${ADMIN_FETCH_LIMIT}`);
    const chunk = (r.items || []).map((x: any) => ({ id: x.id, username: x.username })) as ResellerMini[];
    all.push(...chunk);
    total = r.total || all.length;
    if (!chunk.length || all.length >= total) break;
    offset += chunk.length;
  }
  return all;
}

function orderTypeMeta(type: string): { label: string; variant: "success" | "danger" | "warning" | "muted" } {
  const m: Record<string, { label: string; variant: "success" | "danger" | "warning" | "muted" }> = {
    create: { label: "ساخت کاربر", variant: "danger" },
    add_traffic: { label: "افزایش حجم", variant: "danger" },
    extend: { label: "تمدید", variant: "warning" },
    change_nodes: { label: "تغییر نود", variant: "warning" },
    refund: { label: "بازگشت وجه", variant: "success" },
    delete: { label: "حذف کاربر", variant: "muted" },
  };
  return m[(type || "").toLowerCase()] || { label: type || "نامشخص", variant: "muted" };
}

function orderStatusMeta(status: string): { label: string; variant: "success" | "danger" | "warning" | "muted" } {
  const m: Record<string, { label: string; variant: "success" | "danger" | "warning" | "muted" }> = {
    completed: { label: "تکمیل‌شده", variant: "success" },
    pending: { label: "در انتظار", variant: "warning" },
    failed: { label: "ناموفق", variant: "danger" },
    rolled_back: { label: "برگشت‌خورده", variant: "muted" },
  };
  return m[(status || "").toLowerCase()] || { label: status || "نامشخص", variant: "muted" };
}

export default function OrdersPage() {
  const { push } = useToast();
  const { me } = useAuth();
  const isAdmin = me?.role === "admin";

  const [resellerId, setResellerId] = React.useState<string>("");
  const [resellerQuery, setResellerQuery] = React.useState("");
  const [resellers, setResellers] = React.useState<ResellerMini[]>([]);
  const [items, setItems] = React.useState<OrderRow[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(100);
  const [loading, setLoading] = React.useState(false);

  async function load() {
    setLoading(true);
    try {
      const offset = (page - 1) * pageSize;
      const q = new URLSearchParams();
      q.set("offset", String(offset));
      q.set("limit", String(pageSize));
      if (isAdmin && resellerId) q.set("reseller_id", resellerId);

      const endpoint = isAdmin ? "/api/v1/admin/reports/orders" : "/api/v1/reseller/reports/orders";
      const res = await apiFetch<any>(`${endpoint}?${q.toString()}`);
      setItems((res.items || []) as OrderRow[]);
      setTotal(res.total || 0);
    } catch (e: any) {
      push({ title: "خطا", desc: String(e.message || e), type: "error" });
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    if (!isAdmin) return;
    (async () => {
      try {
        setResellers(await fetchAllResellersForAdmin());
      } catch (e: any) {
        push({ title: "خطا", desc: String(e.message || e), type: "error" });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  React.useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, resellerId, isAdmin]);

  React.useEffect(() => {
    setPage(1);
  }, [resellerId]);

  const resellerMap = React.useMemo(() => {
    const m: Record<number, string> = {};
    for (const r of resellers) m[r.id] = r.username;
    return m;
  }, [resellers]);

  const filteredResellers = React.useMemo(() => {
    const q = resellerQuery.toLowerCase();
    return resellers.filter((r) => (`${r.id} ${r.username}`).toLowerCase().includes(q)).slice(0, 200);
  }, [resellers, resellerQuery]);
  const selectClass =
    "h-10 rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(155deg,hsl(var(--surface-input-1))_0%,hsl(var(--surface-input-2))_58%,hsl(var(--surface-input-3))_100%)] px-3 text-sm outline-none transition-all duration-200 hover:border-[hsl(var(--accent)/0.35)] focus:ring-2 focus:ring-[hsl(var(--accent)/0.35)]";
  const metricCardClass =
    "rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(155deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] p-3 shadow-[0_10px_22px_-20px_hsl(var(--fg)/0.6)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[hsl(var(--accent)/0.35)]";
  const stats = React.useMemo(() => {
    const completed = items.filter((x) => (x.status || "").toLowerCase() === "completed").length;
    const pending = items.filter((x) => (x.status || "").toLowerCase() === "pending").length;
    const failed = items.filter((x) => {
      const s = (x.status || "").toLowerCase();
      return s === "failed" || s === "rolled_back";
    }).length;
    return { total: items.length, completed, pending, failed };
  }, [items]);

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(112deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] p-4 shadow-[0_15px_28px_-20px_hsl(var(--fg)/0.35)] sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] px-3 py-1 text-xs text-[hsl(var(--fg))]/75">
              <ShoppingCart size={13} />
              Orders Analytics
            </div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight">سفارشات</h1>
            <p className="mt-1 text-sm text-[hsl(var(--fg))]/70">
              {isAdmin ? "تاریخچه سفارشات تمام رسیلرها" : "تاریخچه سفارشات حساب شما"}
            </p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(130deg,hsl(var(--accent)/0.16),hsl(var(--surface-card-1)))] px-3 py-2 text-xs font-medium text-[hsl(var(--fg))]/80">
            <Activity size={14} />
            {loading ? "در حال بروزرسانی..." : "پایش سفارش"}
          </div>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className={metricCardClass}>
          <div className="flex items-center justify-between">
            <div className="text-xs text-[hsl(var(--fg))]/70">تعداد سفارشات</div>
            <ChartNoAxesCombined size={16} className="opacity-60" />
          </div>
          <div className="mt-1 text-lg font-semibold">{fmtNumber(stats.total)}</div>
        </div>
        <div className={metricCardClass}>
          <div className="flex items-center justify-between">
            <div className="text-xs text-[hsl(var(--fg))]/70">تکمیل‌شده</div>
            <ShoppingCart size={16} className="opacity-60" />
          </div>
          <div className="mt-1 text-lg font-semibold text-emerald-600">{fmtNumber(stats.completed)}</div>
        </div>
        <div className={metricCardClass}>
          <div className="flex items-center justify-between">
            <div className="text-xs text-[hsl(var(--fg))]/70">در انتظار</div>
            <UserRound size={16} className="opacity-60" />
          </div>
          <div className="mt-1 text-lg font-semibold text-amber-600">{fmtNumber(stats.pending)}</div>
        </div>
        <div className={metricCardClass}>
          <div className="flex items-center justify-between">
            <div className="text-xs text-[hsl(var(--fg))]/70">ناموفق/برگشتی</div>
            <Activity size={16} className="opacity-60" />
          </div>
          <div className="mt-1 text-lg font-semibold text-red-600">{fmtNumber(stats.failed)}</div>
        </div>
      </div>

      <Card className="overflow-hidden">
        <CardHeader>
          <div className="text-xl font-semibold">جزئیات سفارشات</div>
          <div className="text-sm text-[hsl(var(--fg))]/70">فیلتر و مشاهده وضعیت سفارش‌ها</div>
        </CardHeader>
        <CardContent className="space-y-3">
          {isAdmin ? (
            <div className="grid gap-2 md:grid-cols-3">
              <Input
                placeholder="جستجوی رسیلر (نام یا ID)"
                value={resellerQuery}
                onChange={(e) => setResellerQuery(e.target.value)}
              />
              <select
                className={selectClass}
                value={resellerId}
                onChange={(e) => setResellerId(e.target.value)}
              >
                <option value="">همه رسیلرها</option>
                {filteredResellers.map((r) => (
                  <option key={r.id} value={String(r.id)}>
                    {r.username} (#{r.id})
                  </option>
                ))}
              </select>
              <Button type="button" variant="outline" onClick={load} disabled={loading}>
                {loading ? "..." : "بارگذاری"}
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(130deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] px-3 py-2 text-xs text-[hsl(var(--fg))]/70">
              <span>سفارشات شخصی شما</span>
              <Button type="button" size="sm" variant="outline" onClick={load} disabled={loading}>
                {loading ? "..." : "به‌روزرسانی"}
              </Button>
            </div>
          )}

          <div className="space-y-2 md:hidden">
            {items.map((o) => {
              const tm = orderTypeMeta(o.type);
              const sm = orderStatusMeta(o.status);
              return (
                <div key={o.id} className="space-y-2 rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(150deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] p-3 text-xs">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold">#{o.id}</div>
                    <div className="flex items-center gap-1">
                      <Badge variant={tm.variant}>{tm.label}</Badge>
                      <Badge variant={sm.variant}>{sm.label}</Badge>
                    </div>
                  </div>
                  <div>ریسیلر: {isAdmin ? resellerMap[o.reseller_id] ? `${resellerMap[o.reseller_id]} (#${o.reseller_id})` : `#${o.reseller_id}` : `#${o.reseller_id}`}</div>
                  <div>کاربر: {o.user_id ? `#${o.user_id}` : "-"}</div>
                  <div>حجم سفارش: {o.purchased_gb != null ? `${fmtNumber(o.purchased_gb)} GB` : "-"}</div>
                  <div className="text-[hsl(var(--fg))]/65">{o.created_at ? new Date(o.created_at).toLocaleString() : "-"}</div>
                </div>
              );
            })}
            {!items.length ? <div className="text-sm text-[hsl(var(--fg))]/70">موردی یافت نشد.</div> : null}
          </div>

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead className="text-[hsl(var(--fg))]/70">
                <tr className="border-b border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))]">
                  <th className="text-right py-2">شناسه</th>
                  <th className="text-right py-2">ریسیلر</th>
                  <th className="text-right py-2">کاربر</th>
                  <th className="text-right py-2">نوع سفارش</th>
                  <th className="text-right py-2">وضعیت</th>
                  <th className="text-right py-2">حجم</th>
                  <th className="text-right py-2">زمان</th>
                </tr>
              </thead>
              <tbody>
                {items.map((o) => {
                  const tm = orderTypeMeta(o.type);
                  const sm = orderStatusMeta(o.status);
                  return (
                    <tr key={o.id} className="border-b border-[hsl(var(--border))] transition-colors hover:bg-[hsl(var(--accent)/0.06)]">
                      <td className="py-2">{o.id}</td>
                      <td className="py-2">{isAdmin ? resellerMap[o.reseller_id] ? `${resellerMap[o.reseller_id]} (#${o.reseller_id})` : o.reseller_id : o.reseller_id}</td>
                      <td className="py-2">
                        {o.user_id ? (
                          <a className="underline" href={`/app/users/${o.user_id}`}>#{o.user_id}</a>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td className="py-2"><Badge variant={tm.variant}>{tm.label}</Badge></td>
                      <td className="py-2"><Badge variant={sm.variant}>{sm.label}</Badge></td>
                      <td className="py-2">{o.purchased_gb != null ? `${fmtNumber(o.purchased_gb)} GB` : "-"}</td>
                      <td className="py-2">{o.created_at ? new Date(o.created_at).toLocaleString() : "-"}</td>
                    </tr>
                  );
                })}
                {!items.length ? (
                  <tr>
                    <td className="py-3 text-[hsl(var(--fg))]/70" colSpan={7}>موردی یافت نشد.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
            onPageSizeChange={(s) => {
              setPageSize(s);
              setPage(1);
            }}
            pageSizeOptions={[20, 50, 100, 200]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
