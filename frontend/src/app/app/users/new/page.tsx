"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Modal } from "@/components/ui/modal";
import { Progress } from "@/components/ui/progress";
import { apiFetch } from "@/lib/api";
import { fmtNumber } from "@/lib/format";
import { copyText } from "@/lib/copy";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/components/i18n-context";
import { HelpTip } from "@/components/ui/help-tip";
import { useAuth } from "@/components/auth-context";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { CalendarDays, Copy, ExternalLink, Gauge, Link2, Lock, Sparkles } from "lucide-react";

type QuoteResp = { total_amount: number; per_node_amount: Record<string, number>; time_amount: number };
type CreateResp = { user_id: number; master_sub_token: string; charged_amount: number; nodes_provisioned: number[] };

type UserDefaults = {
  default_pricing_mode: "bundle" | "per_node";
  default_node_mode: "all" | "manual" | "group";
  default_node_ids: number[];
  default_node_group: string;
  label_prefix: string;
  label_suffix: string;
  username_prefix: string;
  username_suffix: string;
};

type UserDefaultsEnvelope = {
  global_defaults: UserDefaults;
  reseller_defaults: UserDefaults;
  effective: UserDefaults;
};

type NodeLite = { id: number; name: string; panel_type: string; base_url?: string; tags?: string[] };
type LinksResp = {
  user_id: number;
  master_link: string;
  node_links: Array<{
    node_id: number;
    node_name?: string;
    panel_type?: string;
    direct_url?: string;
    full_url?: string;
    config_download_url?: string;
    status: string;
    detail?: string;
  }>;
};

type CreatedUserLinks = {
  user_id: number;
  label: string;
  master_link: string;
  node_links: Array<{ node_id: number; node_label: string; full_url: string; status: string; detail?: string }>;
};

type CreateIssue = { label: string; error: string };
type CreateSummary = {
  total: number;
  done: number;
  success: number;
  failed: number;
  cancelled: boolean;
  issues: CreateIssue[];
};

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

const durationPresets = [
  { key: "7d", label: "۷ روز", days: 7 },
  { key: "1m", label: "۱ ماه", days: 30 },
  { key: "3m", label: "۳ ماه", days: 90 },
  { key: "6m", label: "۶ ماه", days: 180 },
  { key: "1y", label: "۱ سال", days: 365 },
  { key: "unlimited", label: "نامحدود", days: 0 },
];

const trafficPresets = [20, 30, 50, 70, 100, 150, 200];

const EMPTY_DEFAULTS: UserDefaults = {
  default_pricing_mode: "bundle",
  default_node_mode: "all",
  default_node_ids: [],
  default_node_group: "",
  label_prefix: "",
  label_suffix: "",
  username_prefix: "",
  username_suffix: "",
};

function defaultUserPolicy(): ResellerUserPolicy {
  return {
    enabled: false,
    allow_custom_days: true,
    allow_custom_traffic: true,
    allow_no_expire: false,
    min_days: 1,
    max_days: 3650,
    allowed_duration_presets: ["7d", "1m", "3m", "6m", "1y"],
    allowed_traffic_gb: [...trafficPresets],
  };
}

function normalizePolicy(raw: ResellerUserPolicy | null | undefined): ResellerUserPolicy {
  const base = defaultUserPolicy();
  if (!raw) return base;
  const minDays = Math.max(1, Number(raw.min_days) || 1);
  const maxDays = Math.max(minDays, Number(raw.max_days) || minDays);
  const allowedDuration = Array.from(new Set((raw.allowed_duration_presets || []).map((x) => String(x).trim().toLowerCase())));
  const allowedTraffic = Array.from(
    new Set((raw.allowed_traffic_gb || []).map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0))
  ).sort((a, b) => a - b);
  return {
    enabled: !!raw.enabled,
    allow_custom_days: !!raw.allow_custom_days,
    allow_custom_traffic: !!raw.allow_custom_traffic,
    allow_no_expire: !!raw.allow_no_expire,
    min_days: minDays,
    max_days: maxDays,
    allowed_duration_presets: allowedDuration.length ? allowedDuration : base.allowed_duration_presets,
    allowed_traffic_gb: allowedTraffic.length ? allowedTraffic : [...trafficPresets],
  };
}

function randomLabel() {
  return `u_${Math.random().toString(16).slice(2, 10)}`;
}

function normalizeUrl(maybeUrl: string, baseUrl?: string) {
  const u = (maybeUrl || "").trim();
  if (!u) return u;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) return u;
  const b = (baseUrl || "").trim();
  if (!b) return u;
  let origin = b;
  try {
    const parsed = new URL(b);
    origin = parsed.origin;
  } catch {
    const m = b.match(/^(https?:\/\/[^/]+)/i);
    if (m) origin = m[1];
  }
  const uu = u.startsWith("/") ? u : `/${u}`;
  return `${origin.replace(/\/+$/, "")}${uu}`;
}

