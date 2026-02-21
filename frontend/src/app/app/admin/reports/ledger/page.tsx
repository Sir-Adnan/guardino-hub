"use client";
import * as React from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/ui/toast";

export default function LedgerPage() {
  const { push } = useToast();
  const [resellerId, setResellerId] = React.useState<string>("");
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

  React.useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="text-xl font-semibold">Ledger</div>
          <div className="text-sm text-[hsl(var(--fg))]/70">آخرین ۵۰۰ تراکنش</div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input placeholder="filter reseller_id (optional)" value={resellerId} onChange={(e) => setResellerId(e.target.value)} />
            <Button type="button" variant="outline" onClick={load}>Load</Button>
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
                    <td className="py-2">{t.reseller_id}</td>
                    <td className="py-2">{t.amount}</td>
                    <td className="py-2">{t.reason}</td>
                    <td className="py-2">{t.balance_after}</td>
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
