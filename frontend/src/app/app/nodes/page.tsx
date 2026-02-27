"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  BarChart3,
  CheckCircle2,
  CircleDollarSign,
  Copy,
  Filter,
  Layers,
  Network,
  Search,
  Shield,
  ShieldCheck,
  Sparkles,
  Star,
  Tags,
  WandSparkles,
} from "lucide-react";

import { apiFetch } from "@/lib/api";
import { copyText } from "@/lib/copy";
import { fmtNumber } from "@/lib/format";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";

type ResellerNode = {
  id: number;
  name: string;
  public_code?: string;
  panel_type: string;
  tags: string[];
  is_visible_in_sub: boolean;
  default_for_reseller: boolean;
  price_per_gb_override: number | null;
};

type ResellerStats = {
  balance: number;
  price_per_gb: number;
  bundle_price_per_gb: number;
  price_per_day: number;
};

type SortMode = "smart" | "name" | "cheap" | "default";
type EstimateMode = "per_node" | "bundle";

const GB_PRESETS = [10, 20, 30, 50, 100, 150];
const DAY_PRESETS = [0, 7, 30, 90, 180];

function panelLabel(panel: string) {
  const p = String(panel || "").toLowerCase();
  if (p === "wg_dashboard") return "وایرگارد";
  if (p === "pasarguard") return "پاسارگارد";
  return "مرزبان";
}

function panelBadge(panel: string): "muted" | "success" | "warning" {
  const p = String(panel || "").toLowerCase();
  if (p === "wg_dashboard") return "success";
  if (p === "pasarguard") return "warning";
  return "muted";
}

function nodeCode(n: ResellerNode) {
  if (n.public_code) return n.public_code;
  return `N-${String(n.id).padStart(4, "0")}`;
}

function suggestUseCases(tags: string[]) {
  const src = (tags || []).map((x) => String(x).toUpperCase());
  const out: string[] = [];
  if (src.some((t) => t.includes("VIP"))) out.push("کیفیت بالا");
  if (src.some((t) => t.includes("IR"))) out.push("مناسب ایران");
  if (src.some((t) => t.includes("EU"))) out.push("مناسب اروپا");
  if (src.some((t) => t.includes("GAME") || t.includes("GAM"))) out.push("مناسب گیم");
  if (src.some((t) => t.includes("STREAM"))) out.push("مناسب استریم");
  return out.slice(0, 3);
}

