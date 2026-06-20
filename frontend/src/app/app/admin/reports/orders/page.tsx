"use client";

import * as React from "react";
import { Activity, ChartNoAxesCombined, ShoppingCart, UserRound } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api";
import { downloadCsv } from "@/lib/csv";
import { useToast } from "@/components/ui/toast";
import { fmtNumber } from "@/lib/format";
import { Pagination } from "@/components/ui/pagination";
import { useAuth } from "@/components/auth-context";
import { formatJalaliDateTime } from "@/lib/jalali";
import { useI18n } from "@/components/i18n-context";

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
type OrderSummary = {
  total: number;
  completed: number;
  pending: number;
  failed: number;
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

function orderTypeMeta(row: Pick<OrderRow, "type" | "purchased_gb">, lang: "fa" | "en"): { label: string; variant: "success" | "danger" | "warning" | "muted" } {
  const type = row.type;
  const en = lang === "en";
  const m: Record<string, { label: string; variant: "success" | "danger" | "warning" | "muted" }> = {
    create: { label: en ? "Create user" : "ساخت کاربر", variant: "danger" },
    add_traffic: { label: en ? "Add traffic" : "افزایش حجم", variant: "danger" },
    extend: { label: row.purchased_gb != null ? (en ? "Package renewal" : "تمدید بسته‌ای") : en ? "Add time" : "افزایش زمان", variant: "warning" },
    change_nodes: { label: en ? "Change nodes" : "تغییر نود", variant: "warning" },
    refund: { label: en ? "Refund" : "بازگشت وجه", variant: "success" },
    delete: { label: en ? "Delete user" : "حذف کاربر", variant: "muted" },
  };
  return m[(type || "").toLowerCase()] || { label: type || (en ? "Unknown" : "نامشخص"), variant: "muted" };
}

function orderStatusMeta(status: string, lang: "fa" | "en"): { label: string; variant: "success" | "danger" | "warning" | "muted" } {
  const en = lang === "en";
  const m: Record<string, { label: string; variant: "success" | "danger" | "warning" | "muted" }> = {
    completed: { label: en ? "Completed" : "تکمیل‌شده", variant: "success" },
    pending: { label: en ? "Pending" : "در انتظار", variant: "warning" },
    failed: { label: en ? "Failed" : "ناموفق", variant: "danger" },
    rolled_back: { label: en ? "Rolled back" : "برگشت‌خورده", variant: "muted" },
  };
  return m[(status || "").toLowerCase()] || { label: status || (en ? "Unknown" : "نامشخص"), variant: "muted" };
}

function resellerName(resellerId: number, resellerMap: Record<number, string>, isAdmin: boolean, lang: "fa" | "en") {
  if (!isAdmin) return lang === "en" ? "Your account" : "حساب شما";
  return resellerMap[resellerId] || `${lang === "en" ? "Reseller" : "ریسیلر"} #${resellerId}`;
}

export default function OrdersPage() {
  const { push } = useToast();
  const { me } = useAuth();
  const { t, lang } = useI18n();
  const isAdmin = me?.role === "admin";
  const copy = React.useMemo(
    () =>
      lang === "en"
        ? {
            eyebrow: "Orders Analytics",
            title: "Orders",
            subtitleAdmin: "Order history for all resellers",
            subtitleReseller: "Order history for your account",
            live: "Order monitor",
            updating: "Updating...",
            total: "Orders",
            completed: "Completed",
            pending: "Pending",
            failed: "Failed / rolled back",
            detailsTitle: "Order details",
            detailsSubtitle: "Filter and review order status",
            resellerSearch: "Search reseller by name or ID",
            allResellers: "All resellers",
            load: "Load",
            refresh: "Refresh",
            personal: "Your orders",
            reseller: "Reseller",
            user: "User",
            orderVolume: "Order volume",
            id: "ID",
            orderType: "Order type",
            status: "Status",
            volume: "Volume",
            time: "Time",
            empty: "No items found.",
          }
        : {
            eyebrow: "تحلیل سفارشات",
            title: "سفارشات",
            subtitleAdmin: "تاریخچه سفارشات تمام رسیلرها",
            subtitleReseller: "تاریخچه سفارشات حساب شما",
            live: "پایش سفارش",
            updating: "در حال بروزرسانی...",
            total: "تعداد سفارشات",
            completed: "تکمیل‌شده",
            pending: "در انتظار",
            failed: "ناموفق/برگشتی",
            detailsTitle: "جزئیات سفارشات",
            detailsSubtitle: "فیلتر و مشاهده وضعیت سفارش‌ها",
            resellerSearch: "جستجوی رسیلر (نام یا ID)",
            allResellers: "همه رسیلرها",
            load: "بارگذاری",
            refresh: "به‌روزرسانی",
            personal: "سفارشات شخصی شما",
            reseller: "ریسیلر",
            user: "کاربر",
            orderVolume: "حجم سفارش",
            id: "شناسه",
            orderType: "نوع سفارش",
            status: "وضعیت",
            volume: "حجم",
            time: "زمان",
            empty: "موردی یافت نشد.",
          },
    [lang]
  );

  const [resellerId, setResellerId] = React.useState<string>("");
  const [resellerQuery, setResellerQuery] = React.useState("");
  const [resellers, setResellers] = React.useState<ResellerMini[]>([]);
  const [items, setItems] = React.useState<OrderRow[]>([]);
  const [summary, setSummary] = React.useState<OrderSummary | null>(null);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(100);
  const [loading, setLoading] = React.useState(false);
  const loadReqRef = React.useRef(0);

  async function load() {
    const myReq = ++loadReqRef.current;
    setLoading(true);
    try {
      const offset = (page - 1) * pageSize;
      const q = new URLSearchParams();
      q.set("offset", String(offset));
      q.set("limit", String(pageSize));
      if (isAdmin && resellerId) q.set("reseller_id", resellerId);

      const endpoint = isAdmin ? "/api/v1/admin/reports/orders" : "/api/v1/reseller/reports/orders";
      const res = await apiFetch<any>(`${endpoint}?${q.toString()}`);
      // Ignore stale responses so a slow earlier request can't overwrite newer data.
      if (myReq !== loadReqRef.current) return;
      setItems((res.items || []) as OrderRow[]);
      setSummary((res.summary || null) as OrderSummary | null);
      setTotal(res.total || 0);
    } catch (e: any) {
      if (myReq !== loadReqRef.current) return;
      push({ title: t("common.error"), desc: String(e.message || e), type: "error" });
    } finally {
      if (myReq === loadReqRef.current) setLoading(false);
    }
  }

  React.useEffect(() => {
    if (!isAdmin) return;
    (async () => {
      try {
        setResellers(await fetchAllResellersForAdmin());
      } catch (e: any) {
        push({ title: t("common.error"), desc: String(e.message || e), type: "error" });
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
    if (summary) return summary;
    const completed = items.filter((x) => (x.status || "").toLowerCase() === "completed").length;
    const pending = items.filter((x) => (x.status || "").toLowerCase() === "pending").length;
    const failed = items.filter((x) => {
      const s = (x.status || "").toLowerCase();
      return s === "failed" || s === "rolled_back";
    }).length;
    return { total: items.length, completed, pending, failed };
  }, [items, summary]);

  function exportCsv() {
    const en = lang === "en";
    const rows = items.map((o) => ({
      [en ? "ID" : "شناسه"]: o.id,
      [en ? "Date" : "تاریخ"]: o.created_at ? formatJalaliDateTime(o.created_at) : "-",
      [en ? "Reseller" : "ریسیلر"]: resellerName(o.reseller_id, resellerMap, isAdmin, lang),
      [en ? "Type" : "نوع"]: orderTypeMeta(o, lang).label,
      [en ? "Status" : "وضعیت"]: orderStatusMeta(o.status, lang).label,
      [en ? "GB" : "حجم (GB)"]: o.purchased_gb ?? "",
      [en ? "Price/GB" : "قیمت هر GB"]: o.price_per_gb_snapshot ?? "",
    }));
    if (!downloadCsv(`orders-page-${page}.csv`, rows)) {
      push({ title: en ? "Nothing to export" : "داده‌ای برای خروجی نیست", type: "warning" });
    }
  }

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(112deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] p-4 shadow-[0_15px_28px_-20px_hsl(var(--fg)/0.35)] sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] px-3 py-1 text-xs text-[hsl(var(--fg))]/75">
              <ShoppingCart size={13} />
              {copy.eyebrow}
            </div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight">{copy.title}</h1>
            <p className="mt-1 text-sm text-[hsl(var(--fg))]/70">
              {isAdmin ? copy.subtitleAdmin : copy.subtitleReseller}
            </p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(130deg,hsl(var(--accent)/0.16),hsl(var(--surface-card-1)))] px-3 py-2 text-xs font-medium text-[hsl(var(--fg))]/80">
            <Activity size={14} />
            {loading ? copy.updating : copy.live}
          </div>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className={metricCardClass}>
          <div className="flex items-center justify-between">
            <div className="text-xs text-[hsl(var(--fg))]/70">{copy.total}</div>
            <ChartNoAxesCombined size={16} className="opacity-60" />
          </div>
          <div className="mt-1 text-lg font-semibold">{fmtNumber(stats.total)}</div>
        </div>
        <div className={metricCardClass}>
          <div className="flex items-center justify-between">
            <div className="text-xs text-[hsl(var(--fg))]/70">{copy.completed}</div>
            <ShoppingCart size={16} className="opacity-60" />
          </div>
          <div className="mt-1 text-lg font-semibold text-emerald-600">{fmtNumber(stats.completed)}</div>
        </div>
        <div className={metricCardClass}>
          <div className="flex items-center justify-between">
            <div className="text-xs text-[hsl(var(--fg))]/70">{copy.pending}</div>
            <UserRound size={16} className="opacity-60" />
          </div>
          <div className="mt-1 text-lg font-semibold text-amber-600">{fmtNumber(stats.pending)}</div>
        </div>
        <div className={metricCardClass}>
          <div className="flex items-center justify-between">
            <div className="text-xs text-[hsl(var(--fg))]/70">{copy.failed}</div>
            <Activity size={16} className="opacity-60" />
          </div>
          <div className="mt-1 text-lg font-semibold text-red-600">{fmtNumber(stats.failed)}</div>
        </div>
      </div>

      <Card className="overflow-hidden">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xl font-semibold">{copy.detailsTitle}</div>
              <div className="text-sm text-[hsl(var(--fg))]/70">{copy.detailsSubtitle}</div>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={exportCsv} disabled={items.length === 0}>
              {lang === "en" ? "Export CSV (this page)" : "خروجی CSV (این صفحه)"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {isAdmin ? (
            <div className="grid gap-2 md:grid-cols-3">
              <Input
                placeholder={copy.resellerSearch}
                value={resellerQuery}
                onChange={(e) => setResellerQuery(e.target.value)}
              />
              <select
                className={selectClass}
                value={resellerId}
                onChange={(e) => setResellerId(e.target.value)}
              >
                <option value="">{copy.allResellers}</option>
                {filteredResellers.map((r) => (
                  <option key={r.id} value={String(r.id)}>
                    {r.username} (#{r.id})
                  </option>
                ))}
              </select>
              <Button type="button" variant="outline" onClick={load} disabled={loading}>
                {loading ? "..." : copy.load}
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(130deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] px-3 py-2 text-xs text-[hsl(var(--fg))]/70">
              <span>{copy.personal}</span>
              <Button type="button" size="sm" variant="outline" onClick={load} disabled={loading}>
                {loading ? "..." : copy.refresh}
              </Button>
            </div>
          )}

          <div className="space-y-2 md:hidden">
            {items.map((o) => {
              const tm = orderTypeMeta(o, lang);
              const sm = orderStatusMeta(o.status, lang);
              return (
                <div key={o.id} className="space-y-2 rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(150deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] p-3 text-xs">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold">#{o.id}</div>
                    <div className="flex items-center gap-1">
                      <Badge variant={tm.variant}>{tm.label}</Badge>
                      <Badge variant={sm.variant}>{sm.label}</Badge>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 rounded-lg bg-[hsl(var(--surface-card-1))] px-2 py-1">
                    <span className="text-[hsl(var(--fg))]/65">{copy.reseller}</span>
                    <span className="font-medium">{resellerName(o.reseller_id, resellerMap, isAdmin, lang)}</span>
                  </div>
                  <div>{copy.user}: {o.user_id ? `#${o.user_id}` : "-"}</div>
                  <div>{copy.orderVolume}: {o.purchased_gb != null ? `${fmtNumber(o.purchased_gb)} GB` : "-"}</div>
                  <div className="text-[hsl(var(--fg))]/65">{o.created_at ? formatJalaliDateTime(o.created_at) : "-"}</div>
                </div>
              );
            })}
            {loading && !items.length
              ? [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full" />)
              : !items.length
              ? <div className="text-sm text-[hsl(var(--fg))]/70">{copy.empty}</div>
              : null}
          </div>

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead className="text-[hsl(var(--fg))]/70">
                <tr className="border-b border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))]">
                  <th className="text-right py-2">{copy.id}</th>
                  <th className="text-right py-2">{copy.reseller}</th>
                  <th className="text-right py-2">{copy.user}</th>
                  <th className="text-right py-2">{copy.orderType}</th>
                  <th className="text-right py-2">{copy.status}</th>
                  <th className="text-right py-2">{copy.volume}</th>
                  <th className="text-right py-2">{copy.time}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((o) => {
                  const tm = orderTypeMeta(o, lang);
                  const sm = orderStatusMeta(o.status, lang);
                  return (
                    <tr key={o.id} className="border-b border-[hsl(var(--border))] transition-colors hover:bg-[hsl(var(--accent)/0.06)]">
                      <td className="py-2">{o.id}</td>
                      <td className="py-2">
                        <div className="font-medium">{resellerName(o.reseller_id, resellerMap, isAdmin, lang)}</div>
                        {isAdmin ? <div className="text-xs text-[hsl(var(--fg))]/55">#{o.reseller_id}</div> : null}
                      </td>
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
                      <td className="py-2">{o.created_at ? formatJalaliDateTime(o.created_at) : "-"}</td>
                    </tr>
                  );
                })}
                {loading && !items.length
                  ? [0, 1, 2, 3, 4].map((i) => (
                      <tr key={i}>
                        <td className="py-2" colSpan={7}><Skeleton className="h-6 w-full" /></td>
                      </tr>
                    ))
                  : !items.length ? (
                  <tr>
                    <td className="py-3 text-[hsl(var(--fg))]/70" colSpan={7}>{copy.empty}</td>
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
