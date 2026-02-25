"use client";

import * as React from "react";
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
type LedgerRow = {
  id: number;
  reseller_id: number;
  order_id: number | null;
  amount: number;
  reason: string;
  balance_after: number;
  occurred_at: string | null;
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

function reasonMeta(reason: string, amount: number): { label: string; variant: "success" | "danger" | "warning" | "muted" } {
  const key = (reason || "").toLowerCase();
  const map: Record<string, { label: string; variant: "success" | "danger" | "warning" | "muted" }> = {
    manual_credit: { label: "شارژ دستی", variant: "success" },
    user_create: { label: "هزینه ساخت کاربر", variant: "danger" },
    add_traffic: { label: "هزینه افزایش حجم", variant: "danger" },
    extend: { label: "هزینه تمدید", variant: "danger" },
    refund_decrease: { label: "بازگشت وجه کاهش حجم", variant: "success" },
    refund_delete: { label: "بازگشت وجه حذف کاربر", variant: "success" },
    change_nodes_add: { label: "هزینه افزودن نود", variant: "warning" },
  };
  if (map[key]) return map[key];
  if (amount > 0) return { label: "افزایش موجودی", variant: "success" };
  if (amount < 0) return { label: "کسر موجودی", variant: "danger" };
  return { label: reason || "نامشخص", variant: "muted" };
}

export default function LedgerPage() {
  const { push } = useToast();
  const { me } = useAuth();
  const isAdmin = me?.role === "admin";

  const [resellerId, setResellerId] = React.useState<string>("");
  const [resellerQuery, setResellerQuery] = React.useState("");
  const [resellers, setResellers] = React.useState<ResellerMini[]>([]);
  const [items, setItems] = React.useState<LedgerRow[]>([]);
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

      const endpoint = isAdmin ? "/api/v1/admin/reports/ledger" : "/api/v1/reseller/reports/ledger";
      const res = await apiFetch<any>(`${endpoint}?${q.toString()}`);
      setItems((res.items || []) as LedgerRow[]);
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

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="text-xl font-semibold">دفتر کل مالی</div>
          <div className="text-sm text-[hsl(var(--fg))]/70">
            {isAdmin ? "تاریخچه تراکنش تمام رسیلرها" : "تاریخچه تراکنش‌های حساب شما"}
          </div>
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
                className="h-10 rounded-xl border border-[hsl(var(--border))] bg-transparent px-3 text-sm outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
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
            <div className="flex items-center justify-between rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-3 py-2 text-xs text-[hsl(var(--fg))]/70">
              <span>دفتر کل شخصی شما</span>
              <Button type="button" size="sm" variant="outline" onClick={load} disabled={loading}>
                {loading ? "..." : "به‌روزرسانی"}
              </Button>
            </div>
          )}

          <div className="space-y-2 md:hidden">
            {items.map((t) => {
              const meta = reasonMeta(t.reason, t.amount);
              return (
                <div key={t.id} className="rounded-xl border border-[hsl(var(--border))] p-3 text-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold">#{t.id}</div>
                    <Badge variant={meta.variant}>{meta.label}</Badge>
                  </div>
                  <div>ریسیلر: {isAdmin ? resellerMap[t.reseller_id] ? `${resellerMap[t.reseller_id]} (#${t.reseller_id})` : `#${t.reseller_id}` : `#${t.reseller_id}`}</div>
                  <div className={t.amount >= 0 ? "text-emerald-700" : "text-red-700"}>
                    مبلغ: {t.amount >= 0 ? "+" : ""}{fmtNumber(t.amount)}
                  </div>
                  <div>موجودی بعد از عملیات: {fmtNumber(t.balance_after)}</div>
                  <div className="text-[hsl(var(--fg))]/65">{t.occurred_at ? new Date(t.occurred_at).toLocaleString() : "-"}</div>
                </div>
              );
            })}
            {!items.length ? <div className="text-sm text-[hsl(var(--fg))]/70">موردی یافت نشد.</div> : null}
          </div>

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead className="text-[hsl(var(--fg))]/70">
                <tr className="border-b border-[hsl(var(--border))]">
                  <th className="text-right py-2">شناسه</th>
                  <th className="text-right py-2">ریسیلر</th>
                  <th className="text-right py-2">مبلغ</th>
                  <th className="text-right py-2">نوع عملیات</th>
                  <th className="text-right py-2">موجودی بعد</th>
                  <th className="text-right py-2">زمان</th>
                </tr>
              </thead>
              <tbody>
                {items.map((t) => {
                  const meta = reasonMeta(t.reason, t.amount);
                  return (
                    <tr key={t.id} className="border-b border-[hsl(var(--border))]">
                      <td className="py-2">{t.id}</td>
                      <td className="py-2">{isAdmin ? resellerMap[t.reseller_id] ? `${resellerMap[t.reseller_id]} (#${t.reseller_id})` : t.reseller_id : t.reseller_id}</td>
                      <td className={`py-2 font-medium ${t.amount >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                        {t.amount >= 0 ? "+" : ""}{fmtNumber(t.amount)}
                      </td>
                      <td className="py-2"><Badge variant={meta.variant}>{meta.label}</Badge></td>
                      <td className="py-2">{fmtNumber(t.balance_after)}</td>
                      <td className="py-2">{t.occurred_at ? new Date(t.occurred_at).toLocaleString() : "-"}</td>
                    </tr>
                  );
                })}
                {!items.length ? (
                  <tr>
                    <td className="py-3 text-[hsl(var(--fg))]/70" colSpan={6}>موردی یافت نشد.</td>
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