export default function NewUserPage() {
  const r = useRouter();
  const { push } = useToast();
  const { t } = useI18n();
  const { refresh: refreshMe } = useAuth();

  const [label, setLabel] = React.useState("");
  const [username, setUsername] = React.useState("");
  const [randomize, setRandomize] = React.useState(false);

  const [totalGb, setTotalGb] = React.useState<number>(10);
  const [pricingMode, setPricingMode] = React.useState<"per_node" | "bundle">("bundle");

  const [preset, setPreset] = React.useState<string>("1m");
  const [days, setDays] = React.useState<number>(30);

  const [nodeMode, setNodeMode] = React.useState<"all" | "manual" | "group">("all");
  const [selectedNodeIds, setSelectedNodeIds] = React.useState<number[]>([]);
  const [nodePickQ, setNodePickQ] = React.useState("");
  const [nodeGroup, setNodeGroup] = React.useState<string>("");
  const [nodes, setNodes] = React.useState<NodeLite[] | null>(null);

  const [defaults, setDefaults] = React.useState<UserDefaults>(EMPTY_DEFAULTS);
  const [userPolicy, setUserPolicy] = React.useState<ResellerUserPolicy>(defaultUserPolicy());
  const [defaultsLoaded, setDefaultsLoaded] = React.useState(false);

  const [bulkEnabled, setBulkEnabled] = React.useState(false);
  const [bulkCount, setBulkCount] = React.useState<number>(5);
  const bulkPresets = [5, 10, 15, 20, 30, 40, 50];

  const [resultOpen, setResultOpen] = React.useState(false);
  const [resultLinks, setResultLinks] = React.useState<CreatedUserLinks[]>([]);
  const [createSummary, setCreateSummary] = React.useState<CreateSummary | null>(null);

  const [quote, setQuote] = React.useState<QuoteResp | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [createTotal, setCreateTotal] = React.useState(0);
  const [createDone, setCreateDone] = React.useState(0);
  const [createSuccess, setCreateSuccess] = React.useState(0);
  const [createFailed, setCreateFailed] = React.useState(0);
  const [createCurrentLabel, setCreateCurrentLabel] = React.useState("");
  const cancelCreateRef = React.useRef(false);
  const activeRequestRef = React.useRef<AbortController | null>(null);
  const appliedNodeSelectionFromUrlRef = React.useRef(false);

  const nodeMap = React.useMemo(() => {
    const m = new Map<number, NodeLite>();
    for (const n of nodes || []) m.set(n.id, n);
    return m;
  }, [nodes]);

  const tagOptions = React.useMemo(() => {
    const set = new Set<string>();
    (nodes || []).forEach((n) => (n.tags || []).forEach((tg) => set.add(String(tg))));
    return Array.from(set).sort();
  }, [nodes]);

  const filteredNodes = React.useMemo(() => {
    const qq = nodePickQ.trim().toLowerCase();
    if (!qq) return nodes || [];
    return (nodes || []).filter((n) => `${n.id} ${n.name} ${n.panel_type}`.toLowerCase().includes(qq));
  }, [nodes, nodePickQ]);

  const effectiveTrafficPresets = React.useMemo(() => {
    if (!userPolicy.enabled) return [...trafficPresets];
    const allowed = (userPolicy.allowed_traffic_gb || []).filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
    if (!allowed.length) return [...trafficPresets];
    if (!userPolicy.allow_custom_traffic) return allowed;
    return Array.from(new Set([...trafficPresets, ...allowed])).sort((a, b) => a - b);
  }, [userPolicy]);

  const effectiveDurationPresets = React.useMemo(() => {
    const all = durationPresets;
    if (!userPolicy.enabled) return all.filter((p) => p.key !== "unlimited");
    const allowed = new Set((userPolicy.allowed_duration_presets || []).map((x) => String(x).trim().toLowerCase()));
    const filtered = all.filter((p) => {
      if (p.key === "unlimited" && !userPolicy.allow_no_expire) return false;
      if (!allowed.size) return true;
      return allowed.has(p.key);
    });
    return filtered.length ? filtered : all.filter((p) => p.key !== "unlimited");
  }, [userPolicy]);

  const customTrafficLocked = userPolicy.enabled && !userPolicy.allow_custom_traffic;
  const customDaysLocked = userPolicy.enabled && !userPolicy.allow_custom_days;

  const allManualSelected = React.useMemo(() => {
    if (!nodes?.length) return false;
    if (!selectedNodeIds.length) return false;
    const all = new Set(nodes.map((n) => n.id));
    return nodes.every((n) => selectedNodeIds.includes(n.id)) && selectedNodeIds.every((id) => all.has(id));
  }, [nodes, selectedNodeIds]);

  function toggleAll(v: boolean) {
    if (!nodes) return;
    setSelectedNodeIds(v ? nodes.map((n) => n.id) : []);
  }

  function toggleOne(id: number, v: boolean) {
    setSelectedNodeIds((prev) => {
      const s = new Set(prev);
      if (v) s.add(id);
      else s.delete(id);
      return Array.from(s);
    });
  }

  function randomName() {
    const v = randomLabel();
    setLabel(v);
    setUsername(v);
    if (randomize) setRandomize(false);
  }

  async function loadNodes() {
    const res = await apiFetch<any>("/api/v1/reseller/nodes");
    const arr = res.items || [];
    setNodes(arr.map((n: any) => ({ id: n.id, name: n.name, panel_type: n.panel_type, base_url: n.base_url || "", tags: n.tags || [] })));
    return arr as Array<any>;
  }

  async function loadDefaults() {
    const env = await apiFetch<UserDefaultsEnvelope>("/api/v1/reseller/settings/user-defaults");
    const eff = env?.effective || EMPTY_DEFAULTS;
    setDefaults(eff);
    setPricingMode(eff.default_pricing_mode || "bundle");
    setNodeMode(eff.default_node_mode || "all");
    setSelectedNodeIds(Array.isArray(eff.default_node_ids) ? eff.default_node_ids : []);
    setNodeGroup(eff.default_node_group || "");
  }

  async function loadPolicy() {
    const policy = await apiFetch<ResellerUserPolicy>("/api/v1/reseller/settings/user-policy");
    setUserPolicy(normalizePolicy(policy));
  }

  React.useEffect(() => {
    (async () => {
      const results = await Promise.allSettled([loadNodes(), loadDefaults(), loadPolicy()]);
      const nodeErr = results[0].status === "rejected" ? results[0].reason : null;
      const defaultsErr = results[1].status === "rejected" ? results[1].reason : null;
      const policyErr = results[2].status === "rejected" ? results[2].reason : null;
      if (nodeErr) {
        push({ title: "Cannot load nodes", desc: String((nodeErr as any)?.message || nodeErr), type: "error" });
      }
      if (defaultsErr) {
        push({ title: "Cannot load defaults", desc: String((defaultsErr as any)?.message || defaultsErr), type: "warning" });
      }
      if (policyErr) {
        push({ title: "Cannot load reseller policy", desc: String((policyErr as any)?.message || policyErr), type: "warning" });
      }
      setDefaultsLoaded(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (!nodes?.length) return;
    setSelectedNodeIds((prev) => prev.filter((id) => nodes.some((n) => n.id === id)));
  }, [nodes]);

  React.useEffect(() => {
    if (!nodes?.length || !defaultsLoaded) return;
    if (appliedNodeSelectionFromUrlRef.current) return;
    appliedNodeSelectionFromUrlRef.current = true;

    const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
    const rawNodeIds = String(params.get("node_ids") || "").trim();
    if (!rawNodeIds) return;

    const mode = String(params.get("node_mode") || "").trim().toLowerCase();
    const parsedIds = Array.from(
      new Set(
        rawNodeIds
          .split(",")
          .map((x) => Number(x.trim()))
          .filter((x) => Number.isInteger(x) && x > 0)
      )
    );
    if (!parsedIds.length) return;

    const allowedSet = new Set((nodes || []).map((n) => n.id));
    const allowedIds = parsedIds.filter((id) => allowedSet.has(id));
    if (!allowedIds.length) return;

    setNodeMode(mode === "group" ? "group" : "manual");
    setSelectedNodeIds(allowedIds);
    if (mode !== "group") setNodeGroup("");

    push({
      title: "انتخاب نود اعمال شد",
      desc: `${allowedIds.length} نود از صفحه نودها اعمال شد.`,
      type: "success",
    });
  }, [nodes, defaultsLoaded, push]);

  React.useEffect(() => {
    if (!effectiveDurationPresets.length) return;
    const allowedPresetKeys = new Set(effectiveDurationPresets.map((x) => x.key));

    // When manual days are locked by reseller policy, enforce a valid preset strictly.
    if (customDaysLocked) {
      if (!allowedPresetKeys.has(preset)) {
        const fallback = effectiveDurationPresets[0];
        setPreset(fallback.key);
        setDays(fallback.days);
        return;
      }
      const p = effectiveDurationPresets.find((x) => x.key === preset);
      if (p && days !== p.days) {
        setDays(p.days);
        return;
      }
    } else {
      // Manual mode: keep free-typed day values even if not one of presets.
      // Only clear invalid preset selection silently.
      if (preset && !allowedPresetKeys.has(preset)) {
        setPreset("");
      }
    }

    if (days === 0 && userPolicy.enabled && !userPolicy.allow_no_expire) {
      const fallback = effectiveDurationPresets.find((x) => x.days > 0) || effectiveDurationPresets[0];
      setPreset(fallback.key);
      setDays(fallback.days);
      return;
    }
    if (days > 0 && userPolicy.enabled) {
      const minDays = Math.max(1, Number(userPolicy.min_days) || 1);
      const maxDays = Math.max(minDays, Number(userPolicy.max_days) || minDays);
      if (days < minDays) setDays(minDays);
      if (days > maxDays) setDays(maxDays);
    }
  }, [days, preset, effectiveDurationPresets, userPolicy]);

  React.useEffect(() => {
    if (!effectiveTrafficPresets.length) return;
    if (!customTrafficLocked) return;
    if (!effectiveTrafficPresets.includes(totalGb)) {
      setTotalGb(effectiveTrafficPresets[0]);
    }
  }, [customTrafficLocked, effectiveTrafficPresets, totalGb]);

  function applyDurationPreset(key: string) {
    if (userPolicy.enabled) {
      const allowed = new Set(effectiveDurationPresets.map((x) => x.key));
      if (!allowed.has(key)) return;
    }
    setPreset(key);
    const found = durationPresets.find((x) => x.key === key);
    if (found) setDays(found.days);
  }

  function buildLabel(index: number, count: number) {
    const base = label.trim() || randomLabel();
    const indexed = count > 1 ? `${base}-${index}` : base;
    return `${defaults.label_prefix || ""}${indexed}${defaults.label_suffix || ""}`;
  }

  function buildUsername(index: number, count: number): string | undefined {
    if (randomize) return undefined;
    const base = username.trim();
    if (!base) return undefined;
    const indexed = count > 1 ? `${base}_${index}` : base;
    return `${defaults.username_prefix || ""}${indexed}${defaults.username_suffix || ""}`;
  }

  function buildPayload(labelValue: string, usernameValue: string | undefined) {
    const node_ids = nodeMode === "manual" ? selectedNodeIds : undefined;
    const node_group = nodeMode === "group" ? nodeGroup || undefined : undefined;
    return {
      label: labelValue,
      username: usernameValue || undefined,
      randomize_username: randomize,
      total_gb: totalGb,
      days,
      duration_preset: preset || undefined,
      pricing_mode: pricingMode,
      node_ids,
      node_group,
    };
  }

  function validateBeforeSubmit() {
    if (nodeMode === "manual" && selectedNodeIds.length === 0) {
      throw new Error(t("newUser.nodeSelectRequired"));
    }
    if (nodeMode === "group" && !nodeGroup) {
      throw new Error(t("newUser.nodeGroupRequired"));
    }
  }

  async function fetchLinksForCreated(userId: number, labelValue: string, fallbackMaster: string): Promise<CreatedUserLinks> {
    try {
      const lr = await apiFetch<LinksResp>(`/api/v1/reseller/users/${userId}/links?refresh=true`);
      const node_links = (lr.node_links || []).map((nl) => {
        const meta = nodeMap.get(nl.node_id);
        const full = nl.config_download_url
          ? nl.config_download_url
          : nl.full_url
          ? nl.full_url
          : nl.direct_url
          ? normalizeUrl(nl.direct_url, meta?.base_url)
          : "";
        return {
          node_id: nl.node_id,
          node_label: (meta?.name || nl.node_name) ? `${meta?.name || nl.node_name} (#${nl.node_id})` : `Node #${nl.node_id}`,
          full_url: full,
          status: nl.status,
          detail: nl.detail,
        };
      });
      return {
        user_id: userId,
        label: labelValue,
        master_link: lr.master_link || fallbackMaster,
        node_links,
      };
    } catch {
      return {
        user_id: userId,
        label: labelValue,
        master_link: fallbackMaster,
        node_links: [],
      };
    }
  }

  async function doQuote() {
    setLoading(true);
    try {
      validateBeforeSubmit();
      const labelValue = buildLabel(1, 1);
      const payload = buildPayload(labelValue, buildUsername(1, 1));
      const res = await apiFetch<QuoteResp>("/api/v1/reseller/user-ops/quote", { method: "POST", body: JSON.stringify(payload) });
      setQuote(res);
      push({ title: "پیش‌فاکتور آماده شد", type: "success" });
    } catch (e: any) {
      push({ title: "خطا در محاسبه قیمت", desc: String(e.message || e), type: "error" });
    } finally {
      setLoading(false);
    }
  }

  async function doCreate() {
    setLoading(true);
    setCreating(true);
    const created: CreatedUserLinks[] = [];
    const issues: CreateIssue[] = [];
    cancelCreateRef.current = false;
    try {
      validateBeforeSubmit();
      const count = bulkEnabled ? Math.min(Math.max(1, Number(bulkCount) || 1), 50) : 1;
      setCreateSummary(null);
      setCreateTotal(count);
      setCreateDone(0);
      setCreateSuccess(0);
      setCreateFailed(0);
      setCreateCurrentLabel("");
      const base = typeof window !== "undefined" ? window.location.origin : "";

      let done = 0;
      let success = 0;
      let failed = 0;
      for (let i = 1; i <= count; i++) {
        if (cancelCreateRef.current) break;

        const labelValue = buildLabel(i, count);
        setCreateCurrentLabel(labelValue);
        const payload = buildPayload(labelValue, buildUsername(i, count));
        const ctrl = new AbortController();
        activeRequestRef.current = ctrl;
        try {
          const res = await apiFetch<CreateResp>("/api/v1/reseller/user-ops", {
            method: "POST",
            body: JSON.stringify(payload),
            signal: ctrl.signal,
          });
          const fallbackMaster = `${base}/api/v1/sub/${res.master_sub_token}`;
          const links = await fetchLinksForCreated(res.user_id, labelValue, fallbackMaster);
          created.push(links);
          success += 1;
          setCreateSuccess(success);
        } catch (e: any) {
          const msg = String(e?.message || e);
          if (cancelCreateRef.current || /abort/i.test(msg)) {
            break;
          }
          failed += 1;
          setCreateFailed(failed);
          issues.push({ label: labelValue, error: msg });
        } finally {
          activeRequestRef.current = null;
          done += 1;
          setCreateDone(done);
        }
      }

      setResultLinks(created);
      const summary: CreateSummary = {
        total: count,
        done,
        success,
        failed,
        cancelled: cancelCreateRef.current,
        issues,
      };
      setCreateSummary(summary);
      setResultOpen(true);
      await refreshMe();

      if (summary.cancelled) {
        push({
          title: "ساخت گروهی متوقف شد",
          desc: `انجام‌شده: ${summary.done} • موفق: ${summary.success} • ناموفق: ${summary.failed}`,
          type: "warning",
        });
      } else if (created.length === 1 && summary.failed === 0) {
        push({ title: "کاربر ساخته شد", desc: `ID: ${created[0].user_id}`, type: "success" });
      } else {
        push({
          title: summary.failed ? "ساخت گروهی با خطاهای جزئی انجام شد" : "کاربران ساخته شدند",
          desc: `موفق: ${summary.success} • ناموفق: ${summary.failed}`,
          type: summary.failed ? "warning" : "success",
        });
      }
    } catch (e: any) {
      if (created.length) {
        setResultLinks(created);
        setResultOpen(true);
      }
      push({ title: "خطا در ساخت کاربر", desc: String(e.message || e), type: "error" });
    } finally {
      activeRequestRef.current = null;
      setCreating(false);
      setCreateCurrentLabel("");
      setLoading(false);
    }
  }

  function cancelCreate() {
    cancelCreateRef.current = true;
    try {
      activeRequestRef.current?.abort();
    } catch {
      // ignore
    }
  }

  function copyAllMaster() {
    const all = resultLinks.map((x) => x.master_link).filter(Boolean).join("\n");
    copyText(all).then((ok) => push({ title: ok ? t("common.copied") : t("common.failed"), type: ok ? "success" : "error" }));
  }

  function copyAllDirect() {
    const all = resultLinks
      .flatMap((x) => x.node_links.map((n) => n.full_url).filter(Boolean))
      .filter(Boolean)
      .join("\n");
    copyText(all).then((ok) => push({ title: ok ? t("common.copied") : t("common.failed"), type: ok ? "success" : "error" }));
  }

  function onTrafficInput(value: string) {
    if (customTrafficLocked) return;
    const num = Number(value);
    if (!Number.isFinite(num)) {
      setTotalGb(0);
      return;
    }
    setTotalGb(Math.max(0, Math.floor(num)));
  }

  function onDaysInput(value: string) {
    if (customDaysLocked) return;
    const num = Number(value);
    if (!Number.isFinite(num)) {
      setDays(0);
      setPreset("");
      return;
    }
    const rounded = Math.max(0, Math.floor(num));
    let next = rounded;
    if (userPolicy.enabled && rounded > 0) {
      const minDays = Math.max(1, Number(userPolicy.min_days) || 1);
      const maxDays = Math.max(minDays, Number(userPolicy.max_days) || minDays);
      next = Math.min(maxDays, Math.max(minDays, rounded));
    }
    if (next === 0 && userPolicy.enabled && !userPolicy.allow_no_expire) {
      next = Math.max(1, Number(userPolicy.min_days) || 1);
    }
    setDays(next);
    const matched = effectiveDurationPresets.find((p) => p.days === next);
    setPreset(matched?.key || "");
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="text-xl font-semibold">{t("newUser.title")}</div>
          <div className="text-sm text-[hsl(var(--fg))]/70">{t("newUser.subtitle")}</div>
          {defaultsLoaded ? (
            <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))/0.5] px-3 py-2 text-xs text-[hsl(var(--fg))]/70">
              <div className="flex flex-wrap items-center gap-2">
                <Sparkles size={14} />
                <span>
                  پیش‌فرض‌ها اعمال شد: مدل قیمت <span className="font-medium">{pricingMode === "bundle" ? "Bundle" : "Per Node"}</span> • حالت نود <span className="font-medium">{nodeMode}</span>
                </span>
              </div>
              {userPolicy.enabled ? (
                <div className="mt-1 text-[11px] text-[hsl(var(--fg))]/65">
                  سیاست رسیلر فعال است: روز دستی <span className="font-medium">{userPolicy.allow_custom_days ? "روشن" : "خاموش"}</span> • حجم دستی{" "}
                  <span className="font-medium">{userPolicy.allow_custom_traffic ? "روشن" : "خاموش"}</span>
                </div>
              ) : null}
            </div>
          ) : null}
        </CardHeader>

        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))/0.3] p-4">
              <label className="text-sm flex items-center gap-2">
                {t("newUser.label")} <HelpTip text={t("help.label")} />
              </label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="مثلاً customer-01" />
              {(defaults.label_prefix || defaults.label_suffix) ? (
                <div className="text-xs text-[hsl(var(--fg))]/60">
                  پیشوند/پسوند Label از تنظیمات: <span dir="ltr">{defaults.label_prefix || ""}[label]{defaults.label_suffix || ""}</span>
                </div>
              ) : null}
            </div>

            <div className="space-y-2 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))/0.3] p-4">
              <label className="text-sm flex items-center gap-2">
                {t("newUser.username")} <HelpTip text={t("help.username")} />
              </label>
              <div className="flex gap-2">
                <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="اگر خالی باشد، نام پنل از label ساخته می‌شود" />
                <Button type="button" variant="outline" onClick={randomName}>{t("newUser.random")}</Button>
              </div>
              {(defaults.username_prefix || defaults.username_suffix) ? (
                <div className="text-xs text-[hsl(var(--fg))]/60">
                  پیشوند/پسوند Username از تنظیمات: <span dir="ltr">{defaults.username_prefix || ""}[username]{defaults.username_suffix || ""}</span>
                </div>
              ) : null}
              <label className="flex items-center gap-2 text-xs text-[hsl(var(--fg))]/70">
                <input type="checkbox" checked={randomize} onChange={(e) => setRandomize(e.target.checked)} />
                {t("newUser.serverRandom")}
              </label>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <div
              className={cn(
                "space-y-3 rounded-2xl border p-4 transition-all",
                "border-[hsl(var(--border))] bg-[hsl(var(--muted))/0.35]",
                customTrafficLocked ? "ring-1 ring-amber-400/50" : "hover:shadow-soft"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <label className="text-sm font-medium flex items-center gap-2">
                  <Gauge size={15} />
                  حجم کاربر (GB)
                </label>
                {customTrafficLocked ? (
                  <Badge variant="warning" className="gap-1">
                    <Lock size={12} /> محدود شده
                  </Badge>
                ) : null}
              </div>
              <div className="grid gap-2 sm:grid-cols-[220px,1fr] sm:items-center">
                <Input
                  className={cn("h-11 rounded-2xl text-base", customTrafficLocked ? "opacity-80" : "")}
                  type="number"
                  min={0}
                  value={totalGb}
                  disabled={customTrafficLocked}
                  onChange={(e) => onTrafficInput(e.target.value)}
                />
                <div className="flex flex-wrap gap-2">
                  {effectiveTrafficPresets.map((gb) => (
                    <Button key={gb} type="button" variant={totalGb === gb ? "primary" : "outline"} size="sm" onClick={() => setTotalGb(gb)}>
                      {gb} GB
                    </Button>
                  ))}
                </div>
              </div>
              <div className="text-xs text-[hsl(var(--fg))]/70">
                {customTrafficLocked
                  ? "طبق سیاست حساب، فقط حجم‌های مجاز قابل انتخاب هستند."
                  : "می‌توانید حجم را دستی وارد کنید یا از پکیج‌های آماده انتخاب کنید."}
              </div>
            </div>

            <div
              className={cn(
                "space-y-3 rounded-2xl border p-4 transition-all",
                "border-[hsl(var(--border))] bg-[hsl(var(--muted))/0.35]",
                customDaysLocked ? "ring-1 ring-amber-400/50" : "hover:shadow-soft"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <label className="text-sm font-medium flex items-center gap-2">
                  <CalendarDays size={15} />
                  مدت زمان (روز)
                </label>
                {customDaysLocked ? (
                  <Badge variant="warning" className="gap-1">
                    <Lock size={12} /> محدود شده
                  </Badge>
                ) : null}
              </div>
              <div className="grid gap-2 sm:grid-cols-[220px,1fr] sm:items-center">
                <Input
                  className={cn("h-11 rounded-2xl text-base", customDaysLocked ? "opacity-80" : "")}
                  type="number"
                  min={userPolicy.enabled ? (userPolicy.allow_no_expire ? 0 : Math.max(1, userPolicy.min_days)) : 0}
                  max={userPolicy.enabled ? Math.max(userPolicy.min_days, userPolicy.max_days) : 36500}
                  value={days}
                  disabled={customDaysLocked}
                  onChange={(e) => onDaysInput(e.target.value)}
                />
                <div className="flex flex-wrap gap-2">
                  {effectiveDurationPresets.map((p) => (
                    <Button
                      key={p.key}
                      type="button"
                      variant={preset === p.key ? "primary" : "outline"}
                      size="sm"
                      onClick={() => applyDurationPreset(p.key)}
                    >
                      {p.label}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="text-xs text-[hsl(var(--fg))]/70">
                {customDaysLocked
                  ? "روز دستی برای این حساب غیرفعال است و فقط پکیج‌های زمانی مجاز قابل استفاده هستند."
                  : userPolicy.enabled
                  ? `بازه روز مجاز: ${userPolicy.min_days} تا ${userPolicy.max_days}${userPolicy.allow_no_expire ? " • نامحدود مجاز" : ""}`
                  : "می‌توانید روز را دستی وارد کنید یا از پکیج‌های آماده انتخاب کنید."}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm flex items-center gap-2">
              {t("newUser.pricingMode")} <HelpTip text={t("help.pricingMode")} />
            </label>
            <div className="flex gap-2">
              <Button type="button" variant={pricingMode === "bundle" ? "primary" : "outline"} onClick={() => setPricingMode("bundle")}>{t("newUser.bundle")}</Button>
              <Button type="button" variant={pricingMode === "per_node" ? "primary" : "outline"} onClick={() => setPricingMode("per_node")}>{t("newUser.perNode")}</Button>
            </div>
            <div className="text-xs text-[hsl(var(--fg))]/70">{t("newUser.bundleHelp")}</div>
          </div>

          <div className="space-y-3">
            <label className="text-sm flex items-center gap-2">
              {t("newUser.nodeSelect")} <HelpTip text={t("help.nodeIds")} />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant={nodeMode === "all" ? "primary" : "outline"}
                onClick={() => {
                  setNodeMode("all");
                  setNodeGroup("");
                  if (pricingMode === "per_node") setPricingMode("bundle");
                }}
              >
                {t("newUser.nodesAll")}
              </Button>
              <Button
                type="button"
                variant={nodeMode === "manual" ? "primary" : "outline"}
                onClick={() => {
                  setNodeMode("manual");
                  setNodeGroup("");
                }}
              >
                {t("newUser.nodesManual")}
              </Button>
              <Button type="button" variant={nodeMode === "group" ? "primary" : "outline"} onClick={() => setNodeMode("group")}>
                {t("newUser.nodesGroup")}
              </Button>
            </div>

            {nodeMode === "all" ? (
              <div className="text-xs text-[hsl(var(--fg))]/70">{t("newUser.nodesAllHint")}</div>
            ) : null}

            {nodeMode === "group" ? (
              <div className="space-y-2">
                <select
                  className="w-full rounded-xl border border-[hsl(var(--border))] bg-transparent px-3 py-2 text-sm"
                  value={nodeGroup}
                  onChange={(e) => setNodeGroup(e.target.value)}
                >
                  <option value="">{t("newUser.nodeGroupNone")}</option>
                  {tagOptions.map((tg) => (
                    <option key={tg} value={tg}>
                      {tg}
                    </option>
                  ))}
                </select>
                <div className="text-xs text-[hsl(var(--fg))]/70">{t("newUser.nodeGroupHint")}</div>
              </div>
            ) : null}

            {nodeMode === "manual" ? (
              <div className="rounded-2xl border border-[hsl(var(--border))] p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Input value={nodePickQ} onChange={(e) => setNodePickQ(e.target.value)} placeholder={t("common.search")} />
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" onClick={() => toggleAll(true)}>{t("newUser.selectAll")}</Button>
                    <Button type="button" variant="outline" onClick={() => toggleAll(false)}>{t("newUser.clearAll")}</Button>
                  </div>
                </div>

                <div className="text-xs text-[hsl(var(--fg))]/70">
                  {allManualSelected
                    ? "همه نودهای مجاز انتخاب شده‌اند."
                    : selectedNodeIds.length
                    ? `${selectedNodeIds.length} نود انتخاب شده است.`
                    : "هیچ نودی انتخاب نشده است."}
                </div>

                <div className="grid gap-2 md:grid-cols-2">
                  {filteredNodes.map((n) => (
                    <label key={n.id} className="flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] px-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selectedNodeIds.includes(n.id)}
                        onChange={(e) => toggleOne(n.id, e.target.checked)}
                      />
                      <span className="truncate">{n.name} (#{n.id}) • {n.panel_type}</span>
                    </label>
                  ))}
                </div>
                {!filteredNodes.length ? <div className="text-xs text-[hsl(var(--fg))]/70">{t("common.empty")}</div> : null}
              </div>
            ) : null}
          </div>

          <div className="space-y-2 rounded-2xl border border-[hsl(var(--border))] p-3">
            <div className="flex items-center gap-2">
              <Switch checked={bulkEnabled} onCheckedChange={setBulkEnabled} />
              <div className="text-sm font-medium">{t("newUser.bulk")}</div>
            </div>
            {bulkEnabled ? (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  {bulkPresets.map((n) => (
                    <Button key={n} type="button" variant={bulkCount === n ? "primary" : "outline"} onClick={() => setBulkCount(n)}>
                      {n}
                    </Button>
                  ))}
                </div>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={bulkCount}
                  onChange={(e) => setBulkCount(Math.min(50, Math.max(1, Number(e.target.value) || 1)))}
                />
                <div className="text-xs text-[hsl(var(--fg))]/70">{t("newUser.bulkHint")}</div>
              </div>
            ) : (
              <div className="text-xs text-[hsl(var(--fg))]/70">{t("newUser.bulkOff")}</div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={loading} onClick={doQuote}>{t("newUser.quote")}</Button>
            <Button type="button" disabled={loading} onClick={doCreate}>{bulkEnabled ? t("newUser.createBulk") : t("newUser.create")}</Button>
            {creating ? (
              <Button type="button" variant="outline" disabled={!creating} onClick={cancelCreate}>توقف ساخت</Button>
            ) : null}
            <Button type="button" variant="ghost" onClick={() => r.push("/app/users")}>{t("newUser.back")}</Button>
          </div>

          {creating ? (
            <div className="rounded-2xl border border-[hsl(var(--border))] p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <div className="font-medium">در حال ساخت کاربران...</div>
                <div className="text-xs text-[hsl(var(--fg))]/70">
                  {createDone}/{createTotal}
                </div>
              </div>
              <Progress value={createTotal ? Math.round((createDone / createTotal) * 100) : 0} />
              <div className="text-xs text-[hsl(var(--fg))]/70">
                موفق: {createSuccess} • ناموفق: {createFailed}
                {createCurrentLabel ? ` • آخرین مورد: ${createCurrentLabel}` : ""}
              </div>
            </div>
          ) : null}

          {quote ? (
            <Card>
              <CardHeader>
                <div className="text-sm text-[hsl(var(--fg))]/70">پیش‌فاکتور</div>
                <div className="text-xl font-semibold">
                  {fmtNumber(quote.total_amount * (bulkEnabled ? bulkCount : 1))} تومان
                </div>
                {bulkEnabled ? (
                  <div className="text-xs text-[hsl(var(--fg))]/60">
                    {t("newUser.bulkTotalHint").replace("{count}", String(bulkCount)).replace("{per}", fmtNumber(quote.total_amount))}
                  </div>
                ) : null}
              </CardHeader>
              <CardContent className="text-sm space-y-1">
                <div>هزینه زمان: {fmtNumber(quote.time_amount)}</div>
                <div className="text-[hsl(var(--fg))]/70">جزئیات per-node (اگر per_node باشد):</div>
                <pre className="text-xs bg-[hsl(var(--muted))] rounded-xl p-3 overflow-auto">{JSON.stringify(quote.per_node_amount, null, 2)}</pre>
              </CardContent>
            </Card>
          ) : null}
        </CardContent>
      </Card>

      <Modal
        open={resultOpen}
        onClose={() => {
          setResultOpen(false);
          setResultLinks([]);
          setCreateSummary(null);
        }}
        title={bulkEnabled ? "نتیجه ساخت گروهی" : "نتیجه ساخت کاربر"}
        className="max-w-4xl"
      >
        <div className="space-y-4 text-sm">
          {createSummary ? (
            <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))] p-3 text-xs text-[hsl(var(--fg))]/80">
              کل: {createSummary.total} • انجام‌شده: {createSummary.done} • موفق: {createSummary.success} • ناموفق: {createSummary.failed}
              {createSummary.cancelled ? " • وضعیت: متوقف‌شده توسط کاربر" : ""}
            </div>
          ) : null}

          <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))] p-3 text-xs text-[hsl(var(--fg))]/80">
            پیشنهاد: برای استفاده روزمره، لینک مستقیم هر پنل را کپی کنید. لینک تجمیعی Guardino بیشتر برای کاربرهای چندنودی مناسب است.
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" className="gap-2" onClick={copyAllDirect}>
              <Link2 size={16} /> کپی همه لینک‌های مستقیم
            </Button>
            <Button type="button" variant="outline" className="gap-2" onClick={copyAllMaster}>
              <Copy size={16} /> کپی همه لینک‌های Guardino
            </Button>
          </div>

          <div className="space-y-3">
            {resultLinks.map((x) => (
              <div key={x.user_id} className="rounded-xl border border-[hsl(var(--border))] p-3 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs text-[hsl(var(--fg))]/70">{x.label} • #{x.user_id}</div>
                  <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => r.push(`/app/users/${x.user_id}`)}>
                    <ExternalLink size={14} /> جزئیات کاربر
                  </Button>
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-medium">اشتراک‌های مستقیم پنل (پیشنهادی)</div>
                  {x.node_links.length ? (
                    <div className="space-y-2">
                      {x.node_links.map((n) => (
                        <div key={`${x.user_id}-${n.node_id}`} className="rounded-xl border border-[hsl(var(--border))] p-2">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-xs text-[hsl(var(--fg))]/70">{n.node_label}</div>
                            <Badge variant={n.status === "ok" ? "success" : n.status === "missing" ? "warning" : "danger"}>{n.status}</Badge>
                          </div>
                          {n.full_url ? (
                            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                              <Input value={n.full_url} readOnly />
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="gap-2 sm:w-[140px]"
                                onClick={() => copyText(n.full_url).then((ok) => push({ title: ok ? t("common.copied") : t("common.failed"), type: ok ? "success" : "error" }))}
                              >
                                <Copy size={14} /> {t("common.copy")}
                              </Button>
                            </div>
                          ) : (
                            <div className="mt-2 text-xs text-[hsl(var(--fg))]/70">{n.detail || t("users.noLink")}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-[hsl(var(--fg))]/70">لینک مستقیمی ثبت نشده است.</div>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-medium">اشتراک تجمیعی Guardino</div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input value={x.master_link} readOnly />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-2 sm:w-[140px]"
                      onClick={() => copyText(x.master_link).then((ok) => push({ title: ok ? t("common.copied") : t("common.failed"), type: ok ? "success" : "error" }))}
                    >
                      <Copy size={14} /> {t("common.copy")}
                    </Button>
                  </div>
                </div>
              </div>
            ))}
            {!resultLinks.length ? <div className="text-xs text-[hsl(var(--fg))]/70">{t("common.empty")}</div> : null}
          </div>

          {createSummary?.issues?.length ? (
            <div className="space-y-2">
              <div className="text-xs font-medium text-red-600">خطاها</div>
              <div className="max-h-56 overflow-auto rounded-xl border border-red-300/60 p-2">
                {createSummary.issues.map((it, idx) => (
                  <div key={`${it.label}-${idx}`} className="border-b border-red-200/60 py-1 text-xs last:border-b-0">
                    <span className="font-medium">{it.label}</span>: {it.error}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
