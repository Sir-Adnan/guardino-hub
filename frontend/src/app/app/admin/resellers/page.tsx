"use client";

import * as React from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Menu } from "@/components/ui/menu";
import { ConfirmModal } from "@/components/ui/confirm";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "@/lib/api";
import { fmtNumber } from "@/lib/format";
import { useToast } from "@/components/ui/toast";
import { HelpTip } from "@/components/ui/help-tip";
import { useI18n } from "@/components/i18n-context";
import { Pagination } from "@/components/ui/pagination";
import { Activity, MoreHorizontal, Pencil, Trash2, Wallet, Power, Users } from "lucide-react";

type ResellerOut = {
  id: number;
  parent_id?: number | null;
  username: string;
  role?: string;
  status: string;
  balance: number;
  price_per_gb: number;
  bundle_price_per_gb?: number | null;
  price_per_day?: number | null;
  can_create_subreseller?: boolean;
  user_policy?: ResellerUserPolicy | null;
};
type ResellerList = { items: ResellerOut[]; total: number };

type ResellerUserPolicy = {
  enabled: boolean;
  allow_custom_days: boolean;
  allow_custom_traffic: boolean;
  allow_no_expire: boolean;
  min_days: number;
  max_days: number;
  allowed_duration_presets: string[];
  allowed_traffic_gb: number[];
};

type NodeOut = {
  id: number;
  name: string;
  panel_type: string;
  base_url: string;
  is_enabled: boolean;
};
type NodeList = { items: NodeOut[]; total: number };

const ADMIN_FETCH_LIMIT = 200;
const DURATION_PRESET_OPTIONS = ["7d", "1m", "3m", "6m", "1y", "unlimited"];
const TRAFFIC_PRESET_OPTIONS = [20, 30, 50, 70, 100, 150, 200];

function defaultUserPolicy(): ResellerUserPolicy {
  return {
    enabled: false,
    allow_custom_days: true,
    allow_custom_traffic: true,
    allow_no_expire: false,
    min_days: 1,
    max_days: 3650,
    allowed_duration_presets: ["7d", "1m", "3m", "6m", "1y"],
    allowed_traffic_gb: [...TRAFFIC_PRESET_OPTIONS],
  };
}

function toggleString(list: string[], value: string, checked: boolean): string[] {
  const s = new Set(list);
  if (checked) s.add(value);
  else s.delete(value);
  return Array.from(s);
}

function toggleNumber(list: number[], value: number, checked: boolean): number[] {
  const s = new Set(list);
  if (checked) s.add(value);
  else s.delete(value);
  return Array.from(s).sort((a, b) => a - b);
}

function normalizePolicy(p: ResellerUserPolicy): ResellerUserPolicy {
  const out: ResellerUserPolicy = {
    enabled: !!p.enabled,
    allow_custom_days: !!p.allow_custom_days,
    allow_custom_traffic: !!p.allow_custom_traffic,
    allow_no_expire: !!p.allow_no_expire,
    min_days: Math.max(1, Number(p.min_days) || 1),
    max_days: Math.max(1, Number(p.max_days) || 3650),
    allowed_duration_presets: Array.from(
      new Set(
        (p.allowed_duration_presets || [])
          .map((x) => String(x || "").trim().toLowerCase())
          .filter((x) => DURATION_PRESET_OPTIONS.includes(x))
      )
    ),
    allowed_traffic_gb: Array.from(
      new Set((p.allowed_traffic_gb || []).map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0))
    )
      .map((x) => Math.floor(x))
      .sort((a, b) => a - b),
  };
  if (out.max_days < out.min_days) out.max_days = out.min_days;
  if (!out.allow_no_expire) {
    out.allowed_duration_presets = out.allowed_duration_presets.filter((x) => x !== "unlimited");
  } else if (!out.allowed_duration_presets.includes("unlimited")) {
    out.allowed_duration_presets.push("unlimited");
  }
  if (!out.allowed_duration_presets.length) out.allowed_duration_presets = ["7d", "1m", "3m", "6m", "1y"];
  if (!out.allowed_traffic_gb.length) out.allowed_traffic_gb = [...TRAFFIC_PRESET_OPTIONS];
  return out;
}

