"use client";

import * as React from "react";
import { Gauge, Layers, Network, Search, ShieldCheck, Star } from "lucide-react";

import { apiFetch } from "@/lib/api";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

type ResellerNode = {
  id: number;
  name: string;
  base_url: string;
  panel_type: string;
  tags: string[];
  is_visible_in_sub: boolean;
  default_for_reseller: boolean;
  price_per_gb_override: number | null;
};

function panelLabel(panel: string) {
  const p = String(panel || "").toLowerCase();
  if (p === "wg_dashboard") return "وایرگارد";
  return "لینک امن";
}

export default function NodesPage() {
  const [items, setItems] = React.useState<ResellerNode[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState<string | null>(null);
  const [q, setQ] = React.useState("");
  const [panelFilter, setPanelFilter] = React.useState("all");
  const [tagFilter, setTagFilter] = React.useState("");

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const res = await apiFetch<{ items: ResellerNode[] }>("/api/v1/reseller/nodes");
      setItems(res?.items || []);
    } catch (e: any) {
      setErr(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    load();
  }, []);

  const tagOptions = React.useMemo(() => {
    const set = new Set<string>();
    items.forEach((n) => (n.tags || []).forEach((t) => set.add(String(t))));
    return Array.from(set).sort();
  }, [items]);

  const filtered = React.useMemo(() => {
    const qq = q.trim().toLowerCase();
    const tg = tagFilter.trim().toLowerCase();
    return items.filter((n) => {
      if (panelFilter !== "all" && n.panel_type !== panelFilter) return false;
      if (tg && !(n.tags || []).some((x) => String(x).toLowerCase().includes(tg))) return false;
      if (!qq) return true;
      const s = `${n.id} ${n.name} ${n.base_url} ${n.panel_type} ${(n.tags || []).join(" ")}`.toLowerCase();
      return s.includes(qq);
    });
  }, [items, panelFilter, q, tagFilter]);

  const stats = React.useMemo(() => {
    const total = items.length;
    const defaults = items.filter((x) => x.default_for_reseller).length;
    const visible = items.filter((x) => x.is_visible_in_sub).length;
    const withOverride = items.filter((x) => x.price_per_gb_override != null).length;
    return { total, defaults, visible, withOverride };
  }, [items]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="text-xl font-semibold">نودهای مجاز شما</div>
          <div className="text-sm text-[hsl(var(--fg))]/70">
            در این صفحه می‌توانید نودهای تخصیص داده‌شده به حساب خود را ببینید و مناسب‌ترین نودها را برای ساخت کاربر انتخاب کنید.
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-[hsl(var(--border))] p-3">
              <div className="flex items-center justify-between">
                <div className="text-xs text-[hsl(var(--fg))]/70">کل نودها</div>
                <Network size={16} className="opacity-60" />
              </div>
              <div className="mt-1 text-lg font-semibold">{stats.total}</div>
            </div>
            <div className="rounded-2xl border border-[hsl(var(--border))] p-3">
              <div className="flex items-center justify-between">
                <div className="text-xs text-[hsl(var(--fg))]/70">نود پیش‌فرض</div>
                <Star size={16} className="opacity-60" />
              </div>
              <div className="mt-1 text-lg font-semibold">{stats.defaults}</div>
            </div>
            <div className="rounded-2xl border border-[hsl(var(--border))] p-3">
              <div className="flex items-center justify-between">
                <div className="text-xs text-[hsl(var(--fg))]/70">نمایش در ساب</div>
                <ShieldCheck size={16} className="opacity-60" />
              </div>
              <div className="mt-1 text-lg font-semibold">{stats.visible}</div>
            </div>
            <div className="rounded-2xl border border-[hsl(var(--border))] p-3">
              <div className="flex items-center justify-between">
                <div className="text-xs text-[hsl(var(--fg))]/70">قیمت اختصاصی</div>
                <Gauge size={16} className="opacity-60" />
              </div>
              <div className="mt-1 text-lg font-semibold">{stats.withOverride}</div>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-[1fr,220px,220px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" />
              <Input className="pl-10" value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجو بر اساس نام، پنل، URL یا تگ..." />
            </div>
            <select
              className="h-10 rounded-xl border border-[hsl(var(--border))] bg-transparent px-3 text-sm outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
              value={panelFilter}
              onChange={(e) => setPanelFilter(e.target.value)}
            >
              <option value="all">همه پنل‌ها</option>
              <option value="marzban">marzban</option>
              <option value="pasarguard">pasarguard</option>
              <option value="wg_dashboard">wg_dashboard</option>
            </select>
            <select
              className="h-10 rounded-xl border border-[hsl(var(--border))] bg-transparent px-3 text-sm outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
            >
              <option value="">همه تگ‌ها</option>
              {tagOptions.map((tg) => (
                <option key={tg} value={tg}>
                  {tg}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      {err ? (
        <Card>
          <CardContent className="pt-6 text-sm text-red-600">{err}</CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Layers size={18} />
            <div className="text-lg font-semibold">لیست نودها</div>
          </div>
          <div className="text-sm text-[hsl(var(--fg))]/70">برای موبایل و دسکتاپ بهینه شده و جزئیات مهم هر نود را نمایش می‌دهد.</div>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="rounded-2xl border border-[hsl(var(--border))] p-3 space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-6 w-32" />
                </div>
              ))}
            </div>
          ) : filtered.length ? (
            <div className="grid gap-3 md:grid-cols-2">
              {filtered.map((n) => (
                <article key={n.id} className="rounded-2xl border border-[hsl(var(--border))] p-3 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{n.name}</div>
                      <div className="mt-0.5 text-xs text-[hsl(var(--fg))]/65">#{n.id}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      <Badge variant="muted">{panelLabel(n.panel_type)}</Badge>
                      {n.default_for_reseller ? <Badge variant="success">پیش‌فرض</Badge> : null}
                      {n.is_visible_in_sub ? <Badge variant="success">در ساب</Badge> : <Badge variant="warning">مخفی در ساب</Badge>}
                    </div>
                  </div>
                  <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/40 p-2 text-xs break-all">{n.base_url}</div>
                  <div className="flex flex-wrap gap-1">
                    {(n.tags || []).length ? (n.tags || []).map((tg) => <Badge key={tg} variant="muted">{tg}</Badge>) : <Badge variant="muted">بدون تگ</Badge>}
                  </div>
                  <div className="text-xs text-[hsl(var(--fg))]/75">
                    قیمت اختصاصی هر GB: {n.price_per_gb_override != null ? n.price_per_gb_override : "از تنظیمات عمومی"}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-[hsl(var(--border))] p-4 text-sm text-[hsl(var(--fg))]/70">موردی پیدا نشد.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
