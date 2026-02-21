"use client";

import * as React from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/ui/toast";

type ResellerOut = {
  id: number;
  parent_id?: number | null;
  username: string;
  status: string;
  balance: number;
  price_per_gb: number;
  price_per_day?: number | null;
  bundle_price_per_gb?: number | null;
};

export default function AdminResellersPage() {
  const { push } = useToast();
  const [items, setItems] = React.useState<ResellerOut[]>([]);
  const [err, setErr] = React.useState<string | null>(null);

  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [priceGb, setPriceGb] = React.useState(0);
  const [bundleGb, setBundleGb] = React.useState<number>(0);
  const [priceDay, setPriceDay] = React.useState<number>(0);

  const [creditId, setCreditId] = React.useState<number>(0);
  const [creditAmount, setCreditAmount] = React.useState<number>(10000);

  async function load() {
  try {
    const res = await apiFetch<any>("/api/v1/admin/reports/resellers");
    setItems(res.items || []);
    push({ title: "Loaded", type: "success" });
  } catch (e: any) {
    push({ title: "Error", desc: String(e.message || e), type: "error" });
  }
}

  async function create() {
    try {
      const res = await apiFetch<ResellerOut>("/api/v1/admin/resellers", {
        method: "POST",
        body: JSON.stringify({
          username,
          password,
          parent_id: null,
          price_per_gb: priceGb,
          price_per_day: priceDay > 0 ? priceDay : null,
          bundle_price_per_gb: bundleGb > 0 ? bundleGb : null,
          can_create_subreseller: true,
        }),
      });
      push({ title: "Reseller created", desc: `ID: ${res.id}`, type: "success" });
      setItems((p) => [res, ...p]);
    } catch (e: any) {
      push({ title: "Error", desc: String(e.message || e), type: "error" });
    }
  }

  async function credit() {
    try {
      const res = await apiFetch<any>(`/api/v1/admin/resellers/${creditId}/credit`, {
        method: "POST",
        body: JSON.stringify({ amount: creditAmount, reason: "manual_credit" }),
      });
      push({ title: "Credited", desc: `Balance: ${res.balance}`, type: "success" });
    } catch (e: any) {
      push({ title: "Error", desc: String(e.message || e), type: "error" });
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="text-xl font-semibold">Admin: Resellers</div>
          <div className="text-sm text-[hsl(var(--fg))]/70">ایجاد نماینده + شارژ دستی</div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <div className="text-sm font-medium">Create reseller</div>
              <div className="grid gap-2">
                <Input placeholder="username" value={username} onChange={(e) => setUsername(e.target.value)} />
                <Input placeholder="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
                <div className="grid grid-cols-3 gap-2">
                  <Input placeholder="price/GB" type="number" value={priceGb} onChange={(e) => setPriceGb(Number(e.target.value))} />
                  <Input placeholder="bundle/GB" type="number" value={bundleGb} onChange={(e) => setBundleGb(Number(e.target.value))} />
                  <Input placeholder="price/day" type="number" value={priceDay} onChange={(e) => setPriceDay(Number(e.target.value))} />
                </div>
                <div className="flex gap-2"><Button type="button" onClick={create}>Create</Button><Button type="button" variant="outline" onClick={load}>Load</Button></div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">Credit reseller</div>
              <div className="grid gap-2">
                <Input placeholder="reseller id" type="number" value={creditId} onChange={(e) => setCreditId(Number(e.target.value))} />
                <Input placeholder="amount" type="number" value={creditAmount} onChange={(e) => setCreditAmount(Number(e.target.value))} />
                <Button type="button" variant="outline" onClick={credit}>Credit</Button>
              </div>
              <div className="text-xs text-[hsl(var(--fg))]/70">در مرحله بعد: لیست کامل نماینده‌ها + ledger</div>
            </div>
          </div>

          {err ? <div className="text-sm text-red-500">{err}</div> : null}

          {items.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-[hsl(var(--fg))]/70">
                  <tr className="border-b border-[hsl(var(--border))]">
                    <th className="text-right py-2">ID</th>
                    <th className="text-right py-2">Username</th>
                    <th className="text-right py-2">Balance</th>
                    <th className="text-right py-2">price/GB</th>
                    <th className="text-right py-2">bundle/GB</th>
                    <th className="text-right py-2">price/day</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((x) => (
                    <tr key={x.id} className="border-b border-[hsl(var(--border))]">
                      <td className="py-2">{x.id}</td>
                      <td className="py-2">{x.username}</td>
                      <td className="py-2">{x.balance}</td>
                      <td className="py-2">{x.price_per_gb}</td>
                      <td className="py-2">{x.bundle_price_per_gb ?? "-"}</td>
                      <td className="py-2">{x.price_per_day ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-sm text-[hsl(var(--fg))]/70">لیستی هنوز بارگذاری نشده (فعلاً create ها را نشان می‌دهیم)</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