export default function NodesPage() {
  const router = useRouter();
  const { push } = useToast();

  const [items, setItems] = React.useState<ResellerNode[]>([]);
  const [resellerStats, setResellerStats] = React.useState<ResellerStats | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState<string | null>(null);

  const [q, setQ] = React.useState("");
  const [panelFilter, setPanelFilter] = React.useState("all");
  const [tagFilter, setTagFilter] = React.useState("");
  const [visibleFilter, setVisibleFilter] = React.useState("all");
  const [sortMode, setSortMode] = React.useState<SortMode>("smart");

  const [selectedIds, setSelectedIds] = React.useState<number[]>([]);

  const [estimateMode, setEstimateMode] = React.useState<EstimateMode>("per_node");
  const [estimateGb, setEstimateGb] = React.useState(30);
  const [estimateDays, setEstimateDays] = React.useState(30);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const [nodeRes, statsRes] = await Promise.all([
        apiFetch<{ items: ResellerNode[] }>("/api/v1/reseller/nodes"),
        apiFetch<ResellerStats>("/api/v1/reseller/stats").catch(() => null),
      ]);
      setItems(nodeRes?.items || []);
      setResellerStats(statsRes || null);
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

  function effectivePerGb(n: ResellerNode) {
    if (n.price_per_gb_override != null && Number(n.price_per_gb_override) > 0) return Number(n.price_per_gb_override);
    return Math.max(0, Number(resellerStats?.price_per_gb || 0));
  }

  const filtered = React.useMemo(() => {
    const qq = q.trim().toLowerCase();
    const tg = tagFilter.trim().toLowerCase();
    return items.filter((n) => {
      if (panelFilter !== "all" && n.panel_type !== panelFilter) return false;
      if (visibleFilter === "visible" && !n.is_visible_in_sub) return false;
      if (visibleFilter === "hidden" && n.is_visible_in_sub) return false;
      if (tg && !(n.tags || []).some((x) => String(x).toLowerCase().includes(tg))) return false;
      if (!qq) return true;
      const s = `${n.id} ${nodeCode(n)} ${n.name} ${n.panel_type} ${(n.tags || []).join(" ")}`.toLowerCase();
      return s.includes(qq);
    });
  }, [items, panelFilter, q, tagFilter, visibleFilter]);

  const ordered = React.useMemo(() => {
    const arr = [...filtered];
    if (sortMode === "name") {
      arr.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
      return arr;
    }
    if (sortMode === "cheap") {
      arr.sort((a, b) => effectivePerGb(a) - effectivePerGb(b));
      return arr;
    }
    if (sortMode === "default") {
      arr.sort((a, b) => Number(b.default_for_reseller) - Number(a.default_for_reseller));
      return arr;
    }
    // smart
    arr.sort((a, b) => {
      const wa = (a.default_for_reseller ? 3 : 0) + (a.is_visible_in_sub ? 1 : 0);
      const wb = (b.default_for_reseller ? 3 : 0) + (b.is_visible_in_sub ? 1 : 0);
      if (wb !== wa) return wb - wa;
      return effectivePerGb(a) - effectivePerGb(b);
    });
    return arr;
  }, [filtered, sortMode, resellerStats]);

  const selectedNodes = React.useMemo(() => {
    const set = new Set(selectedIds);
    return ordered.filter((n) => set.has(n.id));
  }, [ordered, selectedIds]);

  const estimateNodes = selectedNodes.length ? selectedNodes : ordered;

  const estimate = React.useMemo(() => {
    const gb = Math.max(0, Number(estimateGb) || 0);
    const days = Math.max(0, Number(estimateDays) || 0);
    const dayPrice = Math.max(0, Number(resellerStats?.price_per_day || 0));
    const timeAmount = dayPrice * days;

    if (!estimateNodes.length) {
      return {
        nodeCount: 0,
        trafficAmount: 0,
        timeAmount,
        total: timeAmount,
        balanceAfter: resellerStats ? Number(resellerStats.balance || 0) - timeAmount : null,
        mode: estimateMode,
      };
    }

    if (estimateMode === "bundle") {
      const bundlePerGb = Number(resellerStats?.bundle_price_per_gb || 0) > 0 ? Number(resellerStats?.bundle_price_per_gb || 0) : Math.max(0, Number(resellerStats?.price_per_gb || 0));
      const trafficAmount = bundlePerGb * gb;
      const total = trafficAmount + timeAmount;
      return {
        nodeCount: estimateNodes.length,
        trafficAmount,
        timeAmount,
        total,
        balanceAfter: resellerStats ? Number(resellerStats.balance || 0) - total : null,
        mode: estimateMode,
      };
    }

    const trafficAmount = estimateNodes.reduce((acc, n) => acc + effectivePerGb(n) * gb, 0);
    const total = trafficAmount + timeAmount;
    return {
      nodeCount: estimateNodes.length,
      trafficAmount,
      timeAmount,
      total,
      balanceAfter: resellerStats ? Number(resellerStats.balance || 0) - total : null,
      mode: estimateMode,
    };
  }, [estimateDays, estimateGb, estimateMode, estimateNodes, resellerStats]);

  const stats = React.useMemo(() => {
    const total = items.length;
    const defaults = items.filter((x) => x.default_for_reseller).length;
    const visible = items.filter((x) => x.is_visible_in_sub).length;
    const withOverride = items.filter((x) => x.price_per_gb_override != null).length;
    const cheapest = items.length ? Math.min(...items.map((x) => effectivePerGb(x)).filter((x) => Number.isFinite(x))) : 0;
    const totalTags = tagOptions.length;
    return { total, defaults, visible, withOverride, cheapest, totalTags };
  }, [items, tagOptions, resellerStats]);

  const advice = React.useMemo(() => {
    const tips: string[] = [];
    if (!items.length) tips.push("هنوز نودی به حساب شما تخصیص داده نشده است. با ادمین هماهنگ کنید.");
    if (items.length > 0 && items.every((n) => !n.default_for_reseller)) tips.push("برای سرعت فروش، حداقل یک نود پیش‌فرض داشته باشید.");
    if (items.some((n) => !n.is_visible_in_sub)) tips.push("برخی نودها در ساب مخفی هستند؛ فقط برای سناریوهای خاص از این حالت استفاده کنید.");
    if (estimate.balanceAfter != null && estimate.balanceAfter < 0) tips.push("با موجودی فعلی این پکیج قابل اجرا نیست؛ ابتدا کیف پول را شارژ کنید.");
    return tips.slice(0, 3);
  }, [items, estimate.balanceAfter]);

  function toggleNode(id: number, checked: boolean) {
    setSelectedIds((prev) => {
      const set = new Set(prev);
      if (checked) set.add(id);
      else set.delete(id);
      return Array.from(set);
    });
  }

  function selectAllFiltered() {
    setSelectedIds(Array.from(new Set(ordered.map((n) => n.id))));
  }

  function clearSelection() {
    setSelectedIds([]);
  }

  async function copySelectedIds() {
    if (!selectedIds.length) {
      push({ title: "ابتدا نود انتخاب کنید", type: "warning" });
      return;
    }
    const ok = await copyText(selectedIds.join(","));
    push({ title: ok ? "ID نودها کپی شد" : "کپی ناموفق بود", type: ok ? "success" : "error" });
  }

  function openCreateWithSelection() {
    const ids = selectedIds.length ? selectedIds : ordered.map((n) => n.id);
    if (!ids.length) {
      push({ title: "نودی برای ارسال وجود ندارد", type: "warning" });
      return;
    }
    router.push(`/app/users/new?node_mode=manual&node_ids=${ids.join(",")}`);
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="text-xl font-semibold">مرکز انتخاب نود</div>
          <div className="text-sm text-[hsl(var(--fg))]/70">
            این صفحه برای تصمیم‌گیری فروش طراحی شده: انتخاب نود، تخمین قیمت، و ارسال مستقیم انتخاب به ساخت کاربر.
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-2xl border border-emerald-300/40 bg-emerald-500/10 p-3 text-xs text-emerald-900 dark:text-emerald-200">
            <div className="flex items-center gap-2 font-semibold">
              <Shield size={15} />
              حالت امن فعال است
            </div>
            <div className="mt-1 opacity-90">
              آدرس واقعی نودها در این صفحه نمایش داده نمی‌شود تا اطلاعات زیرساخت اصلی محفوظ بماند.
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <div className="rounded-2xl border border-[hsl(var(--border))] p-3">
              <div className="flex items-center justify-between">
                <div className="text-xs text-[hsl(var(--fg))]/70">کل نودها</div>
                <Network size={16} className="opacity-60" />
              </div>
              <div className="mt-1 text-lg font-semibold">{stats.total}</div>
            </div>
            <div className="rounded-2xl border border-[hsl(var(--border))] p-3">
              <div className="flex items-center justify-between">
                <div className="text-xs text-[hsl(var(--fg))]/70">پیش‌فرض</div>
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
                <Sparkles size={16} className="opacity-60" />
              </div>
              <div className="mt-1 text-lg font-semibold">{stats.withOverride}</div>
            </div>
            <div className="rounded-2xl border border-[hsl(var(--border))] p-3">
              <div className="flex items-center justify-between">
                <div className="text-xs text-[hsl(var(--fg))]/70">کمترین قیمت/GB</div>
                <CircleDollarSign size={16} className="opacity-60" />
              </div>
              <div className="mt-1 text-lg font-semibold">{fmtNumber(stats.cheapest || 0)}</div>
            </div>
            <div className="rounded-2xl border border-[hsl(var(--border))] p-3">
              <div className="flex items-center justify-between">
                <div className="text-xs text-[hsl(var(--fg))]/70">تگ‌های فعال</div>
                <Tags size={16} className="opacity-60" />
              </div>
              <div className="mt-1 text-lg font-semibold">{stats.totalTags}</div>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-[1fr,180px,180px,180px,170px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" />
              <Input className="pl-10" value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجو بر اساس نام، کد نود، نوع پنل یا تگ..." />
            </div>

            <select
              className="h-10 rounded-xl border border-[hsl(var(--border))] bg-transparent px-3 text-sm outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
              value={panelFilter}
              onChange={(e) => setPanelFilter(e.target.value)}
            >
              <option value="all">همه پنل‌ها</option>
              <option value="marzban">مرزبان</option>
              <option value="pasarguard">پاسارگارد</option>
              <option value="wg_dashboard">وایرگارد</option>
            </select>

            <select
              className="h-10 rounded-xl border border-[hsl(var(--border))] bg-transparent px-3 text-sm outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
              value={visibleFilter}
              onChange={(e) => setVisibleFilter(e.target.value)}
            >
              <option value="all">همه حالت‌ها</option>
              <option value="visible">نمایش در ساب</option>
              <option value="hidden">مخفی در ساب</option>
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

            <select
              className="h-10 rounded-xl border border-[hsl(var(--border))] bg-transparent px-3 text-sm outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as SortMode)}
            >
              <option value="smart">مرتب‌سازی هوشمند</option>
              <option value="cheap">ارزان‌ترین</option>
              <option value="default">پیش‌فرض‌ها اول</option>
              <option value="name">بر اساس نام</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/40 p-3">
            <div className="text-xs text-[hsl(var(--fg))]/75">{selectedIds.length ? `${selectedIds.length} نود انتخاب شده` : "هیچ نودی انتخاب نشده"}</div>
            <div className="ml-auto flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" className="gap-2" onClick={selectAllFiltered}>
                <CheckCircle2 size={14} /> انتخاب همه نتایج
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={clearSelection}>
                پاک کردن انتخاب
              </Button>
              <Button type="button" variant="outline" size="sm" className="gap-2" onClick={copySelectedIds}>
                <Copy size={14} /> کپی ID نودها
              </Button>
              <Button type="button" size="sm" className="gap-2" onClick={openCreateWithSelection}>
                <WandSparkles size={14} /> ارسال به ساخت کاربر
              </Button>
            </div>
          </div>

          {advice.length ? (
            <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 p-3 text-xs text-[hsl(var(--fg))]/80 space-y-1">
              <div className="font-semibold">پیشنهادهای هوشمند فروش</div>
              {advice.map((tip) => (
                <div key={tip}>• {tip}</div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2 text-lg font-semibold">
            <BarChart3 size={18} />
            ماشین حساب فروش و هزینه
          </div>
          <div className="text-sm text-[hsl(var(--fg))]/70">
            بر اساس {selectedIds.length ? "نودهای انتخاب‌شده" : "فیلتر فعلی"} محاسبه می‌شود. اگر انتخابی نداشته باشید کل نتایج صفحه لحاظ می‌شود.
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-[170px,1fr,1fr]">
            <select
              className="h-10 rounded-xl border border-[hsl(var(--border))] bg-transparent px-3 text-sm outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
              value={estimateMode}
              onChange={(e) => setEstimateMode(e.target.value as EstimateMode)}
            >
              <option value="per_node">مدل Per-Node</option>
              <option value="bundle">مدل Bundle</option>
            </select>

            <div className="space-y-2 rounded-xl border border-[hsl(var(--border))] p-3">
              <div className="text-xs text-[hsl(var(--fg))]/70">حجم (GB)</div>
              <div className="flex flex-wrap gap-2">
                {GB_PRESETS.map((g) => (
                  <Button key={g} type="button" size="sm" variant={estimateGb === g ? "primary" : "outline"} onClick={() => setEstimateGb(g)}>
                    {g}
                  </Button>
                ))}
              </div>
              <Input type="number" min={1} value={estimateGb} onChange={(e) => setEstimateGb(Math.max(1, Number(e.target.value) || 1))} />
            </div>

            <div className="space-y-2 rounded-xl border border-[hsl(var(--border))] p-3">
              <div className="text-xs text-[hsl(var(--fg))]/70">زمان (روز)</div>
              <div className="flex flex-wrap gap-2">
                {DAY_PRESETS.map((d) => (
                  <Button key={d} type="button" size="sm" variant={estimateDays === d ? "primary" : "outline"} onClick={() => setEstimateDays(d)}>
                    {d === 0 ? "بدون زمان" : d}
                  </Button>
                ))}
              </div>
              <Input type="number" min={0} value={estimateDays} onChange={(e) => setEstimateDays(Math.max(0, Number(e.target.value) || 0))} />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <div className="rounded-2xl border border-[hsl(var(--border))] p-3">
              <div className="text-xs text-[hsl(var(--fg))]/70">نودهای مبنا</div>
              <div className="mt-1 text-lg font-semibold">{fmtNumber(estimate.nodeCount)}</div>
            </div>
            <div className="rounded-2xl border border-[hsl(var(--border))] p-3">
              <div className="text-xs text-[hsl(var(--fg))]/70">هزینه ترافیک</div>
              <div className="mt-1 text-lg font-semibold">{fmtNumber(estimate.trafficAmount)}</div>
            </div>
            <div className="rounded-2xl border border-[hsl(var(--border))] p-3">
              <div className="text-xs text-[hsl(var(--fg))]/70">هزینه زمانی</div>
              <div className="mt-1 text-lg font-semibold">{fmtNumber(estimate.timeAmount)}</div>
            </div>
            <div className="rounded-2xl border border-[hsl(var(--border))] p-3">
              <div className="text-xs text-[hsl(var(--fg))]/70">جمع کل</div>
              <div className="mt-1 text-lg font-semibold">{fmtNumber(estimate.total)}</div>
            </div>
            <div className="rounded-2xl border border-[hsl(var(--border))] p-3">
              <div className="text-xs text-[hsl(var(--fg))]/70">موجودی پس از عملیات</div>
              <div className={`mt-1 text-lg font-semibold ${estimate.balanceAfter != null && estimate.balanceAfter < 0 ? "text-red-600" : ""}`}>
                {estimate.balanceAfter == null ? "—" : fmtNumber(estimate.balanceAfter)}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/40 p-3 text-xs text-[hsl(var(--fg))]/75">
            مدل محاسبه: {estimate.mode === "bundle" ? "Bundle (یک‌بار برای کل نودها)" : "Per-Node (برای هر نود جداگانه)"}
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
            <div className="text-lg font-semibold">لیست نودهای در دسترس</div>
          </div>
          <div className="text-sm text-[hsl(var(--fg))]/70">روی موبایل و دسکتاپ واکنش‌گراست و برای تصمیم‌گیری فروش سریع طراحی شده.</div>
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
          ) : ordered.length ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {ordered.map((n) => {
                const selected = selectedIds.includes(n.id);
                const hints = suggestUseCases(n.tags || []);
                return (
                  <article key={n.id} className={`rounded-2xl border p-3 space-y-3 ${selected ? "border-[hsl(var(--accent))] ring-2 ring-[hsl(var(--accent))]/20" : "border-[hsl(var(--border))]"}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-semibold">{n.name}</div>
                        <div className="mt-0.5 text-xs text-[hsl(var(--fg))]/65">{nodeCode(n)}</div>
                      </div>
                      <label className="inline-flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-[hsl(var(--border))]"
                          checked={selected}
                          onChange={(e) => toggleNode(n.id, e.target.checked)}
                        />
                        انتخاب
                      </label>
                    </div>

                    <div className="flex flex-wrap gap-1">
                      <Badge variant={panelBadge(n.panel_type)}>{panelLabel(n.panel_type)}</Badge>
                      {n.default_for_reseller ? <Badge variant="success">پیش‌فرض فروش</Badge> : null}
                      {n.is_visible_in_sub ? <Badge variant="success">نمایش در ساب</Badge> : <Badge variant="warning">مخفی در ساب</Badge>}
                    </div>

                    <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/40 p-2 text-xs">
                      قیمت موثر هر GB: <span className="font-semibold">{fmtNumber(effectivePerGb(n))}</span>
                    </div>

                    <div className="flex flex-wrap gap-1">
                      {(n.tags || []).length ? (n.tags || []).map((tg) => <Badge key={tg} variant="muted">{tg}</Badge>) : <Badge variant="muted">بدون تگ</Badge>}
                    </div>

                    {hints.length ? (
                      <div className="flex flex-wrap gap-1">
                        {hints.map((h) => (
                          <Badge key={h} variant="muted">{h}</Badge>
                        ))}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-[hsl(var(--border))] p-4 text-sm text-[hsl(var(--fg))]/70">
              <div className="flex items-center gap-2">
                <Filter size={16} />
                موردی پیدا نشد. فیلترها را تغییر دهید.
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
