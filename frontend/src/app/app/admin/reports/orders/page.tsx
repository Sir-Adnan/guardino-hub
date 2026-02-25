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

export default function OrdersPage() {
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
      const res = await apiFetch<any>(`/api/v1/admin/reports/orders${qs}`);
      setItems(res.items || []);
      setTotal(res.total || 0);
      push({ title: "Loaded", type: "success" });
    } catch (e:any) {
      push({ title: "Error", desc: String(e.message||e), type: "error" });
    }
  }

  React.useEffect(() => {
    (async () => {
      try {
        setResellers(await fetchAllResellersForAdmin());
      } catch (e: any) {
        push({ title: "Error", desc: String(e.message || e), type: "error" });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="text-xl font-semibold">Orders</div>
          <div className="text-sm text-[hsl(var(--fg))]/70">آخرین ۵۰۰ سفارش</div>
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
                    <td className="py-2">{resellerMap[o.reseller_id] ? `${resellerMap[o.reseller_id]} (#${o.reseller_id})` : o.reseller_id}</td>
                    <td className="py-2">{o.user_id ? <a className="underline" href={`/app/users/${o.user_id}`}>{o.user_id}</a> : "-"}</td>
                    <td className="py-2">{o.type}</td>
                    <td className="py-2">{o.status}</td>
                    <td className="py-2">{o.purchased_gb != null ? fmtNumber(o.purchased_gb) : "-"}</td>
                    <td className="py-2">{o.created_at ? new Date(o.created_at).toLocaleString() : "-"}</td>
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
