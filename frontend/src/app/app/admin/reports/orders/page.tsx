"use client";
import * as React from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/ui/toast";

export default function OrdersPage() {
  const { push } = useToast();
  const [resellerId, setResellerId] = React.useState<string>("");
  const [items, setItems] = React.useState<any[]>([]);

  async function load() {
    try {
      const q = resellerId ? `?reseller_id=${encodeURIComponent(resellerId)}` : "";
      const res = await apiFetch<any>(`/api/v1/admin/reports/orders${q}`);
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
          <div className="text-xl font-semibold">Orders</div>
          <div className="text-sm text-[hsl(var(--fg))]/70">آخرین ۵۰۰ سفارش</div>
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
                  <th className="text-right py-2">User</th>
                  <th className="text-right py-2">Type</th>
                  <th className="text-right py-2">Status</th>
                  <th className="text-right py-2">GB</th>
                  <th className="text-right py-2">At</th>
                </tr>
              </thead>
              <tbody>
                {items.map((o) => (
                  <tr key={o.id} className="border-b border-[hsl(var(--border))]">
                    <td className="py-2">{o.id}</td>
                    <td className="py-2">{o.reseller_id}</td>
                    <td className="py-2">{o.user_id ?? "-"}</td>
                    <td className="py-2">{o.type}</td>
                    <td className="py-2">{o.status}</td>
                    <td className="py-2">{o.purchased_gb ?? "-"}</td>
                    <td className="py-2">{o.created_at ? new Date(o.created_at).toLocaleString() : "-"}</td>
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
