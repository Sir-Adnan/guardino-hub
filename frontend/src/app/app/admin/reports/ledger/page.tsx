"use client";
import * as React from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { fmtNumber } from "@/lib/format";
import { Pagination } from "@/components/ui/pagination";

type ResellerMini = { id: number; username: string; };

export default function LedgerPage() {
  const { push } = useToast();
  const [resellerId, setResellerId] = React.useState<string>("");
  const [resellerQuery, setResellerQuery] = React.useState("");
  const [resellers, setResellers] = React.useState<ResellerMini[]>([]);
  const [items, setItems] = React.useState<any[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(200);

  async function load() {
    try {
      const offset = (page - 1) * pageSize;
      const q = new URLSearchParams();
      if (resellerId) q.set("reseller_id", resellerId);
      q.set("offset", String(offset));
      q.set("limit", String(pageSize));
      const qs = q.toString() ? `?${q.toString()}` : "";
      const res = await apiFetch<any>(`/api/v1/admin/reports/ledger${qs}`);
      setItems(res.items || []);
      setTotal(res.total || 0);
      push({ title: "Loaded", type: "success" });
    } catch (e:any) {
      push({ title: "Error", desc: String(e.message||e), type: "error" });
    }
  }

  React.useEffect(() => { (async () => {
    try {
      const r = await apiFetch<any>("/api/v1/admin/resellers?offset=0&limit=500");
      setResellers((r.items || []).map((x: any) => ({ id: x.id, username: x.username })));
    } catch {}
    await load();
  })(); /* eslint-disable-next-line */ }, []);

  React.useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, resellerId]);

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

// Use en-US separators for consistent readability
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="text-xl font-semibold">Ledger</div>
          <div className="text-sm text-[hsl(var(--fg))]/70">آخرین ۵۰۰ تراکنش</div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 md:grid-cols-3">
  <Input
    placeholder="جستجو ریسیلر (نام یا ID)"
    value={resellerQuery}
    onChange={(e) => setResellerQuery(e.target.value)}
  />
  <select
    className="h-10 rounded-xl border border-[hsl(var(--border))] bg-transparent px-3 text-sm outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
    value={resellerId}
    onChange={(e) => setResellerId(e.target.value)}
  >
    <option value="">همه ریسیلرها</option>
    {filteredResellers.map((r) => (
      <option key={r.id} value={String(r.id)}>
        {r.username} (#{r.id})
      </option>
    ))}
  </select>
  <Button type="button" variant="outline" onClick={load}>بارگذاری</Button>
</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[hsl(var(--fg))]/70">
                <tr className="border-b border-[hsl(var(--border))]">
                  <th className="text-right py-2">ID</th>
                  <th className="text-right py-2">Reseller</th>
                  <th className="text-right py-2">Amount</th>
                  <th className="text-right py-2">Reason</th>
                  <th className="text-right py-2">Balance</th>
                  <th className="text-right py-2">At</th>
                </tr>
              </thead>
              <tbody>
                {items.map((t) => (
                  <tr key={t.id} className="border-b border-[hsl(var(--border))]">
                    <td className="py-2">{t.id}</td>
                    <td className="py-2">{resellerMap[t.reseller_id] ? `${resellerMap[t.reseller_id]} (#${t.reseller_id})` : t.reseller_id}</td>
                    <td className="py-2">{fmtNumber(t.amount)}</td>
                    <td className="py-2">{t.reason}</td>
                    <td className="py-2">{fmtNumber(t.balance_after)}</td>
                    <td className="py-2">{t.occurred_at ? new Date(t.occurred_at).toLocaleString() : "-"}</td>
                  </tr>
                ))}
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
            pageSizeOptions={[100, 200, 500]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
