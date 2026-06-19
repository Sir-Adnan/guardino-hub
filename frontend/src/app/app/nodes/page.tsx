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
import { useI18n } from "@/components/i18n-context";

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

function panelLabel(panel: string, lang: "fa" | "en") {
  const p = String(panel || "").toLowerCase();
  if (p === "wg_dashboard") return lang === "fa" ? "وایرگارد" : "WireGuard";
  if (p === "pasarguard") return lang === "fa" ? "پاسارگارد" : "Pasarguard";
  return lang === "fa" ? "مرزبان" : "Marzban";
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

function suggestUseCases(tags: string[], lang: "fa" | "en") {
  const src = (tags || []).map((x) => String(x).toUpperCase());
  const out: string[] = [];
  if (src.some((t) => t.includes("VIP"))) out.push(lang === "fa" ? "کیفیت بالا" : "Premium quality");
  if (src.some((t) => t.includes("IR"))) out.push(lang === "fa" ? "مناسب ایران" : "Good for Iran");
  if (src.some((t) => t.includes("EU"))) out.push(lang === "fa" ? "مناسب اروپا" : "Good for Europe");
  if (src.some((t) => t.includes("GAME") || t.includes("GAM"))) out.push(lang === "fa" ? "مناسب گیم" : "Gaming friendly");
  if (src.some((t) => t.includes("STREAM"))) out.push(lang === "fa" ? "مناسب استریم" : "Streaming friendly");
  return out.slice(0, 3);
}

export default function NodesPage() {
  const router = useRouter();
  const { push } = useToast();
  const { lang } = useI18n();

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

  const copy = React.useMemo(
    () =>
      lang === "en"
        ? {
            title: "Sales Node Management",
            subtitle: "Select, filter, price, and send chosen nodes directly to the user creation form",
            selectedSummary: (count: number) => (count ? `${fmtNumber(count)} selected nodes` : "Ready to choose nodes"),
            centerTitle: "Node Selection Center",
            centerSubtitle:
              "This page is built for sales decisions: pick nodes, estimate pricing, and send the selection straight to user creation.",
            safeTitle: "Safe mode is active",
            safeBody: "Real node addresses are not shown here so core infrastructure details remain protected.",
            totalNodes: "Total nodes",
            defaultNodes: "Default",
            visibleInSub: "Visible in sub",
            overridePrice: "Custom price",
            cheapestPrice: "Lowest price/GB",
            activeTags: "Active tags",
            searchPlaceholder: "Search by name, node code, panel type, or tag...",
            allPanels: "All panels",
            allModes: "All modes",
            visible: "Visible in sub",
            hidden: "Hidden in sub",
            allTags: "All tags",
            sortSmart: "Smart sorting",
            sortCheap: "Cheapest",
            sortDefault: "Defaults first",
            sortName: "By name",
            noSelection: "No node selected",
            selectedNodes: (count: number) => `${count} selected nodes`,
            selectAllResults: "Select all results",
            clearSelection: "Clear selection",
            copyNodeIds: "Copy node IDs",
            sendToCreate: "Send to user creation",
            smartAdviceTitle: "Smart sales tips",
            adviceNoNodes: "No nodes have been assigned to your account yet. Contact the admin.",
            adviceNoDefault: "For faster sales, keep at least one default node.",
            adviceHidden: "Some nodes are hidden in subscriptions; use this mode only for special scenarios.",
            adviceBalance: "Your current balance cannot cover this package. Top up the wallet first.",
            calcTitle: "Sales and Cost Calculator",
            calcSubtitle: (hasSelection: boolean) =>
              `Calculated from ${hasSelection ? "selected nodes" : "the current filter"}. If nothing is selected, all page results are included.`,
            perNodeModel: "Per-Node model",
            bundleModel: "Bundle model",
            trafficGb: "Traffic (GB)",
            durationDays: "Duration (days)",
            noTime: "No time",
            baseNodes: "Base nodes",
            trafficCost: "Traffic cost",
            timeCost: "Time cost",
            totalCost: "Total",
            balanceAfter: "Balance after operation",
            calcMode: (mode: EstimateMode) =>
              mode === "bundle" ? "Calculation model: Bundle (once for all nodes)" : "Calculation model: Per-Node (separately per node)",
            availableTitle: "Available Nodes",
            availableSubtitle: "Responsive on mobile and desktop, designed for quick sales decisions.",
            select: "Select",
            defaultSale: "Sales default",
            effectivePrice: "Effective price per GB",
            noTags: "No tags",
            empty: "No items found. Change the filters.",
            pickNodeFirst: "Select a node first",
            idsCopied: "Node IDs copied",
            copyFailed: "Copy failed",
            noNodeToSend: "No node is available to send",
          }
        : {
            title: "مدیریت نودها برای فروش",
            subtitle: "انتخاب، فیلتر، قیمت‌گذاری و ارسال سریع نودهای منتخب به فرم ساخت کاربر",
            selectedSummary: (count: number) => (count ? `${fmtNumber(count)} نود انتخاب شده` : "آماده انتخاب نود"),
            centerTitle: "مرکز انتخاب نود",
            centerSubtitle: "این صفحه برای تصمیم‌گیری فروش طراحی شده: انتخاب نود، تخمین قیمت، و ارسال مستقیم انتخاب به ساخت کاربر.",
            safeTitle: "حالت امن فعال است",
            safeBody: "آدرس واقعی نودها در این صفحه نمایش داده نمی‌شود تا اطلاعات زیرساخت اصلی محفوظ بماند.",
            totalNodes: "کل نودها",
            defaultNodes: "پیش‌فرض",
            visibleInSub: "نمایش در ساب",
            overridePrice: "قیمت اختصاصی",
            cheapestPrice: "کمترین قیمت/GB",
            activeTags: "تگ‌های فعال",
            searchPlaceholder: "جستجو بر اساس نام، کد نود، نوع پنل یا تگ...",
            allPanels: "همه پنل‌ها",
            allModes: "همه حالت‌ها",
            visible: "نمایش در ساب",
            hidden: "مخفی در ساب",
            allTags: "همه تگ‌ها",
            sortSmart: "مرتب‌سازی هوشمند",
            sortCheap: "ارزان‌ترین",
            sortDefault: "پیش‌فرض‌ها اول",
            sortName: "بر اساس نام",
            noSelection: "هیچ نودی انتخاب نشده",
            selectedNodes: (count: number) => `${count} نود انتخاب شده`,
            selectAllResults: "انتخاب همه نتایج",
            clearSelection: "پاک کردن انتخاب",
            copyNodeIds: "کپی ID نودها",
            sendToCreate: "ارسال به ساخت کاربر",
            smartAdviceTitle: "پیشنهادهای هوشمند فروش",
            adviceNoNodes: "هنوز نودی به حساب شما تخصیص داده نشده است. با ادمین هماهنگ کنید.",
            adviceNoDefault: "برای سرعت فروش، حداقل یک نود پیش‌فرض داشته باشید.",
            adviceHidden: "برخی نودها در ساب مخفی هستند؛ فقط برای سناریوهای خاص از این حالت استفاده کنید.",
            adviceBalance: "با موجودی فعلی این پکیج قابل اجرا نیست؛ ابتدا کیف پول را شارژ کنید.",
            calcTitle: "ماشین حساب فروش و هزینه",
            calcSubtitle: (hasSelection: boolean) =>
              `بر اساس ${hasSelection ? "نودهای انتخاب‌شده" : "فیلتر فعلی"} محاسبه می‌شود. اگر انتخابی نداشته باشید کل نتایج صفحه لحاظ می‌شود.`,
            perNodeModel: "مدل Per-Node",
            bundleModel: "مدل Bundle",
            trafficGb: "حجم (GB)",
            durationDays: "زمان (روز)",
            noTime: "بدون زمان",
            baseNodes: "نودهای مبنا",
            trafficCost: "هزینه ترافیک",
            timeCost: "هزینه زمانی",
            totalCost: "جمع کل",
            balanceAfter: "موجودی پس از عملیات",
            calcMode: (mode: EstimateMode) =>
              mode === "bundle" ? "مدل محاسبه: Bundle (یک‌بار برای کل نودها)" : "مدل محاسبه: Per-Node (برای هر نود جداگانه)",
            availableTitle: "لیست نودهای در دسترس",
            availableSubtitle: "روی موبایل و دسکتاپ واکنش‌گراست و برای تصمیم‌گیری فروش سریع طراحی شده.",
            select: "انتخاب",
            defaultSale: "پیش‌فرض فروش",
            effectivePrice: "قیمت موثر هر GB",
            noTags: "بدون تگ",
            empty: "موردی پیدا نشد. فیلترها را تغییر دهید.",
            pickNodeFirst: "ابتدا نود انتخاب کنید",
            idsCopied: "ID نودها کپی شد",
            copyFailed: "کپی ناموفق بود",
            noNodeToSend: "نودی برای ارسال وجود ندارد",
          },
    [lang]
  );

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
    if (!items.length) tips.push(copy.adviceNoNodes);
    if (items.length > 0 && items.every((n) => !n.default_for_reseller)) tips.push(copy.adviceNoDefault);
    if (items.some((n) => !n.is_visible_in_sub)) tips.push(copy.adviceHidden);
    if (estimate.balanceAfter != null && estimate.balanceAfter < 0) tips.push(copy.adviceBalance);
    return tips.slice(0, 3);
  }, [copy, items, estimate.balanceAfter]);

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
      push({ title: copy.pickNodeFirst, type: "warning" });
      return;
    }
    const ok = await copyText(selectedIds.join(","));
    push({ title: ok ? copy.idsCopied : copy.copyFailed, type: ok ? "success" : "error" });
  }

  function openCreateWithSelection() {
    const ids = selectedIds.length ? selectedIds : ordered.map((n) => n.id);
    if (!ids.length) {
      push({ title: copy.noNodeToSend, type: "warning" });
      return;
    }
    router.push(`/app/users/new?node_mode=manual&node_ids=${ids.join(",")}`);
  }
  const selectClass =
    "h-10 rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(155deg,hsl(var(--surface-input-1))_0%,hsl(var(--surface-input-2))_58%,hsl(var(--surface-input-3))_100%)] px-3 text-sm outline-none transition-all duration-200 hover:border-[hsl(var(--accent)/0.35)] focus:ring-2 focus:ring-[hsl(var(--accent)/0.35)]";
  const metricCardClass =
    "rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(155deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] p-3 shadow-[0_10px_22px_-20px_hsl(var(--fg)/0.6)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[hsl(var(--accent)/0.35)]";

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(110deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] p-4 shadow-[0_15px_28px_-20px_hsl(var(--fg)/0.35)] sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] px-3 py-1 text-xs text-[hsl(var(--fg))]/75">
              <Network size={13} />
              Node Routing Studio
            </div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight">{copy.title}</h1>
            <p className="mt-1 text-sm text-[hsl(var(--fg))]/70">{copy.subtitle}</p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(130deg,hsl(var(--accent)/0.16),hsl(var(--surface-card-1)))] px-3 py-2 text-xs font-medium text-[hsl(var(--fg))]/80">
            <Sparkles size={14} />
            {copy.selectedSummary(selectedIds.length)}
          </div>
        </div>
      </section>

      <Card className="overflow-hidden">
        <CardHeader>
          <div className="text-xl font-semibold">{copy.centerTitle}</div>
          <div className="text-sm text-[hsl(var(--fg))]/70">
            {copy.centerSubtitle}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-2xl border border-emerald-300/45 bg-[linear-gradient(145deg,rgba(16,185,129,0.16),rgba(16,185,129,0.07))] p-3 text-xs text-emerald-900 shadow-[0_10px_22px_-20px_rgba(16,185,129,0.9)] dark:text-emerald-200">
            <div className="flex items-center gap-2 font-semibold">
              <Shield size={15} />
              {copy.safeTitle}
            </div>
            <div className="mt-1 opacity-90">
              {copy.safeBody}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <div className={metricCardClass}>
              <div className="flex items-center justify-between">
                <div className="text-xs text-[hsl(var(--fg))]/70">{copy.totalNodes}</div>
                <Network size={16} className="opacity-60" />
              </div>
              <div className="mt-1 text-lg font-semibold">{stats.total}</div>
            </div>
            <div className={metricCardClass}>
              <div className="flex items-center justify-between">
                <div className="text-xs text-[hsl(var(--fg))]/70">{copy.defaultNodes}</div>
                <Star size={16} className="opacity-60" />
              </div>
              <div className="mt-1 text-lg font-semibold">{stats.defaults}</div>
            </div>
            <div className={metricCardClass}>
              <div className="flex items-center justify-between">
                <div className="text-xs text-[hsl(var(--fg))]/70">{copy.visibleInSub}</div>
                <ShieldCheck size={16} className="opacity-60" />
              </div>
              <div className="mt-1 text-lg font-semibold">{stats.visible}</div>
            </div>
            <div className={metricCardClass}>
              <div className="flex items-center justify-between">
                <div className="text-xs text-[hsl(var(--fg))]/70">{copy.overridePrice}</div>
                <Sparkles size={16} className="opacity-60" />
              </div>
              <div className="mt-1 text-lg font-semibold">{stats.withOverride}</div>
            </div>
            <div className={metricCardClass}>
              <div className="flex items-center justify-between">
                <div className="text-xs text-[hsl(var(--fg))]/70">{copy.cheapestPrice}</div>
                <CircleDollarSign size={16} className="opacity-60" />
              </div>
              <div className="mt-1 text-lg font-semibold">{fmtNumber(stats.cheapest || 0)}</div>
            </div>
            <div className={metricCardClass}>
              <div className="flex items-center justify-between">
                <div className="text-xs text-[hsl(var(--fg))]/70">{copy.activeTags}</div>
                <Tags size={16} className="opacity-60" />
              </div>
              <div className="mt-1 text-lg font-semibold">{stats.totalTags}</div>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-[1fr,180px,180px,180px,170px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" />
              <Input className="pl-10" value={q} onChange={(e) => setQ(e.target.value)} placeholder={copy.searchPlaceholder} />
            </div>

            <select
              className={selectClass}
              value={panelFilter}
              onChange={(e) => setPanelFilter(e.target.value)}
            >
              <option value="all">{copy.allPanels}</option>
              <option value="marzban">{panelLabel("marzban", lang)}</option>
              <option value="pasarguard">{panelLabel("pasarguard", lang)}</option>
              <option value="wg_dashboard">{panelLabel("wg_dashboard", lang)}</option>
            </select>

            <select
              className={selectClass}
              value={visibleFilter}
              onChange={(e) => setVisibleFilter(e.target.value)}
            >
              <option value="all">{copy.allModes}</option>
              <option value="visible">{copy.visible}</option>
              <option value="hidden">{copy.hidden}</option>
            </select>

            <select
              className={selectClass}
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
            >
              <option value="">{copy.allTags}</option>
              {tagOptions.map((tg) => (
                <option key={tg} value={tg}>
                  {tg}
                </option>
              ))}
            </select>

            <select
              className={selectClass}
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as SortMode)}
            >
              <option value="smart">{copy.sortSmart}</option>
              <option value="cheap">{copy.sortCheap}</option>
              <option value="default">{copy.sortDefault}</option>
              <option value="name">{copy.sortName}</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(145deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] p-3 shadow-[0_10px_22px_-18px_hsl(var(--fg)/0.5)]">
            <div className="text-xs text-[hsl(var(--fg))]/75">{selectedIds.length ? copy.selectedNodes(selectedIds.length) : copy.noSelection}</div>
            <div className="ml-auto flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" className="gap-2" onClick={selectAllFiltered}>
                <CheckCircle2 size={14} /> {copy.selectAllResults}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={clearSelection}>
                {copy.clearSelection}
              </Button>
              <Button type="button" variant="outline" size="sm" className="gap-2" onClick={copySelectedIds}>
                <Copy size={14} /> {copy.copyNodeIds}
              </Button>
              <Button type="button" size="sm" className="gap-2" onClick={openCreateWithSelection}>
                <WandSparkles size={14} /> {copy.sendToCreate}
              </Button>
            </div>
          </div>

          {advice.length ? (
            <div className="space-y-1 rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(145deg,hsl(var(--surface-page-glow-2)/0.15),hsl(var(--surface-card-1))_85%)] p-3 text-xs text-[hsl(var(--fg))]/80">
              <div className="font-semibold">{copy.smartAdviceTitle}</div>
              {advice.map((tip) => (
                <div key={tip}>• {tip}</div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>
          <div className="flex items-center gap-2 text-lg font-semibold">
            <BarChart3 size={18} />
            {copy.calcTitle}
          </div>
          <div className="text-sm text-[hsl(var(--fg))]/70">
            {copy.calcSubtitle(Boolean(selectedIds.length))}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-[170px,1fr,1fr]">
            <select
              className={selectClass}
              value={estimateMode}
              onChange={(e) => setEstimateMode(e.target.value as EstimateMode)}
            >
              <option value="per_node">{copy.perNodeModel}</option>
              <option value="bundle">{copy.bundleModel}</option>
            </select>

            <div className="space-y-2 rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(155deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] p-3">
              <div className="text-xs text-[hsl(var(--fg))]/70">{copy.trafficGb}</div>
              <div className="flex flex-wrap gap-2">
                {GB_PRESETS.map((g) => (
                  <Button key={g} type="button" size="sm" variant={estimateGb === g ? "primary" : "outline"} onClick={() => setEstimateGb(g)}>
                    {g}
                  </Button>
                ))}
              </div>
              <Input type="number" min={1} value={estimateGb} onChange={(e) => setEstimateGb(Math.max(1, Number(e.target.value) || 1))} />
            </div>

            <div className="space-y-2 rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(155deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] p-3">
              <div className="text-xs text-[hsl(var(--fg))]/70">{copy.durationDays}</div>
              <div className="flex flex-wrap gap-2">
                {DAY_PRESETS.map((d) => (
                  <Button key={d} type="button" size="sm" variant={estimateDays === d ? "primary" : "outline"} onClick={() => setEstimateDays(d)}>
                    {d === 0 ? copy.noTime : d}
                  </Button>
                ))}
              </div>
              <Input type="number" min={0} value={estimateDays} onChange={(e) => setEstimateDays(Math.max(0, Number(e.target.value) || 0))} />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <div className={metricCardClass}>
              <div className="text-xs text-[hsl(var(--fg))]/70">{copy.baseNodes}</div>
              <div className="mt-1 text-lg font-semibold">{fmtNumber(estimate.nodeCount)}</div>
            </div>
            <div className={metricCardClass}>
              <div className="text-xs text-[hsl(var(--fg))]/70">{copy.trafficCost}</div>
              <div className="mt-1 text-lg font-semibold">{fmtNumber(estimate.trafficAmount)}</div>
            </div>
            <div className={metricCardClass}>
              <div className="text-xs text-[hsl(var(--fg))]/70">{copy.timeCost}</div>
              <div className="mt-1 text-lg font-semibold">{fmtNumber(estimate.timeAmount)}</div>
            </div>
            <div className={metricCardClass}>
              <div className="text-xs text-[hsl(var(--fg))]/70">{copy.totalCost}</div>
              <div className="mt-1 text-lg font-semibold">{fmtNumber(estimate.total)}</div>
            </div>
            <div className={metricCardClass}>
              <div className="text-xs text-[hsl(var(--fg))]/70">{copy.balanceAfter}</div>
              <div className={`mt-1 text-lg font-semibold ${estimate.balanceAfter != null && estimate.balanceAfter < 0 ? "text-red-600" : ""}`}>
                {estimate.balanceAfter == null ? "—" : fmtNumber(estimate.balanceAfter)}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(130deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-page-glow-1)/0.14)_100%)] p-3 text-xs text-[hsl(var(--fg))]/75">
            {copy.calcMode(estimate.mode)}
          </div>
        </CardContent>
      </Card>

      {err ? (
        <Card>
          <CardContent className="pt-6 text-sm text-red-600">{err}</CardContent>
        </Card>
      ) : null}

      <Card className="overflow-hidden">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Layers size={18} />
            <div className="text-lg font-semibold">{copy.availableTitle}</div>
          </div>
          <div className="text-sm text-[hsl(var(--fg))]/70">{copy.availableSubtitle}</div>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="space-y-2 rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(150deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] p-3">
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
                const hints = suggestUseCases(n.tags || [], lang);
                return (
                  <article
                    key={n.id}
                    className={`space-y-3 rounded-2xl border bg-[linear-gradient(155deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] p-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-[hsl(var(--accent)/0.35)] ${
                      selected ? "border-[hsl(var(--accent))] ring-2 ring-[hsl(var(--accent))]/20" : "border-[hsl(var(--border))]"
                    }`}
                  >
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
                        {copy.select}
                      </label>
                    </div>

                    <div className="flex flex-wrap gap-1">
                      <Badge variant={panelBadge(n.panel_type)}>{panelLabel(n.panel_type, lang)}</Badge>
                      {n.default_for_reseller ? <Badge variant="success">{copy.defaultSale}</Badge> : null}
                      {n.is_visible_in_sub ? <Badge variant="success">{copy.visible}</Badge> : <Badge variant="warning">{copy.hidden}</Badge>}
                    </div>

                    <div className="rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(130deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-page-glow-1)/0.12)_100%)] p-2 text-xs">
                      {copy.effectivePrice}: <span className="font-semibold">{fmtNumber(effectivePerGb(n))}</span>
                    </div>

                    <div className="flex flex-wrap gap-1">
                      {(n.tags || []).length ? (n.tags || []).map((tg) => <Badge key={tg} variant="muted">{tg}</Badge>) : <Badge variant="muted">{copy.noTags}</Badge>}
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
                {copy.empty}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
