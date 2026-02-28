"use client";

import * as React from "react";
import {
  Activity,
  CheckCircle2,
  Globe,
  Layers,
  Pencil,
  PlugZap,
  Power,
  RefreshCcw,
  Search,
  Shield,
  ShieldOff,
  Wrench,
  XCircle,
} from "lucide-react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ConfirmModal } from "@/components/ui/confirm";
import { Pagination } from "@/components/ui/pagination";
import { Skeleton } from "@/components/ui/skeleton";
import { HelpTip } from "@/components/ui/help-tip";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/components/i18n-context";
import { apiFetch } from "@/lib/api";

type NodeOut = {
  id: number;
  name: string;
  panel_type: string;
  base_url: string;
  credentials: Record<string, unknown>;
  tags: string[];
  is_enabled: boolean;
  is_visible_in_sub: boolean;
};

type NodeList = {
  items: NodeOut[];
  total: number;
};

type TestState = {
  ok: boolean;
  detail: string;
  checkedAt: number;
};

const TAG_SUGGESTIONS = ["DEFAULT_POOL", "VIP_POOL", "IR", "EU", "WIREGUARD"];

function defaultCredsForPanel(panel: string): string {
  if (panel === "wg_dashboard") {
    return JSON.stringify(
      {
        apikey: "YOUR_WG_DASHBOARD_API_KEY",
        configuration_name: "wg0",
        verify_ssl: true,
      },
      null,
      2
    );
  }
  return JSON.stringify(
    {
      username: "admin",
      password: "pass",
    },
    null,
    2
  );
}

function panelLabel(panel: string): string {
  if (panel === "wg_dashboard") return "WireGuard";
  if (panel === "pasarguard") return "Pasarguard";
  return "Marzban";
}

function panelBadgeVariant(panel: string): "muted" | "success" | "warning" {
  if (panel === "wg_dashboard") return "success";
  if (panel === "pasarguard") return "warning";
  return "muted";
}

function fmtCheckedAt(ts: number): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "-";
  }
}

