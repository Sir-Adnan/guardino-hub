"use client";

import * as React from "react";
import { apiFetch } from "@/lib/api";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type UserOut = { id: number; label: string; total_gb: number; used_bytes: number; expire_at: string; status: string };
type UsersPage = { items: UserOut[]; total: number };

export default function UsersPage() {
  const [q, setQ] = React.useState("");
  const [data, setData] = React.useState<UsersPage | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    apiFetch<UsersPage>("/api/v1/reseller/users")
      .then(setData)
      .catch((e) => setErr(String(e.message || e)));
  }, []);

  const items = (data?.items || []).filter((u) => u.label.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="text-xl font-semibold">Users</div>
          <div className="text-sm text-[hsl(var(--fg))]/70">لیست کاربران شما</div>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder="جستجو..." value={q} onChange={(e) => setQ(e.target.value)} />
          {err ? <div className="text-sm text-red-500">{err}</div> : null}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[hsl(var(--fg))]/70">
                <tr className="border-b border-[hsl(var(--border))]">
                  <th className="text-right py-2">ID</th>
                  <th className="text-right py-2">Label</th>
                  <th className="text-right py-2">GB</th>
                  <th className="text-right py-2">Expire</th>
                  <th className="text-right py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((u) => (
                  <tr key={u.id} className="border-b border-[hsl(var(--border))]">
                    <td className="py-2">{u.id}</td>
                    <td className="py-2">{u.label}</td>
                    <td className="py-2">{u.total_gb}</td>
                    <td className="py-2">{new Date(u.expire_at).toLocaleString()}</td>
                    <td className="py-2">{u.status}</td>
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