function parseTrafficInput(raw: string): number[] {
  return Array.from(
    new Set(
      raw
        .split(/[,\s]+/g)
        .map((x) => Number(x.trim()))
        .filter((x) => Number.isFinite(x) && x > 0)
        .map((x) => Math.floor(x))
    )
  ).sort((a, b) => a - b);
}

async function fetchAllResellersForAdmin(maxPages = 50): Promise<ResellerOut[]> {
  const all: ResellerOut[] = [];
  let offset = 0;
  let total = 0;
  for (let i = 0; i < maxPages; i++) {
    const res = await apiFetch<ResellerList>(`/api/v1/admin/resellers?offset=${offset}&limit=${ADMIN_FETCH_LIMIT}`);
    const chunk = res.items || [];
    all.push(...chunk);
    total = res.total || all.length;
    if (!chunk.length || all.length >= total) break;
    offset += chunk.length;
  }
  return all;
}

async function fetchAllNodesForAdmin(maxPages = 50): Promise<NodeOut[]> {
  const all: NodeOut[] = [];
  let offset = 0;
  let total = 0;
  for (let i = 0; i < maxPages; i++) {
    const res = await apiFetch<NodeList>(`/api/v1/admin/nodes?offset=${offset}&limit=${ADMIN_FETCH_LIMIT}`);
    const chunk = res.items || [];
    all.push(...chunk);
    total = res.total || all.length;
    if (!chunk.length || all.length >= total) break;
    offset += chunk.length;
  }
  return all;
}

function statusBadgeVariant(s: string): "success" | "danger" | "muted" | "warning" {
  if (s === "active") return "success";
  if (s === "disabled") return "danger";
  if (s === "deleted") return "muted";
  return "warning";
}

function policySummary(policy: ResellerUserPolicy | null | undefined): string {
  if (!policy || !policy.enabled) return "بدون محدودیت";
  const p = normalizePolicy(policy);
  const daysMode = p.allow_custom_days ? "روز دستی: روشن" : "روز دستی: خاموش";
  const trafficMode = p.allow_custom_traffic ? "حجم دستی: روشن" : `حجم‌ها: ${p.allowed_traffic_gb.join(", ")}`;
  return `${daysMode} | ${trafficMode} | بازه روز: ${p.min_days}-${p.max_days}`;
}