export default function AdminNodesPage() {
  const { push } = useToast();
  const { t } = useI18n();

  const [nodes, setNodes] = React.useState<NodeOut[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [listErr, setListErr] = React.useState<string | null>(null);

  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(24);

  const [q, setQ] = React.useState("");
  const [panelFilter, setPanelFilter] = React.useState("all");
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [visibleFilter, setVisibleFilter] = React.useState("all");
  const [tagFilter, setTagFilter] = React.useState("");

  const [editingId, setEditingId] = React.useState<number | null>(null);
  const [name, setName] = React.useState("");
  const [panelType, setPanelType] = React.useState("marzban");
  const [baseUrl, setBaseUrl] = React.useState("");
  const [tags, setTags] = React.useState("");
  const [creds, setCreds] = React.useState(defaultCredsForPanel("marzban"));
  const [enabled, setEnabled] = React.useState(true);
  const [visibleInSub, setVisibleInSub] = React.useState(true);

  const [formBusy, setFormBusy] = React.useState(false);
  const [actionBusyId, setActionBusyId] = React.useState<number | null>(null);
  const [confirmDisable, setConfirmDisable] = React.useState<NodeOut | null>(null);

  const [tests, setTests] = React.useState<Record<number, TestState>>({});

  function resetForm() {
    setEditingId(null);
    setName("");
    setPanelType("marzban");
    setBaseUrl("");
    setTags("");
    setCreds(defaultCredsForPanel("marzban"));
    setEnabled(true);
    setVisibleInSub(true);
  }

  function parseCreds(): Record<string, unknown> {
    try {
      const parsed = JSON.parse(creds || "{}");
      return (parsed || {}) as Record<string, unknown>;
    } catch {
      throw new Error(t("adminNodes.credsInvalid"));
    }
  }

  function normalizeTagsInput(raw: string): string[] {
    return raw
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  }

  function addTag(tag: string) {
    const current = normalizeTagsInput(tags);
    if (current.includes(tag)) return;
    setTags([...current, tag].join(", "));
  }

  function prettifyCreds() {
    try {
      const parsed = JSON.parse(creds || "{}");
      setCreds(JSON.stringify(parsed || {}, null, 2));
    } catch {
      push({ title: t("common.error"), desc: t("adminNodes.credsInvalid"), type: "error" });
    }
  }

  async function load(nextPage: number = page, nextPageSize: number = pageSize) {
    setLoading(true);
    setListErr(null);
    try {
      const offset = (nextPage - 1) * nextPageSize;
      const res = await apiFetch<NodeList>(`/api/v1/admin/nodes?offset=${offset}&limit=${nextPageSize}`);
      setNodes(res.items || []);
      setTotal(res.total || 0);

      const safeTotal = res.total || 0;
      if ((res.items || []).length === 0 && safeTotal > 0 && offset >= safeTotal) {
        const lastPage = Math.max(1, Math.ceil(safeTotal / nextPageSize));
        if (lastPage !== nextPage) setPage(lastPage);
      }
    } catch (e: any) {
      const message = String(e.message || e);
      setListErr(message);
      push({ title: t("common.error"), desc: message, type: "error" });
    } finally {
      setLoading(false);
    }
  }

  async function createOrSave() {
    if (!name.trim()) {
      push({ title: t("common.error"), desc: `${t("adminNodes.name")} is required`, type: "error" });
      return;
    }
    if (!baseUrl.trim()) {
      push({ title: t("common.error"), desc: `${t("adminNodes.baseUrl")} is required`, type: "error" });
      return;
    }

    setFormBusy(true);
    try {
      const payload = {
        name: name.trim(),
        panel_type: panelType,
        base_url: baseUrl.trim(),
        credentials: parseCreds(),
        tags: normalizeTagsInput(tags),
        is_enabled: enabled,
        is_visible_in_sub: visibleInSub,
      };

      if (editingId == null) {
        const res = await apiFetch<NodeOut>("/api/v1/admin/nodes", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        push({ title: t("adminNodes.created"), desc: `ID: ${res.id}`, type: "success" });
        resetForm();
        setQ("");
        if (page !== 1) setPage(1);
        await load(1, pageSize);
        return;
      }

      const res = await apiFetch<NodeOut>(`/api/v1/admin/nodes/${editingId}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      push({ title: t("adminNodes.saved"), desc: `ID: ${res.id}`, type: "success" });
      resetForm();
      await load(page, pageSize);
    } catch (e: any) {
      push({ title: t("common.error"), desc: String(e.message || e), type: "error" });
    } finally {
      setFormBusy(false);
    }
  }

  async function testNode(id: number) {
    setActionBusyId(id);
    try {
      const res = await apiFetch<{ ok: boolean; detail: string }>(`/api/v1/admin/nodes/${id}/test-connection`, { method: "POST" });
      setTests((prev) => ({
        ...prev,
        [id]: {
          ok: !!res.ok,
          detail: String(res.detail || ""),
          checkedAt: Date.now(),
        },
      }));
      push({ title: res.ok ? "OK" : "FAIL", desc: String(res.detail || ""), type: res.ok ? "success" : "error" });
    } catch (e: any) {
      push({ title: t("common.error"), desc: String(e.message || e), type: "error" });
    } finally {
      setActionBusyId(null);
    }
  }

  async function disableNode(id: number) {
    setActionBusyId(id);
    try {
      const res = await apiFetch<{ is_enabled: boolean }>(`/api/v1/admin/nodes/${id}`, { method: "DELETE" });
      push({ title: t("adminNodes.disabled"), desc: `enabled=${res.is_enabled}`, type: "success" });
      await load(page, pageSize);
    } catch (e: any) {
      push({ title: t("common.error"), desc: String(e.message || e), type: "error" });
    } finally {
      setActionBusyId(null);
    }
  }

  async function patchNode(id: number, patch: Partial<NodeOut>) {
    setActionBusyId(id);
    try {
      await apiFetch<NodeOut>(`/api/v1/admin/nodes/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      await load(page, pageSize);
    } catch (e: any) {
      push({ title: t("common.error"), desc: String(e.message || e), type: "error" });
    } finally {
      setActionBusyId(null);
    }
  }

  function startEdit(n: NodeOut) {
    setEditingId(n.id);
    setName(n.name);
    setPanelType(n.panel_type);
    setBaseUrl(n.base_url);
    setTags((n.tags || []).join(", "));
    setCreds(JSON.stringify(n.credentials || {}, null, 2) || "{}");
    setEnabled(n.is_enabled);
    setVisibleInSub(n.is_visible_in_sub);

    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  const allTags = React.useMemo(() => {
    const set = new Set<string>();
    nodes.forEach((n) => (n.tags || []).forEach((tg) => set.add(String(tg))));
    return Array.from(set).sort();
  }, [nodes]);

  const filtered = React.useMemo(() => {
    const qq = q.trim().toLowerCase();
    const tf = tagFilter.trim().toLowerCase();

    return nodes.filter((n) => {
      if (panelFilter !== "all" && n.panel_type !== panelFilter) return false;
      if (statusFilter === "enabled" && !n.is_enabled) return false;
      if (statusFilter === "disabled" && n.is_enabled) return false;
      if (visibleFilter === "visible" && !n.is_visible_in_sub) return false;
      if (visibleFilter === "hidden" && n.is_visible_in_sub) return false;
      if (tf && !(n.tags || []).some((tg) => String(tg).toLowerCase().includes(tf))) return false;
      if (!qq) return true;

      const hay = `${n.id} ${n.name} ${n.panel_type} ${n.base_url} ${(n.tags || []).join(" ")}`.toLowerCase();
      return hay.includes(qq);
    });
  }, [nodes, panelFilter, q, statusFilter, tagFilter, visibleFilter]);

  const stats = React.useMemo(() => {
    const enabledCount = nodes.filter((n) => n.is_enabled).length;
    const visibleCount = nodes.filter((n) => n.is_visible_in_sub).length;
    const wgCount = nodes.filter((n) => n.panel_type === "wg_dashboard").length;
    const testedOk = Object.values(tests).filter((x) => x.ok).length;
    return { enabledCount, visibleCount, wgCount, testedOk };
  }, [nodes, tests]);
  const selectClass =
    "h-10 rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(155deg,hsl(var(--surface-input-1))_0%,hsl(var(--surface-input-2))_58%,hsl(var(--surface-input-3))_100%)] px-3 text-sm outline-none transition-all duration-200 hover:border-[hsl(var(--accent)/0.35)] focus:ring-2 focus:ring-[hsl(var(--accent)/0.35)]";
  const metricCardClass =
    "rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(155deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] p-3 shadow-[0_10px_22px_-20px_hsl(var(--fg)/0.6)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[hsl(var(--accent)/0.35)]";

  React.useEffect(() => {
    load(page, pageSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize]);

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(110deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] p-4 shadow-[0_15px_28px_-20px_hsl(var(--fg)/0.35)] sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] px-3 py-1 text-xs text-[hsl(var(--fg))]/75">
              <Shield size={13} />
              Node Infrastructure
            </div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight">{t("adminNodes.title")}</h1>
            <p className="mt-1 text-sm text-[hsl(var(--fg))]/70">{t("adminNodes.subtitle")}</p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(130deg,hsl(var(--accent)/0.16),hsl(var(--surface-card-1)))] px-3 py-2 text-xs font-medium text-[hsl(var(--fg))]/80">
            <Activity size={14} />
            {total} نود ثبت‌شده
          </div>
        </div>
      </section>

      <Card className="overflow-hidden">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xl font-semibold">کنترل سریع نودها</div>
              <div className="text-sm text-[hsl(var(--fg))]/70">فیلتر، وضعیت لحظه‌ای و مدیریت نمایش نودها در ساب</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" className="gap-2" onClick={() => load(page, pageSize)} disabled={loading}>
                <RefreshCcw size={16} /> {t("common.reload")}
              </Button>
              {editingId != null ? (
                <Button type="button" variant="outline" onClick={resetForm}>
                  {t("common.cancel")}
                </Button>
              ) : null}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className={metricCardClass}>
              <div className="flex items-center justify-between">
                <div className="text-xs text-[hsl(var(--fg))]/70">کل نودها</div>
                <Layers size={16} className="opacity-60" />
              </div>
              <div className="mt-1 text-lg font-semibold">{total}</div>
            </div>
            <div className={metricCardClass}>
              <div className="flex items-center justify-between">
                <div className="text-xs text-[hsl(var(--fg))]/70">فعال</div>
                <Shield size={16} className="opacity-60" />
              </div>
              <div className="mt-1 text-lg font-semibold">{stats.enabledCount}</div>
            </div>
            <div className={metricCardClass}>
              <div className="flex items-center justify-between">
                <div className="text-xs text-[hsl(var(--fg))]/70">نمایش در ساب</div>
                <Globe size={16} className="opacity-60" />
              </div>
              <div className="mt-1 text-lg font-semibold">{stats.visibleCount}</div>
            </div>
            <div className={metricCardClass}>
              <div className="flex items-center justify-between">
                <div className="text-xs text-[hsl(var(--fg))]/70">وایرگارد / تست سالم</div>
                <Activity size={16} className="opacity-60" />
              </div>
              <div className="mt-1 text-lg font-semibold">
                {stats.wgCount} / {stats.testedOk}
              </div>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-[1fr,180px,180px,180px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" />
              <Input className="pl-10" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("common.search")} />
            </div>

            <select
              className={selectClass}
              value={panelFilter}
              onChange={(e) => setPanelFilter(e.target.value)}
            >
              <option value="all">همه پنل‌ها</option>
              <option value="marzban">Marzban</option>
              <option value="pasarguard">Pasarguard</option>
              <option value="wg_dashboard">WireGuard</option>
            </select>

            <select
              className={selectClass}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">همه وضعیت‌ها</option>
              <option value="enabled">فعال</option>
              <option value="disabled">غیرفعال</option>
            </select>

            <select
              className={selectClass}
              value={visibleFilter}
              onChange={(e) => setVisibleFilter(e.target.value)}
            >
              <option value="all">همه حالت‌ها</option>
              <option value="visible">نمایش در ساب</option>
              <option value="hidden">مخفی در ساب</option>
            </select>
          </div>

          <div className="grid gap-2 sm:grid-cols-[220px,1fr]">
            <select
              className={selectClass}
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
            >
              <option value="">همه تگ‌ها</option>
              {allTags.map((tg) => (
                <option key={tg} value={tg}>
                  {tg}
                </option>
              ))}
            </select>
            <div className="flex items-center rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(130deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-page-glow-2)/0.12)_100%)] px-3 text-xs text-[hsl(var(--fg))]/70">
              فیلترها روی داده‌های همین صفحه اعمال می‌شوند. برای کل لیست از صفحه‌بندی استفاده کنید.
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>
          <div className="flex items-center gap-2 text-lg font-semibold">
            <Wrench size={18} />
            {editingId == null ? "ایجاد نود جدید" : `ویرایش نود #${editingId}`}
          </div>
          <div className="text-sm text-[hsl(var(--fg))]/70">
            اتصال پنل، سیاست نمایش در ساب و تگ‌ها را مدیریت کنید. اطلاعات اتصال به‌صورت JSON ذخیره می‌شود.
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm flex items-center gap-2">
                {t("adminNodes.name")} <HelpTip text={t("adminNodes.help.name")} />
              </label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً Node-A" />
            </div>

            <div className="space-y-2">
              <label className="text-sm flex items-center gap-2">
                {t("adminNodes.panelType")} <HelpTip text={t("adminNodes.help.panelType")} />
              </label>
              <select
                className={`w-full ${selectClass}`}
                value={panelType}
                onChange={(e) => {
                  const next = e.target.value;
                  setPanelType(next);
                  if (editingId == null) setCreds(defaultCredsForPanel(next));
                }}
              >
                <option value="marzban">Marzban</option>
                <option value="pasarguard">Pasarguard</option>
                <option value="wg_dashboard">WireGuard Dashboard</option>
              </select>
            </div>

            <div className="space-y-2 md:col-span-2">
              <label className="text-sm flex items-center gap-2">
                {t("adminNodes.baseUrl")} <HelpTip text={t("adminNodes.help.baseUrl")} />
              </label>
              <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://panel.example.com" />
            </div>

            <div className="space-y-2 md:col-span-2">
              <label className="text-sm flex items-center gap-2">
                {t("adminNodes.tags")} <HelpTip text={t("adminNodes.help.tags")} />
              </label>
              <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="DEFAULT_POOL, VIP_POOL" />
              <div className="flex flex-wrap gap-2">
                {TAG_SUGGESTIONS.map((tg) => (
                  <button
                    key={tg}
                    type="button"
                    className="rounded-lg border border-[hsl(var(--border))] bg-[linear-gradient(130deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] px-2 py-1 text-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-[hsl(var(--accent)/0.35)]"
                    onClick={() => addTag(tg)}
                  >
                    + {tg}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2 md:col-span-2">
              <label className="text-sm flex items-center gap-2">
                {t("adminNodes.credentials")} <HelpTip text={t("adminNodes.help.credentials")} />
              </label>
              <textarea
                className="min-h-[150px] w-full rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(155deg,hsl(var(--surface-input-1))_0%,hsl(var(--surface-input-3))_100%)] px-3 py-2 text-sm outline-none transition-all duration-200 hover:border-[hsl(var(--accent)/0.35)] focus:border-[hsl(var(--accent)/0.45)] focus:ring-2 focus:ring-[hsl(var(--accent)/0.32)]"
                value={creds}
                onChange={(e) => setCreds(e.target.value)}
                spellCheck={false}
              />
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setCreds(defaultCredsForPanel(panelType))}>
                  الگوی آماده
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={prettifyCreds}>
                  فرمت JSON
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm">{t("adminNodes.enabled")}</label>
              <div className="flex items-center gap-3 rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(150deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] p-3">
                <Switch checked={enabled} onCheckedChange={setEnabled} />
                <div className="text-sm text-[hsl(var(--fg))]/80">در صورت غیرفعال بودن، روی این نود کاربری ساخته یا مدیریت نمی‌شود.</div>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm">{t("adminNodes.visibleInSub")}</label>
              <div className="flex items-center gap-3 rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(150deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] p-3">
                <Switch checked={visibleInSub} onCheckedChange={setVisibleInSub} />
                <div className="text-sm text-[hsl(var(--fg))]/80">اگر خاموش باشد، لینک این نود در ساب کاربران نمایش داده نمی‌شود.</div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={createOrSave} disabled={formBusy}>
              {editingId == null ? t("adminNodes.create") : t("adminNodes.save")}
            </Button>
            <Button type="button" variant="outline" onClick={resetForm} disabled={formBusy}>
              پاکسازی فرم
            </Button>
          </div>
        </CardContent>
      </Card>

      {listErr ? (
        <Card>
          <CardContent className="pt-6 text-sm text-red-600">{listErr}</CardContent>
        </Card>
      ) : null}

      <Card className="overflow-hidden">
        <CardHeader>
          <div className="text-lg font-semibold">لیست نودها</div>
          <div className="text-sm text-[hsl(var(--fg))]/70">چیدمان کارت‌ها کاملا واکنش‌گراست و در موبایل/دسکتاپ بهینه نمایش داده می‌شود.</div>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="space-y-2 rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(150deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] p-3">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-2/3" />
                  <Skeleton className="h-8 w-full" />
                </div>
              ))}
            </div>
          ) : filtered.length ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {filtered.map((n) => {
                const test = tests[n.id];
                const busy = actionBusyId === n.id;
                return (
                  <article key={n.id} className="space-y-3 rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(155deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] p-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-[hsl(var(--accent)/0.35)]">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-semibold">{n.name}</div>
                        <div className="mt-0.5 text-xs text-[hsl(var(--fg))]/65">#{n.id}</div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1">
                        <Badge variant={panelBadgeVariant(n.panel_type)}>{panelLabel(n.panel_type)}</Badge>
                        <Badge variant={n.is_enabled ? "success" : "warning"}>{n.is_enabled ? "فعال" : "غیرفعال"}</Badge>
                      </div>
                    </div>

                    <div className="break-all rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(130deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-page-glow-1)/0.14)_100%)] p-2 text-xs">{n.base_url}</div>

                    <div className="flex flex-wrap gap-1">
                      {(n.tags || []).length ? (n.tags || []).map((tg) => <Badge key={tg} variant="muted">{tg}</Badge>) : <Badge variant="muted">بدون تگ</Badge>}
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(145deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] p-2">
                        <div className="text-[11px] text-[hsl(var(--fg))]/65">وضعیت نود</div>
                        <div className="mt-1 flex items-center justify-between">
                          <div className="text-xs">{n.is_enabled ? "فعال" : "خاموش"}</div>
                          <Switch checked={n.is_enabled} onCheckedChange={(v) => patchNode(n.id, { is_enabled: v })} disabled={busy} />
                        </div>
                      </div>

                      <div className="rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(145deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] p-2">
                        <div className="text-[11px] text-[hsl(var(--fg))]/65">نمایش در ساب</div>
                        <div className="mt-1 flex items-center justify-between">
                          <div className="text-xs">{n.is_visible_in_sub ? "نمایش" : "مخفی"}</div>
                          <Switch checked={n.is_visible_in_sub} onCheckedChange={(v) => patchNode(n.id, { is_visible_in_sub: v })} disabled={busy} />
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => testNode(n.id)} disabled={busy}>
                        <PlugZap size={14} /> {t("adminNodes.test")}
                      </Button>
                      <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => startEdit(n)} disabled={busy}>
                        <Pencil size={14} /> {t("common.edit")}
                      </Button>
                      {n.is_enabled ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="gap-2"
                          onClick={() => setConfirmDisable(n)}
                          disabled={busy}
                        >
                          <ShieldOff size={14} /> {t("common.disable")}
                        </Button>
                      ) : (
                        <Button type="button" size="sm" className="gap-2" onClick={() => patchNode(n.id, { is_enabled: true })} disabled={busy}>
                          <Power size={14} /> {t("common.enable")}
                        </Button>
                      )}
                    </div>

                    {test ? (
                      <div className={`rounded-xl border px-2 py-2 text-xs ${test.ok ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-red-300 bg-red-50 text-red-800"}`}>
                        <div className="flex items-center gap-1 font-semibold">
                          {test.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />} نتیجه آخرین تست اتصال
                        </div>
                        <div className="mt-1 opacity-90">{test.detail || "-"}</div>
                        <div className="mt-1 opacity-70">{fmtCheckedAt(test.checkedAt)}</div>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-[hsl(var(--border))] p-4 text-sm text-[hsl(var(--fg))]/70">{t("common.empty")}</div>
          )}

          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
          />
        </CardContent>
      </Card>

      <ConfirmModal
        open={!!confirmDisable}
        onClose={() => (actionBusyId != null ? null : setConfirmDisable(null))}
        title={t("common.areYouSure")}
        body={t("common.thisActionCannotBeUndone")}
        confirmText={t("common.disable")}
        cancelText={t("common.cancel")}
        danger
        busy={actionBusyId != null}
        onConfirm={async () => {
          if (!confirmDisable) return;
          try {
            await disableNode(confirmDisable.id);
          } finally {
            setConfirmDisable(null);
          }
        }}
      />
    </div>
  );
}
