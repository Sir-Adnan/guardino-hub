"use client";
import * as React from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { fmtNumber } from "@/lib/format";

type ResellerMini = { id: number; username: string; };

export default function LedgerPage() {
  const { push } = useToast();
  const [resellerId, setResellerId] = React.useState<string>("");
  const [resellerQuery, setResellerQuery] = React.useState("");
  const [resellers, setResellers] = React.useState<ResellerMini[]>([]);
  const [items, setItems] = React.useState<any[]>([]);

  async function load() {
    try {
      const q = resellerId ? `?reseller_id=${encodeURIComponent(resellerId)}` : "";
      const res = await apiFetch<any>(`/api/v1/admin/reports/ledger${q}`);
      setItems(res.items || []);
      push({ title: "Loaded", type: "success" });
    } catch (e:any) {
      push({ title: "Error", desc: String(e.message||e), type: "error" });
    }
  }

  React.useEffect(() => { (async () => {
    try {
      const r = await apiFetch<any>("/api/v1/admin/resellers");
      setResellers((r || []).map((x: any) => ({ id: x.id, username: x.username })));
    } catch {}
    await load();
  })(); /* eslint-disable-next-line */ }, []);


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
    className="h-10 rounded-xl border border-[hsl(var(--border))] bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
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
        </CardContent>
      </Card>
    </div>
  );
}