export default function AdminResellersPage() {
  const { push } = useToast();
  const { t } = useI18n();

  const [items, setItems] = React.useState<ResellerOut[]>([]);
  const [creditOptions, setCreditOptions] = React.useState<ResellerOut[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(50);
  const [q, setQ] = React.useState("");

  const [editingId, setEditingId] = React.useState<number | null>(null);
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [parentId, setParentId] = React.useState<number | "">("");
  const [priceGb, setPriceGb] = React.useState<number>(0);
  const [bundleGb, setBundleGb] = React.useState<number>(0);
  const [priceDay, setPriceDay] = React.useState<number>(0);
  const [canCreateSub, setCanCreateSub] = React.useState(true);
  const [assignAllNodes, setAssignAllNodes] = React.useState(true);
  const [userPolicy, setUserPolicy] = React.useState<ResellerUserPolicy>(defaultUserPolicy());
  const [trafficInput, setTrafficInput] = React.useState(TRAFFIC_PRESET_OPTIONS.join(", "));

  const [creditId, setCreditId] = React.useState<number | "">("");
  const [creditQuery, setCreditQuery] = React.useState("");
  const [creditAmount, setCreditAmount] = React.useState<number>(10000);

  const [confirmDelete, setConfirmDelete] = React.useState<ResellerOut | null>(null);
  const [confirmToggleStatus, setConfirmToggleStatus] = React.useState<{ r: ResellerOut; to: "active" | "disabled" } | null>(null);
  const [busy, setBusy] = React.useState(false);

  function resetForm() {
    setEditingId(null);
    setUsername("");
    setPassword("");
    setParentId("");
    setPriceGb(0);
    setBundleGb(0);
    setPriceDay(0);
    setCanCreateSub(true);
    setAssignAllNodes(true);
    const p = defaultUserPolicy();
    setUserPolicy(p);
    setTrafficInput(p.allowed_traffic_gb.join(", "));
  }

  async function load(nextPage: number = page, nextPageSize: number = pageSize) {
    try {
      const offset = (nextPage - 1) * nextPageSize;
      const res = await apiFetch<ResellerList>(`/api/v1/admin/resellers?offset=${offset}&limit=${nextPageSize}`);
      setItems(res.items || []);
      setTotal(res.total || 0);
      const safeTotal = res.total || 0;
      if ((res.items || []).length === 0 && safeTotal > 0 && offset >= safeTotal) {
        const lastPage = Math.max(1, Math.ceil(safeTotal / nextPageSize));
        if (lastPage !== nextPage) setPage(lastPage);
      }
    } catch (e: any) {
      push({ title: t("common.error"), desc: String(e.message || e), type: "error" });
    }
  }

  async function loadCreditOptions() {
    try {
      const all = await fetchAllResellersForAdmin();
      setCreditOptions(all.filter((x) => x.status !== "deleted"));
    } catch (e: any) {
      push({ title: t("common.error"), desc: String(e.message || e), type: "error" });
    }
  }


async function assignAllNodesForReseller(resellerId: number) {
  // Best-effort: allocate all enabled nodes to this reseller for immediate usability.
  const nodes = await fetchAllNodesForAdmin();
  const enabled = nodes.filter((n) => n.is_enabled);
  await Promise.all(
    enabled.map((n) =>
      apiFetch("/api/v1/admin/allocations", {
        method: "POST",
        body: JSON.stringify({
          reseller_id: resellerId,
          node_id: n.id,
          enabled: true,
          default_for_reseller: true,
          price_per_gb_override: null,
        }),
      }).catch(() => null)
    )
  );
}

  async function createOrSave() {
    try {
      if (editingId == null) {
        if (!username || username.length < 3) throw new Error(t("adminResellers.errUsername"));
        if (!password || password.length < 6) throw new Error(t("adminResellers.errPassword"));
        const res = await apiFetch<ResellerOut>("/api/v1/admin/resellers", {
          method: "POST",
          body: JSON.stringify({
            username,
            password,
            parent_id: parentId === "" ? null : Number(parentId),
            price_per_gb: Number(priceGb) || 0,
            bundle_price_per_gb: Number(bundleGb) || 0,
            price_per_day: Number(priceDay) || 0,
            can_create_subreseller: canCreateSub,
            user_policy: normalizePolicy(userPolicy),
          }),
        });
        push({ title: t("adminResellers.created"), desc: `ID: ${res.id}`, type: "success" });
        if (assignAllNodes) {
          try {
            await assignAllNodesForReseller(res.id);
            push({ title: t("adminResellers.assignedAllNodes"), desc: t("adminResellers.assignedAllNodesDesc"), type: "success" });
          } catch {
            push({ title: t("common.warn"), desc: t("adminResellers.assignAllNodesWarn"), type: "warning" });
          }
        }
        resetForm();
        setQ("");
        if (page !== 1) setPage(1);
        await Promise.all([load(1, pageSize), loadCreditOptions()]);
      } else {
        const res = await apiFetch<ResellerOut>(`/api/v1/admin/resellers/${editingId}`, {
          method: "PATCH",
          body: JSON.stringify({
            parent_id: parentId === "" ? null : Number(parentId),
            password: password ? password : null,
            price_per_gb: Number(priceGb),
            bundle_price_per_gb: Number(bundleGb),
            price_per_day: Number(priceDay),
            can_create_subreseller: canCreateSub,
            user_policy: normalizePolicy(userPolicy),
          }),
        });
        push({ title: t("adminResellers.saved"), desc: `ID: ${res.id}`, type: "success" });
        await Promise.all([load(page, pageSize), loadCreditOptions()]);
        resetForm();
      }
    } catch (e: any) {
      push({ title: t("common.error"), desc: String(e.message || e), type: "error" });
    }
  }

  async function startEdit(x: ResellerOut) {
    try {
      const detail = await apiFetch<ResellerOut>(`/api/v1/admin/resellers/${x.id}`);
      setEditingId(detail.id);
      setUsername(detail.username);
      setPassword("");
      setParentId(detail.parent_id ?? "");
      setPriceGb(detail.price_per_gb ?? 0);
      setBundleGb((detail.bundle_price_per_gb ?? 0) as number);
      setPriceDay((detail.price_per_day ?? 0) as number);
      setCanCreateSub(detail.can_create_subreseller ?? true);
      const p = normalizePolicy(detail.user_policy || defaultUserPolicy());
      setUserPolicy(p);
      setTrafficInput((p.allowed_traffic_gb || []).join(", "));
    } catch (e: any) {
      push({ title: t("common.error"), desc: String(e.message || e), type: "error" });
    }
  }

  async function toggleStatus(x: ResellerOut, next: "active" | "disabled") {
    try {
      await apiFetch<ResellerOut>(`/api/v1/admin/resellers/${x.id}/set-status`, {
        method: "POST",
        body: JSON.stringify({ status: next }),
      });
      push({
        title: next === "active" ? t("adminResellers.enabledOk") : t("adminResellers.disabledOk"),
        desc: `${x.username} (#${x.id})`,
        type: next === "active" ? "success" : "warning",
      });
      await Promise.all([load(page, pageSize), loadCreditOptions()]);
    } catch (e: any) {
      push({ title: t("common.error"), desc: String(e.message || e), type: "error" });
    }
  }

  async function del(x: ResellerOut) {
    try {
      await apiFetch<ResellerOut>(`/api/v1/admin/resellers/${x.id}`, { method: "DELETE" });
      push({ title: t("adminResellers.deleted"), desc: x.username, type: "success" });
      await Promise.all([load(page, pageSize), loadCreditOptions()]);
    } catch (e: any) {
      push({ title: t("common.error"), desc: String(e.message || e), type: "error" });
    }
  }

  async function credit() {
    try {
      if (creditId === "") throw new Error(t("adminResellers.errCreditId"));
      const res = await apiFetch<any>(`/api/v1/admin/resellers/${Number(creditId)}/credit`, {
        method: "POST",
        body: JSON.stringify({ amount: Number(creditAmount) || 0, reason: "manual_credit" }),
      });
      push({ title: t("adminResellers.credited"), desc: `balance=${fmtNumber(res.balance)}`, type: "success" });
      await Promise.all([load(page, pageSize), loadCreditOptions()]);
    } catch (e: any) {
      push({ title: t("common.error"), desc: String(e.message || e), type: "error" });
    }
  }

  const filtered = items.filter((x) => {
    const s = `${x.id} ${x.username} ${x.role || ""} ${x.status} ${x.balance}`.toLowerCase();
    return s.includes(q.toLowerCase());
  });

  React.useEffect(() => {
    load(page, pageSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize]);

  React.useEffect(() => {
    loadCreditOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    setTrafficInput((userPolicy.allowed_traffic_gb || []).join(", "));
  }, [userPolicy.allowed_traffic_gb]);
  const selectClass =
    "h-10 rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(155deg,hsl(var(--surface-input-1))_0%,hsl(var(--surface-input-2))_58%,hsl(var(--surface-input-3))_100%)] px-3 text-sm outline-none transition-all duration-200 hover:border-[hsl(var(--accent)/0.35)] focus:ring-2 focus:ring-[hsl(var(--accent)/0.35)]";
  const metricCardClass =
    "rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(155deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] p-3 shadow-[0_10px_22px_-20px_hsl(var(--fg)/0.6)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[hsl(var(--accent)/0.35)]";
  const stats = React.useMemo(() => {
    const active = items.filter((x) => x.status === "active").length;
    const disabled = items.filter((x) => x.status === "disabled").length;
    const totalBalance = items.reduce((acc, x) => acc + Number(x.balance || 0), 0);
    return {
      count: items.length,
      active,
      disabled,
      totalBalance,
    };
  }, [items]);

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(112deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] p-4 shadow-[0_15px_28px_-20px_hsl(var(--fg)/0.35)] sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] px-3 py-1 text-xs text-[hsl(var(--fg))]/75">
              <Users size={13} />
              Reseller Operations
            </div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight">{t("adminResellers.title")}</h1>
            <p className="mt-1 text-sm text-[hsl(var(--fg))]/70">{t("adminResellers.subtitle")}</p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(130deg,hsl(var(--accent)/0.16),hsl(var(--surface-card-1)))] px-3 py-2 text-xs font-medium text-[hsl(var(--fg))]/80">
            <Activity size={14} />
            مدیریت سریع نماینده‌ها
          </div>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className={metricCardClass}>
          <div className="text-xs text-[hsl(var(--fg))]/70">نماینده‌های صفحه</div>
          <div className="mt-1 text-lg font-semibold">{fmtNumber(stats.count)}</div>
        </div>
        <div className={metricCardClass}>
          <div className="text-xs text-[hsl(var(--fg))]/70">فعال</div>
          <div className="mt-1 text-lg font-semibold text-emerald-600">{fmtNumber(stats.active)}</div>
        </div>
        <div className={metricCardClass}>
          <div className="text-xs text-[hsl(var(--fg))]/70">غیرفعال</div>
          <div className="mt-1 text-lg font-semibold text-amber-600">{fmtNumber(stats.disabled)}</div>
        </div>
        <div className={metricCardClass}>
          <div className="text-xs text-[hsl(var(--fg))]/70">موجودی کل (صفحه)</div>
          <div className="mt-1 text-lg font-semibold">{fmtNumber(stats.totalBalance)}</div>
        </div>
      </div>

      <Card className="overflow-hidden">
        <CardHeader>
          <div className="text-xl font-semibold">{t("adminResellers.title")}</div>
          <div className="text-sm text-[hsl(var(--fg))]/70">{t("adminResellers.subtitle")}</div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm flex items-center gap-2">
                {t("adminResellers.username")} <HelpTip text={t("adminResellers.help.username")} />
              </label>
              <Input value={username} onChange={(e) => setUsername(e.target.value)} disabled={editingId != null} />
            </div>
            <div className="space-y-2">
              <label className="text-sm flex items-center gap-2">
                {editingId == null ? t("adminResellers.password") : t("adminResellers.passwordOptional")} <HelpTip text={t("adminResellers.help.password")} />
              </label>
              <Input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder={editingId == null ? "******" : "(optional)"} />
            </div>

            <div className="space-y-2">
              <label className="text-sm flex items-center gap-2">
                {t("adminResellers.parentId")} <HelpTip text={t("adminResellers.help.parentId")} />
              </label>
              <Input value={parentId} onChange={(e) => setParentId(e.target.value === "" ? "" : Number(e.target.value))} type="number" placeholder="(optional)" />
            </div>

	            <div className="space-y-2">
	              <label className="text-sm flex items-center gap-2">
	                {t("adminResellers.canCreateSub")} <HelpTip text={t("adminResellers.help.canCreateSub")} />
	              </label>
	              <div className="flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(145deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] px-3 py-2">
	                <Switch checked={canCreateSub} onCheckedChange={setCanCreateSub} />
	                <span className="text-sm text-[hsl(var(--fg))]/75">{canCreateSub ? t("common.yes") : t("common.no")}</span>
	              </div>
	            </div>

{editingId == null && (
  <div className="space-y-2">
    <label className="text-sm flex items-center gap-2">
      {t("adminResellers.assignAllNodes")} <HelpTip text={t("adminResellers.help.assignAllNodes")} />
    </label>
	    <div className="flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(145deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] px-3 py-2">
	      <Switch checked={assignAllNodes} onCheckedChange={setAssignAllNodes} />
	      <span className="text-sm text-[hsl(var(--fg))]/75">{assignAllNodes ? t("common.yes") : t("common.no")}</span>
	    </div>
	  </div>
)}

<div className="space-y-2 md:col-span-2">
              <label className="text-sm flex items-center gap-2">
                {t("adminResellers.pricing")} <HelpTip text={t("adminResellers.help.pricing")} />
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
  <div className="space-y-1">
    <div className="text-xs text-[hsl(var(--fg))]/70 flex items-center gap-2">
      {t("adminResellers.pricePerGb")} <HelpTip text={t("adminResellers.help.pricePerGb")} />
    </div>
    <Input type="number" value={priceGb} onChange={(e) => setPriceGb(Number(e.target.value))} />
  </div>
  <div className="space-y-1">
    <div className="text-xs text-[hsl(var(--fg))]/70 flex items-center gap-2">
      {t("adminResellers.bundlePerGb")} <HelpTip text={t("adminResellers.help.bundlePerGb")} />
    </div>
    <Input type="number" value={bundleGb} onChange={(e) => setBundleGb(Number(e.target.value))} />
  </div>
  <div className="space-y-1">
    <div className="text-xs text-[hsl(var(--fg))]/70 flex items-center gap-2">
      {t("adminResellers.pricePerDay")} <HelpTip text={t("adminResellers.help.pricePerDay")} />
    </div>
    <Input type="number" value={priceDay} onChange={(e) => setPriceDay(Number(e.target.value))} />
  </div>
</div>
<div className="text-xs text-[hsl(var(--fg))]/70">{t("adminResellers.pricingNote")}</div>
            </div>

	            <div className="space-y-3 md:col-span-2 rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(155deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] p-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium">سیاست ساخت کاربر برای رسیلر</div>
                  <div className="text-xs text-[hsl(var(--fg))]/70">
                    با فعال‌سازی این بخش، رسیلر فقط از بسته‌های زمانی/حجمی مشخص‌شده می‌تواند استفاده کند.
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={userPolicy.enabled}
                    onCheckedChange={(v) => setUserPolicy((x) => normalizePolicy({ ...x, enabled: v }))}
                  />
                  <span className="text-xs text-[hsl(var(--fg))]/75">{userPolicy.enabled ? "فعال" : "غیرفعال"}</span>
                </div>
              </div>

              {userPolicy.enabled ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <div className="text-xs text-[hsl(var(--fg))]/70">بسته‌های زمانی مجاز</div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {DURATION_PRESET_OPTIONS.map((preset) => {
                        const checked = (userPolicy.allowed_duration_presets || []).includes(preset);
                        const disabled = preset === "unlimited" && !userPolicy.allow_no_expire;
                        const label =
                          preset === "7d"
                            ? "۷ روز"
                            : preset === "1m"
                              ? "۱ ماه"
                              : preset === "3m"
                                ? "۳ ماه"
                                : preset === "6m"
                                  ? "۶ ماه"
                                  : preset === "1y"
                                    ? "۱ سال"
                                    : "نامحدود";
                        return (
	                          <label key={preset} className="flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] px-3 py-2 text-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-[hsl(var(--accent)/0.35)]">
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={disabled}
                              onChange={(e) =>
                                setUserPolicy((v) =>
                                  normalizePolicy({
                                    ...v,
                                    allowed_duration_presets: toggleString(v.allowed_duration_presets || [], preset, e.target.checked),
                                  })
                                )
                              }
                            />
                            <span>{label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs text-[hsl(var(--fg))]/70">حجم‌های مجاز (GB)</div>
                    <div className="flex flex-wrap gap-2">
                      {TRAFFIC_PRESET_OPTIONS.map((g) => (
	                        <label key={g} className="flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] px-3 py-2 text-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-[hsl(var(--accent)/0.35)]">
                          <input
                            type="checkbox"
                            checked={(userPolicy.allowed_traffic_gb || []).includes(g)}
                            onChange={(e) =>
                              setUserPolicy((v) =>
                                normalizePolicy({
                                  ...v,
                                  allowed_traffic_gb: toggleNumber(v.allowed_traffic_gb || [], g, e.target.checked),
                                })
                              )
                            }
                          />
                          <span>{g}GB</span>
                        </label>
                      ))}
                    </div>
                    <Input
                      value={trafficInput}
                      onChange={(e) => setTrafficInput(e.target.value)}
                      placeholder="مثال: 20, 30, 50, 100"
                      onBlur={() => {
                        const parsed = parseTrafficInput(trafficInput);
                        if (parsed.length) {
                          setUserPolicy((v) => normalizePolicy({ ...v, allowed_traffic_gb: parsed }));
                        }
                      }}
                    />
                  </div>

	                  <div className="space-y-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] p-3">
                    <div className="text-xs text-[hsl(var(--fg))]/70">کنترل روز و مدت‌زمان</div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs">اجازه روز دستی</span>
                      <Switch
                        checked={userPolicy.allow_custom_days}
                        onCheckedChange={(v) => setUserPolicy((x) => normalizePolicy({ ...x, allow_custom_days: v }))}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        type="number"
                        value={userPolicy.min_days}
                        onChange={(e) => setUserPolicy((v) => normalizePolicy({ ...v, min_days: Number(e.target.value) || 1 }))}
                        placeholder="حداقل روز"
                      />
                      <Input
                        type="number"
                        value={userPolicy.max_days}
                        onChange={(e) => setUserPolicy((v) => normalizePolicy({ ...v, max_days: Number(e.target.value) || v.min_days || 1 }))}
                        placeholder="حداکثر روز"
                      />
                    </div>
                  </div>

	                  <div className="space-y-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] p-3">
                    <div className="text-xs text-[hsl(var(--fg))]/70">تنظیمات تکمیلی</div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs">اجازه حجم دستی</span>
                      <Switch
                        checked={userPolicy.allow_custom_traffic}
                        onCheckedChange={(v) => setUserPolicy((x) => normalizePolicy({ ...x, allow_custom_traffic: v }))}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs">اجازه پلن نامحدود</span>
                      <Switch
                        checked={userPolicy.allow_no_expire}
                        onCheckedChange={(v) => setUserPolicy((x) => normalizePolicy({ ...x, allow_no_expire: v }))}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-[hsl(var(--fg))]/70">در حالت غیرفعال، محدودیتی برای روز/حجم اعمال نمی‌شود.</div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={createOrSave}>
              {editingId == null ? t("adminResellers.create") : t("adminResellers.save")}
            </Button>
            <Button type="button" variant="outline" onClick={() => load(page, pageSize)}>
              {t("common.reload")}
            </Button>
            {editingId != null ? (
              <Button type="button" variant="outline" onClick={resetForm}>
                {t("common.cancel")}
              </Button>
            ) : null}
          </div>

	          <Card className="overflow-hidden">
	            <CardHeader>
	              <div className="text-sm font-medium">{t("adminResellers.creditTitle")}</div>
	              <div className="text-xs text-[hsl(var(--fg))]/70">{t("adminResellers.creditSubtitle")}</div>
	            </CardHeader>
            <CardContent className="grid gap-2 md:grid-cols-4">
  <div className="md:col-span-2 grid gap-2 sm:grid-cols-2">
    <Input
      placeholder={t("common.search")}
      value={creditQuery}
      onChange={(e) => setCreditQuery(e.target.value)}
    />
	    <select
	      className={selectClass}
	      value={creditId}
	      onChange={(e) => setCreditId(e.target.value === "" ? "" : Number(e.target.value))}
	    >
      <option value="">{t("adminResellers.selectReseller")}</option>
      {creditOptions
        .filter((r) => `${r.id} ${r.username} ${r.role || ""}`.toLowerCase().includes(creditQuery.toLowerCase()))
        .slice(0, 200)
        .map((r) => (
          <option key={r.id} value={r.id}>
        {r.username} (#{r.id}) [{r.role || "reseller"}] — {fmtNumber(r.balance)}
          </option>
        ))}
    </select>
  </div>
  <Input
    placeholder={t("adminResellers.amount")}
    type="number"
    value={creditAmount}
    onChange={(e) => setCreditAmount(Number(e.target.value))}
  />
  <Button type="button" variant="outline" onClick={credit}>
    {t("adminResellers.credit")}
  </Button>
</CardContent>
          </Card>

	          <div className="rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(130deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] p-2">
	            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("common.search")} />
	          </div>

	          <div className="overflow-x-auto rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))]">
	            <table className="w-full text-sm">
	              <thead className="text-[hsl(var(--fg))]/70">
	                <tr className="border-b border-[hsl(var(--border))] bg-[linear-gradient(130deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)]">
                  <th className="text-[start] py-2">ID</th>
                  <th className="text-[start] py-2">{t("adminResellers.username")}</th>
                  <th className="text-[start] py-2">{t("adminResellers.status")}</th>
                  <th className="text-[start] py-2">{t("adminResellers.balance")}</th>
                  <th className="text-[start] py-2">{t("adminResellers.pricePerGb")}</th>
                  <th className="text-[start] py-2">{t("adminResellers.bundlePerGb")}</th>
                  <th className="text-[start] py-2">{t("adminResellers.pricePerDay")}</th>
                  <th className="text-[start] py-2">سیاست ساخت کاربر</th>
                  <th className="text-[end] py-2">{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((x) => (
	                  <tr key={x.id} className="border-b border-[hsl(var(--border))] transition-colors hover:bg-[hsl(var(--accent)/0.06)]">
                    <td className="py-2">{x.id}</td>
                    <td className="py-2">
                      <div className="font-medium">{x.username}</div>
                      <div className="text-xs text-[hsl(var(--fg))]/60">role: {x.role || "reseller"}</div>
                      {x.parent_id ? <div className="text-xs text-[hsl(var(--fg))]/60">parent: #{x.parent_id}</div> : null}
                    </td>
                    <td className="py-2">
                      <div className="flex items-center gap-3">
                        <Badge variant={statusBadgeVariant(x.status)}>{x.status}</Badge>
                        <Switch
                          checked={x.status === "active"}
                          onCheckedChange={() => toggleStatus(x, x.status === "active" ? "disabled" : "active")}
                          disabled={x.status === "deleted"}
                        />
                      </div>
                    </td>
                    <td className="py-2">{fmtNumber(x.balance)}</td>
                    <td className="py-2">{fmtNumber(x.price_per_gb)}</td>
                    <td className="py-2">{fmtNumber(x.bundle_price_per_gb ?? 0)}</td>
                    <td className="py-2">{fmtNumber(x.price_per_day ?? 0)}</td>
                    <td className="py-2 max-w-[360px]">
                      <div className="truncate text-xs text-[hsl(var(--fg))]/80" title={policySummary(x.user_policy)}>
                        {policySummary(x.user_policy)}
                      </div>
                    </td>
                    <td className="py-2 text-[end]">
                      <Menu
                        trigger={
                          <Button variant="ghost" className="px-2" title={t("common.actions")}>
                            <MoreHorizontal size={18} />
                          </Button>
                        }
                        items={[
                          { label: t("common.edit"), icon: <Pencil size={16} />, onClick: () => startEdit(x) },
                          {
                            label: t("adminResellers.pickForCredit"),
                            icon: <Wallet size={16} />,
                            onClick: () => {
                              setCreditId(x.id);
                              push({ title: t("adminResellers.creditHint"), desc: `${x.username} (#${x.id})`, type: "success" });
                            },
                          },
                          x.status !== "deleted"
                            ? {
                                label: x.status === "active" ? t("common.disable") : t("common.enable"),
                                icon: <Power size={16} />,
                                onClick: () =>
                                  setConfirmToggleStatus({ r: x, to: x.status === "active" ? "disabled" : "active" }),
                              }
                            : { label: t("adminResellers.toggleStatus"), icon: <Power size={16} />, onClick: () => {} , disabled: true },
                          { label: t("common.delete"), icon: <Trash2 size={16} />, onClick: () => setConfirmDelete(x), danger: true },
                        ]}
                      />
                    </td>
                  </tr>
                ))}

                {!filtered.length ? (
                  <tr>
                    <td className="py-3 text-[hsl(var(--fg))]/70" colSpan={9}>
                      {t("common.empty")}
                    </td>
                  </tr>
                ) : null}
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
          />
        </CardContent>
      </Card>

      
      <ConfirmModal
        open={!!confirmToggleStatus}
        onClose={() => (busy ? null : setConfirmToggleStatus(null))}
        title={t("adminResellers.toggleStatus")}
        body={t("adminResellers.toggleStatusDesc")}
        confirmText={confirmToggleStatus?.to === "active" ? t("common.enable") : t("common.disable")}
        cancelText={t("common.cancel")}
        danger={confirmToggleStatus?.to === "disabled"}
        busy={busy}
        onConfirm={async () => {
          if (!confirmToggleStatus) return;
          setBusy(true);
          try {
            await toggleStatus(confirmToggleStatus.r, confirmToggleStatus.to);
          } finally {
            setBusy(false);
            setConfirmToggleStatus(null);
          }
        }}
      />
<ConfirmModal
        open={!!confirmDelete}
        onClose={() => (busy ? null : setConfirmDelete(null))}
        title={t("common.areYouSure")}
        body={t("common.thisActionCannotBeUndone")}
        confirmText={t("common.delete")}
        cancelText={t("common.cancel")}
        danger
        busy={busy}
        onConfirm={async () => {
          if (!confirmDelete) return;
          setBusy(true);
          try {
            await del(confirmDelete);
          } finally {
            setBusy(false);
            setConfirmDelete(null);
          }
        }}
      />
    </div>
  );
}
