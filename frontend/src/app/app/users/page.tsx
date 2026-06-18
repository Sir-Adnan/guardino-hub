"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { copyText } from "@/lib/copy";
import { fmtNumber } from "@/lib/format";
import { formatJalaliDateTime } from "@/lib/jalali";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/components/auth-context";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/i18n-context";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { Switch } from "@/components/ui/switch";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { JalaliDateTimePicker } from "@/components/ui/jalali-datetime-picker";
import { useToast } from "@/components/ui/toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Pagination } from "@/components/ui/pagination";
import {
  ArrowDownUp,
  Copy,
  ClipboardList,
  Pencil,
  Power,
  RotateCcw,
  Server,
  Trash2,
  Users,
  Link2,
  SquarePen,
  Layers,
  Download,
  QrCode,
  ExternalLink,
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock3,
  Hourglass,
  LayoutGrid,
  List,
  Sparkles,
  Gauge,
  Unlink2,
} from "lucide-react";

type UserOut = { id: number; label: string; total_gb: number; used_bytes: number; expire_at: string; status: string; create_status?: string | null };
type UsersPage = { items: UserOut[]; total: number };
type ResellerStatsOut = {
  users_total: number;
  users_active: number;
  users_disabled: number;
  used_bytes_total: number;
  sold_gb_total: number;
};
type LinksResp = {
  user_id: number;
  master_link?: string | null;
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
type NodeLinkOut = LinksResp["node_links"][number];
type NodeLite = { id: number; name: string; base_url: string };
type UserDefaultsEnvelope = {
  effective?: {
    show_guardino_master_sub?: boolean;
  };
};
type ResellerUserPolicy = {
  enabled: boolean;
  restrict_edit_to_renewal_only: boolean;
  renewal_policy: string;
  allowed_duration_presets: string[];
  allowed_traffic_gb: number[];
};

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

type OpResult = { ok: boolean; charged_amount: number; refunded_amount: number; new_balance: number; user_id: number; detail?: string };
const AUTO_REFRESH_MS = 30_000;
const DURATION_PRESETS = [
  { key: "7d", label: "7 روز", days: 7 },
  { key: "1m", label: "1 ماه", days: 31 },
  { key: "3m", label: "3 ماه", days: 90 },
  { key: "6m", label: "6 ماه", days: 180 },
  { key: "1y", label: "1 سال", days: 365 },
];
const TRAFFIC_PRESETS = [20, 30, 50, 70, 100, 150, 200];

type StatusFilter = "all" | "active" | "disabled" | "expired" | "limited" | "on_hold";
type SortMode = "priority" | "expiry" | "usage" | "newest";
type ViewMode = "grid2" | "single";

function bytesToGb(bytes: number) {
  return bytes / (1024 * 1024 * 1024);
}
function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

function safeDaysLeft(expire_at: string): number | null {
  const exp = new Date(expire_at);
  if (Number.isNaN(exp.getTime())) return null;
  const now = new Date();
  return Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function isUsageLimited(u: UserOut): boolean {
  const totalBytes = Math.max(0, Number(u.total_gb || 0)) * 1024 * 1024 * 1024;
  return totalBytes > 0 && Number(u.used_bytes || 0) >= totalBytes;
}

function userStatusInfo(u: UserOut) {
  const s = (u.status || "").toLowerCase();
  const createStatus = String(u.create_status || "").toLowerCase();
  const days = safeDaysLeft(u.expire_at);
  const expired = days !== null && days < 0;
  const limited = isUsageLimited(u);

  if (s === "active" && createStatus === "on_hold" && !expired && !limited) {
    return {
      key: "on_hold" as const,
      v: "default" as const,
      label: "در انتظار اتصال",
      note: "هنوز اولین اتصال کاربر ثبت نشده است.",
      Icon: Hourglass,
      badgeClass: "border-violet-500/35 bg-violet-500/15 text-violet-700 dark:text-violet-300",
      noteClass: "border-violet-400/35 bg-violet-500/10 text-violet-700 dark:text-violet-300",
      cardGlow: "from-violet-500/12 via-transparent to-sky-500/10",
    };
  }
  if (expired) {
    return {
      key: "expired" as const,
      v: "danger" as const,
      label: "منقضی شده",
      note: "زمان اشتراک این کاربر تمام شده است.",
      Icon: Clock3,
      badgeClass: "border-rose-500/35 bg-rose-500/15 text-rose-700 dark:text-rose-300",
      noteClass: "border-rose-400/35 bg-rose-500/10 text-rose-700 dark:text-rose-300",
      cardGlow: "from-rose-500/14 via-transparent to-orange-500/10",
    };
  }
  if (limited) {
    return {
      key: "limited" as const,
      v: "warning" as const,
      label: "اتمام حجم",
      note: "حجم اشتراک به سقف تعیین‌شده رسیده است.",
      Icon: AlertTriangle,
      badgeClass: "border-amber-500/35 bg-amber-500/15 text-amber-700 dark:text-amber-300",
      noteClass: "border-amber-400/35 bg-amber-500/10 text-amber-700 dark:text-amber-300",
      cardGlow: "from-amber-500/14 via-transparent to-yellow-500/10",
    };
  }
  if (s === "disabled") {
    return {
      key: "disabled" as const,
      v: "muted" as const,
      label: "غیرفعال",
      note: "دسترسی این کاربر در گاردینو غیرفعال است.",
      Icon: Ban,
      badgeClass: "",
      noteClass: "border-slate-400/25 bg-slate-500/10 text-[hsl(var(--fg))]/75",
      cardGlow: "from-slate-500/10 via-transparent to-slate-500/5",
    };
  }
  if (s === "active") {
    return {
      key: "active" as const,
      v: "success" as const,
      label: "فعال",
      note: "اشتراک فعال است.",
      Icon: CheckCircle2,
      badgeClass: "",
      noteClass: "border-emerald-400/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
      cardGlow: "from-emerald-500/12 via-transparent to-sky-500/10",
    };
  }
  return {
    key: "unknown" as const,
    v: "default" as const,
    label: u.status || "نامشخص",
    note: "وضعیت کاربر نامشخص است.",
    Icon: Sparkles,
    badgeClass: "",
    noteClass: "border-[hsl(var(--border))] bg-[hsl(var(--surface-card-3))]/60 text-[hsl(var(--fg))]/75",
    cardGlow: "from-[hsl(var(--accent)/0.10)] via-transparent to-transparent",
  };
}

function statusBadge(status: string, createStatus?: string | null) {
  const s = (status || "").toLowerCase();
  if (s === "active" && String(createStatus || "").toLowerCase() === "on_hold") {
    return {
      v: "default" as const,
      label: "در انتظار اتصال",
      Icon: Sparkles,
      className: "border-violet-500/35 bg-violet-500/15 text-violet-700 dark:text-violet-300",
    };
  }
  if (s === "active") return { v: "success" as const, label: "فعال", Icon: CheckCircle2, className: "" };
  if (s === "disabled") return { v: "muted" as const, label: "غیرفعال", Icon: Ban, className: "" };
  if (s === "expired") return { v: "danger" as const, label: "منقضی", Icon: Ban, className: "" };
  return { v: "default" as const, label: status || "—", Icon: Sparkles, className: "" };
}

function computePriority(u: UserOut) {
  const s = (u.status || "").toLowerCase();
  const totalBytes = (u.total_gb || 0) * 1024 * 1024 * 1024;
  const pct = totalBytes > 0 ? clamp01((u.used_bytes || 0) / totalBytes) : 0;
  const percent = Math.round(pct * 100);
  const days = safeDaysLeft(u.expire_at);
  const state = userStatusInfo(u);

  if (state.key === "expired" || state.key === "limited") return { level: "high" as const, percent, days };
  if (s === "expired" || (days !== null && days < 0)) return { level: "high" as const, percent, days };
  if ((days !== null && days <= 3) || percent >= 90) return { level: "high" as const, percent, days };
  if ((days !== null && days <= 7) || percent >= 80) return { level: "med" as const, percent, days };
  return { level: "low" as const, percent, days };
}

function panelLabel(panelType?: string) {
  const p = String(panelType || "").toLowerCase();
  if (p === "wg_dashboard") return "وایرگارد";
  return "لینک مستقیم";
}

function qrImageUrl(value: string, size: number = 220) {
  const s = Math.max(80, Math.min(512, Number(size) || 220));
  return `https://api.qrserver.com/v1/create-qr-code/?size=${s}x${s}&margin=8&data=${encodeURIComponent(value)}`;
}

function fmtGig(value: number) {
  const n = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 1 }).format(n);
}

function fmtTrafficBytes(bytes: number) {
  const safe = Math.max(0, Number(bytes) || 0);
  if (safe > 0 && safe < 1024 * 1024 * 1024) {
    const mb = Math.max(1, Math.ceil(safe / (1024 * 1024)));
    return `${new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 0 }).format(mb)} مگابایت`;
  }
  return `${fmtGig(safe / (1024 * 1024 * 1024))} گیگ`;
}

function usagePercentLabel(percent: number, usedBytes: number) {
  return usedBytes > 0 && percent === 0 ? "<۱٪" : `${percent}٪`;
}

function progressTone(percent: number) {
  if (percent >= 90) return "from-rose-500 via-red-500 to-orange-500";
  if (percent >= 70) return "from-amber-500 via-orange-500 to-yellow-500";
  return "from-[hsl(var(--accent))] via-[hsl(var(--accent)/0.82)] to-[hsl(var(--accent)/0.6)]";
}

export default function UsersPage() {
  const router = useRouter();
  const { me, refresh: refreshMe } = useAuth();
  const { t } = useI18n();
  const { push } = useToast();
  const locked = (me?.balance ?? 1) <= 0;

  const [q, setQ] = React.useState("");
  const [debouncedQ, setDebouncedQ] = React.useState("");
  const [data, setData] = React.useState<UsersPage | null>(null);
  const [resellerStats, setResellerStats] = React.useState<ResellerStatsOut | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<StatusFilter>("all");
  const [sortMode, setSortMode] = React.useState<SortMode>("newest");
  const [viewMode, setViewMode] = React.useState<ViewMode>("grid2");

  const [nodes, setNodes] = React.useState<NodeLite[] | null>(null);
  const [userPolicy, setUserPolicy] = React.useState<ResellerUserPolicy | null>(null);
  const [showMasterSub, setShowMasterSub] = React.useState<boolean>(true);
  const [quickLinks, setQuickLinks] = React.useState<Record<number, { loading: boolean; data?: LinksResp; error?: string }>>({});
  const nodeMap = React.useMemo(() => {
    const m = new Map<number, NodeLite>();
    (nodes || []).forEach((n) => m.set(n.id, n));
    return m;
  }, [nodes]);

  const [linksOpen, setLinksOpen] = React.useState(false);
  const [linksUser, setLinksUser] = React.useState<UserOut | null>(null);
  const [links, setLinks] = React.useState<LinksResp | null>(null);
  const [linksErr, setLinksErr] = React.useState<string | null>(null);
  const [qrOpen, setQrOpen] = React.useState(false);
  const [qrUser, setQrUser] = React.useState<UserOut | null>(null);
  const [qrLinks, setQrLinks] = React.useState<LinksResp | null>(null);
  const [qrErr, setQrErr] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [confirmKind, setConfirmKind] = React.useState<"reset" | "revoke" | "delete" | null>(null);
  const [confirmUser, setConfirmUser] = React.useState<UserOut | null>(null);
  const [editOpen, setEditOpen] = React.useState(false);
  const [editUser, setEditUser] = React.useState<UserOut | null>(null);
  const [quickMode, setQuickMode] = React.useState<"renewal" | "extend" | "add" | "dec" | "time_dec">("extend");
  const [editDays, setEditDays] = React.useState(31);
  const [editDecDays, setEditDecDays] = React.useState(7);
  const [editAddGb, setEditAddGb] = React.useState(10);
  const [editDecGb, setEditDecGb] = React.useState(5);
  const [editRenewDays, setEditRenewDays] = React.useState(31);
  const [editRenewGb, setEditRenewGb] = React.useState(30);
  const [editTargetDate, setEditTargetDate] = React.useState<Date | null>(null);
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(50);
  const [copyHint, setCopyHint] = React.useState<{ text: string; x: number; y: number; id: number } | null>(null);
  const copyHintTimerRef = React.useRef<number | null>(null);

  async function load() {
    setErr(null);
    try {
      const offset = (page - 1) * pageSize;
      const params = new URLSearchParams({ offset: String(offset), limit: String(pageSize) });
      const search = debouncedQ.trim();
      if (search) params.set("q", search);
      if (filter !== "all") params.set("status", filter);
      const res = await apiFetch<UsersPage>(`/api/v1/reseller/users?${params.toString()}`);
      setData(res);
      try {
        const statsRes = await apiFetch<ResellerStatsOut>("/api/v1/reseller/stats");
        setResellerStats(statsRes);
      } catch {
        // Keep users list functional even if stats endpoint is temporarily unavailable.
      }
    } catch (e: any) {
      setErr(String(e.message || e));
    }
  }


  async function loadNodes() {
    if (nodes) return;
    try {
      const res = await apiFetch<any>("/api/v1/reseller/nodes");
      const arr = res?.items || res || [];
      setNodes(arr.map((n: any) => ({ id: n.id, name: n.name, base_url: n.base_url || "" })));
    } catch {
      // ignore
    }
  }

  async function loadPolicy() {
    try {
      const policy = await apiFetch<ResellerUserPolicy>("/api/v1/reseller/settings/user-policy");
      setUserPolicy(policy || null);
    } catch {
      // Keep edit UI usable if policy endpoint is temporarily unavailable.
    }
  }

  async function loadUserDefaults() {
    try {
      const env = await apiFetch<UserDefaultsEnvelope>("/api/v1/reseller/settings/user-defaults");
      setShowMasterSub(!!env?.effective?.show_guardino_master_sub);
    } catch {
      setShowMasterSub(true);
    }
  }

  React.useEffect(() => {
    load();
  }, [page, pageSize, debouncedQ, filter]);

  React.useEffect(() => {
    const timer = window.setInterval(() => {
      load().catch(() => undefined);
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [page, pageSize, debouncedQ, filter]);

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQ(q.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [q]);

  React.useEffect(() => {
    setPage(1);
  }, [filter]);

  React.useEffect(() => {
    loadNodes().catch(() => undefined);
    loadPolicy().catch(() => undefined);
    loadUserDefaults().catch(() => undefined);
  }, []);

  React.useEffect(() => {
    try {
      const saved = (window.localStorage.getItem("users_view_mode") || "").trim();
      if (saved === "single" || saved === "grid2") setViewMode(saved);
    } catch {
      // ignore
    }
  }, []);

  React.useEffect(() => {
    try {
      window.localStorage.setItem("users_view_mode", viewMode);
    } catch {
      // ignore
    }
  }, [viewMode]);

  React.useEffect(() => {
    return () => {
      if (copyHintTimerRef.current) window.clearTimeout(copyHintTimerRef.current);
    };
  }, []);

  function applyFilter(items: UserOut[]) {
    const qq = debouncedQ.trim().toLowerCase();
    let out = items;
    if (qq) out = out.filter((u) => (u.label || "").toLowerCase().includes(qq));

    if (filter !== "all") {
      out = out.filter((u) => {
        const state = userStatusInfo(u).key;
        if (filter === "active") return state === "active";
        if (filter === "disabled") return state === "disabled";
        if (filter === "expired") return state === "expired";
        if (filter === "limited") return state === "limited";
        if (filter === "on_hold") return state === "on_hold";
        return true;
      });
    }

    return out;
  }

  function applySort(items: UserOut[]) {
    const arr = [...items];

    if (sortMode === "newest") {
      arr.sort((a, b) => (b.id || 0) - (a.id || 0));
      return arr;
    }

    if (sortMode === "usage") {
      arr.sort((a, b) => computePriority(b).percent - computePriority(a).percent);
      return arr;
    }

    if (sortMode === "expiry") {
      arr.sort((a, b) => {
        const da = computePriority(a).days;
        const db = computePriority(b).days;
        const va = da === null ? 10_000 : da;
        const vb = db === null ? 10_000 : db;
        return va - vb;
      });
      return arr;
    }

    // priority
    const weight = { high: 3, med: 2, low: 1 } as const;
    arr.sort((a, b) => {
      const pa = computePriority(a);
      const pb = computePriority(b);
      const wa = weight[pa.level];
      const wb = weight[pb.level];
      if (wb !== wa) return wb - wa;
      // tie-break: higher usage first
      if (pb.percent !== pa.percent) return pb.percent - pa.percent;
      // tie-break: expiring sooner first
      const da = pa.days === null ? 10_000 : pa.days;
      const db = pb.days === null ? 10_000 : pb.days;
      return da - db;
    });

    return arr;
  }

  const rawItems = data?.items || [];
  const filtered = applyFilter(rawItems);
  const items = applySort(filtered);
  const renewalOnly = !!(userPolicy?.enabled && userPolicy.restrict_edit_to_renewal_only);
  const renewalDurationPresets = React.useMemo(() => {
    const allowed = new Set((userPolicy?.allowed_duration_presets || []).map((x) => String(x).toLowerCase()));
    const filtered = DURATION_PRESETS.filter((p) => !allowed.size || allowed.has(p.key));
    return filtered.length ? filtered : DURATION_PRESETS;
  }, [userPolicy]);
  const renewalTrafficPresets = React.useMemo(() => {
    const allowed = (userPolicy?.allowed_traffic_gb || []).filter((x) => Number.isFinite(x) && x > 0);
    return allowed.length ? allowed : TRAFFIC_PRESETS;
  }, [userPolicy]);

  const stats = React.useMemo(() => {
    const total = resellerStats?.users_total ?? data?.total ?? rawItems.length;
    const active = resellerStats?.users_active ?? rawItems.filter((u) => (u.status || "").toLowerCase() === "active").length;
    const disabled = resellerStats?.users_disabled ?? rawItems.filter((u) => (u.status || "").toLowerCase() === "disabled").length;
    const pageUsedBytes = rawItems.reduce((sum, u) => sum + Number(u.used_bytes || 0), 0);
    const pageSoldGb = rawItems.reduce((sum, u) => sum + Number(u.total_gb || 0), 0);
    const usedBytes = resellerStats?.used_bytes_total ?? pageUsedBytes;
    const soldGb = resellerStats?.sold_gb_total ?? pageSoldGb;
    return { total, active, disabled, usedGb: bytesToGb(usedBytes), soldGb };
  }, [rawItems, data?.total, resellerStats]);

  function showCopyHint(ev?: React.MouseEvent<HTMLElement> | null, text: string = t("common.copied")) {
    const x = ev ? ev.clientX : window.innerWidth / 2;
    const y = ev ? ev.clientY : window.innerHeight / 2;
    const id = Date.now();
    setCopyHint({ text, x, y, id });
    if (copyHintTimerRef.current) window.clearTimeout(copyHintTimerRef.current);
    copyHintTimerRef.current = window.setTimeout(() => {
      setCopyHint((prev) => (prev?.id === id ? null : prev));
    }, 1100);
  }

  async function fetchUserLinks(u: UserOut, refresh = false) {
    await loadNodes();
    return await apiFetch<LinksResp>(`/api/v1/reseller/users/${u.id}/links?refresh=${refresh ? "true" : "false"}`);
  }

  function resolveNodeLink(nl: NodeLinkOut) {
    if (nl.config_download_url) return nl.config_download_url;
    const node = nodeMap.get(nl.node_id);
    if (nl.full_url) return nl.full_url;
    if (nl.direct_url) return normalizeUrl(nl.direct_url, node?.base_url);
    return "";
  }

  function extractDirectLinks(res: LinksResp) {
    return (res.node_links || []).map((nl) => resolveNodeLink(nl)).filter(Boolean);
  }

  function nodeLinkName(nl: NodeLinkOut) {
    const node = nodeMap.get(nl.node_id);
    return node?.name || nl.node_name || `Node #${nl.node_id}`;
  }

  async function copyResolvedLink(value: string, label: string) {
    if (!value) {
      push({ title: "لینکی برای کپی وجود ندارد", type: "warning" });
      return;
    }
    const ok = await copyText(value);
    if (ok) showCopyHint(null, label);
    else push({ title: t("common.failed"), type: "error" });
  }

  async function ensureQuickLinks(u: UserOut, refresh = false) {
    const current = quickLinks[u.id];
    if (!refresh && current?.data) return current.data;
    setQuickLinks((prev) => ({ ...prev, [u.id]: { loading: true, data: current?.data } }));
    try {
      const res = await fetchUserLinks(u, refresh);
      setQuickLinks((prev) => ({ ...prev, [u.id]: { loading: false, data: res } }));
      return res;
    } catch (e: any) {
      const message = String(e.message || e);
      setQuickLinks((prev) => ({ ...prev, [u.id]: { loading: false, error: message } }));
      return null;
    }
  }

  function quickLinkMenuItems(u: UserOut) {
    const state = quickLinks[u.id];
    const data = state?.data;
    if (state?.loading && !data) {
      return [{ label: "در حال دریافت لینک‌ها...", icon: <Sparkles size={16} />, disabled: true, onClick: () => {} }];
    }
    if (state?.error && !data) {
      return [
        { label: "دریافت لینک‌ها ناموفق بود", icon: <AlertTriangle size={16} />, disabled: true, onClick: () => {} },
        { label: "تلاش دوباره", icon: <RotateCcw size={16} />, onClick: () => { void ensureQuickLinks(u, true); } },
      ];
    }
    if (!data) {
      return [{ label: "برای دریافت لینک‌ها کلیک کنید", icon: <Link2 size={16} />, onClick: () => { void ensureQuickLinks(u, true); } }];
    }

    const directItems: MenuItem[] = (data.node_links || []).map((nl) => {
      const link = resolveNodeLink(nl);
      const name = nodeLinkName(nl);
      return {
        label: link ? `کپی لینک ساب ${name}` : `${name} - لینک موجود نیست`,
        icon: <Server size={16} />,
        disabled: !link,
        onClick: () => copyResolvedLink(link, `لینک ${name} کپی شد`),
      };
    });
    const copyableDirect = (data.node_links || []).map((nl) => resolveNodeLink(nl)).filter(Boolean);
    const allLinks = [...copyableDirect, showMasterSub ? data.master_link : null].filter(Boolean) as string[];
    const items: MenuItem[] = [
      {
        label: "کپی همه لینک‌های قابل استفاده",
        icon: <ClipboardList size={16} />,
        disabled: allLinks.length === 0,
        onClick: () => copyResolvedLink(allLinks.join("\n"), "همه لینک‌ها کپی شد"),
      },
      ...directItems,
    ];
    if (showMasterSub) {
      items.push({
        label: data.master_link ? "کپی ساب مرکزی Guardino" : "ساب مرکزی Guardino غیرفعال است",
        icon: <Link2 size={16} />,
        disabled: !data.master_link,
        onClick: () => copyResolvedLink(data.master_link || "", "ساب مرکزی کپی شد"),
      });
    }
    items.push({ label: "به‌روزرسانی لینک‌ها", icon: <RotateCcw size={16} />, onClick: () => { void ensureQuickLinks(u, true); } });
    return items;
  }

  async function copyPrimaryLinkForUser(u: UserOut, ev?: React.MouseEvent<HTMLElement>) {
    try {
      const res = await ensureQuickLinks(u, false);
      if (!res) {
        push({ title: "دریافت لینک‌ها ناموفق بود", type: "error" });
        return;
      }
      const direct = (res.node_links || [])
        .map((nl) => ({ link: resolveNodeLink(nl), name: nodeLinkName(nl) }))
        .filter((x) => !!x.link);
      const master = showMasterSub && res.master_link ? res.master_link : "";
      const target = direct[0] || (master ? { link: master, name: "Guardino" } : null);
      if (!target?.link) {
        push({ title: "لینکی برای کپی وجود ندارد", type: "warning" });
        return;
      }
      const ok = await copyText(target.link);
      if (ok) showCopyHint(ev || null, direct.length === 1 && !master ? "لینک اشتراک کپی شد" : `لینک ${target.name} کپی شد`);
      else push({ title: t("common.failed"), type: "error" });
    } catch (e: any) {
      push({ title: t("common.error"), desc: String(e.message || e), type: "error" });
    }
  }

  async function openLinks(u: UserOut) {
    setLinksUser(u);
    setLinksOpen(true);
    setLinks(null);
    setLinksErr(null);
    try {
      const res = await fetchUserLinks(u, true);
      setLinks(res);
    } catch (e: any) {
      setLinksErr(String(e.message || e));
    }
  }

  async function copyMaster(u: UserOut, ev?: React.MouseEvent<HTMLElement>) {
    try {
      const res = await fetchUserLinks(u, true);
      if (!res.master_link) {
        push({ title: "ساب مرکزی Guardino غیرفعال است", type: "warning" });
        return;
      }
      const ok = await copyText(res.master_link);
      if (ok) showCopyHint(ev || null, t("common.copied"));
      else push({ title: t("common.failed"), type: "error" });
    } catch (e: any) {
      push({ title: t("common.error"), desc: String(e.message || e), type: "error" });
    }
  }

  async function copyAllLinksForUser(u: UserOut, ev?: React.MouseEvent<HTMLElement>) {
    try {
      const res = await fetchUserLinks(u, true);
      const direct = extractDirectLinks(res);
      const lines = [...direct, showMasterSub ? res.master_link : null].filter(Boolean).join("\n");
      if (!lines) {
        push({ title: "لینکی برای کپی وجود ندارد", type: "warning" });
        return;
      }
      const ok = await copyText(lines);
      if (ok) showCopyHint(ev || null, "همه لینک‌ها کپی شد");
      else push({ title: t("common.failed"), type: "error" });
    } catch (e: any) {
      push({ title: t("common.error"), desc: String(e.message || e), type: "error" });
    }
  }

  async function openQr(u: UserOut) {
    setQrUser(u);
    setQrOpen(true);
    setQrErr(null);
    setQrLinks(null);
    try {
      const res = await fetchUserLinks(u, true);
      setQrLinks(res);
    } catch (e: any) {
      setQrErr(String(e.message || e));
    }
  }

  const qrItems = React.useMemo(() => {
    if (!qrLinks) return [] as Array<{ key: string; title: string; subtitle: string; url: string; isWg: boolean }>;
    const out: Array<{ key: string; title: string; subtitle: string; url: string; isWg: boolean }> = [];
    if (qrLinks.master_link) {
      out.push({
        key: "master",
        title: "اشتراک مرکزی",
        subtitle: "لینک تجمیعی",
        url: qrLinks.master_link,
        isWg: false,
      });
    }
    for (const nl of qrLinks.node_links || []) {
      const link = resolveNodeLink(nl);
      if (!link) continue;
      const node = nodeMap.get(nl.node_id);
      const title = node?.name || nl.node_name || `Node #${nl.node_id}`;
      const isWg = (nl.panel_type || "").toLowerCase() === "wg_dashboard";
      out.push({
        key: `node-${nl.node_id}`,
        title,
        subtitle: `${panelLabel(nl.panel_type)} (#${nl.node_id})`,
        url: link,
        isWg,
      });
    }
    return out;
  }, [nodeMap, qrLinks]);

  async function op(userId: number, path: string, body: any) {
    setBusyId(userId);
    try {
      await apiFetch<OpResult>(path, { method: "POST", body: JSON.stringify(body) });
      await load();
      await refreshMe().catch(() => undefined);
      push({ title: "OK", type: "success" });
      return true;
    } catch (e: any) {
      push({ title: t("common.error"), desc: String(e.message || e), type: "error" });
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function setStatus(u: UserOut, active: boolean) {
    await op(u.id, `/api/v1/reseller/users/${u.id}/set-status`, { status: active ? "active" : "disabled" });
  }

  async function resetUsage(u: UserOut) {
    await op(u.id, `/api/v1/reseller/users/${u.id}/reset-usage`, {});
  }

  async function revoke(u: UserOut) {
    await op(u.id, `/api/v1/reseller/users/${u.id}/revoke`, {});
    if (linksOpen && linksUser?.id === u.id) {
      await openLinks(u);
    }
    if (qrOpen && qrUser?.id === u.id) {
      await openQr(u);
    }
  }

  function ask(kind: "reset" | "revoke" | "delete", u: UserOut) {
    setConfirmKind(kind);
    setConfirmUser(u);
    setConfirmOpen(true);
  }

  async function doConfirm() {
    if (!confirmUser || !confirmKind) return;
    const u = confirmUser;
    setConfirmOpen(false);
    if (confirmKind === "reset") await resetUsage(u);
    if (confirmKind === "revoke") await revoke(u);
    if (confirmKind === "delete") await op(u.id, `/api/v1/reseller/users/${u.id}/refund`, { action: "delete" });
  }

  function openQuickEdit(u: UserOut) {
    setEditUser(u);
    setQuickMode("renewal");
    setEditDays(31);
    setEditDecDays(7);
    setEditAddGb(10);
    setEditDecGb(5);
    setEditRenewDays(31);
    setEditRenewGb(30);
    const exp = new Date(u.expire_at);
    setEditTargetDate(Number.isNaN(exp.getTime()) ? new Date() : exp);
    setEditOpen(true);
  }

  function computeDaysDeltaFromTarget(currentExpireAt: string, target: Date | null) {
    if (!target || Number.isNaN(target.getTime())) return { ok: false as const, reason: "format" };
    const current = new Date(currentExpireAt);
    if (Number.isNaN(current.getTime())) return { ok: false as const, reason: "current" };
    const diffMs = target.getTime() - current.getTime();
    const diffDays = Math.ceil(Math.abs(diffMs) / (1000 * 60 * 60 * 24));
    return { ok: true as const, direction: diffMs >= 0 ? "up" : "down", diffDays };
  }

  function FilterButton({ value, label }: { value: StatusFilter; label: string }) {
    const active = filter === value;
    return (
      <button
        type="button"
        onClick={() => setFilter(value)}
        className={
          "h-9 shrink-0 rounded-full border px-3.5 text-xs font-semibold transition-all duration-200 " +
          (active
            ? "border-transparent bg-[hsl(var(--accent))] text-[hsl(var(--accent-fg))] shadow-soft"
            : "border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] text-[hsl(var(--fg))]/78 hover:border-[hsl(var(--accent)/0.35)] hover:bg-[hsl(var(--surface-card-3))]")
        }
      >
        {label}
      </button>
    );
  }

  function UserActionButton({
    icon,
    label,
    title,
    disabled,
    onClick,
  }: {
    icon: React.ReactNode;
    label: string;
    title?: string;
    disabled?: boolean;
    onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  }) {
    return (
      <button
        type="button"
        title={title || label}
        aria-label={title || label}
        disabled={disabled}
        onClick={onClick}
        className="flex h-[54px] min-w-0 flex-col items-center justify-center gap-1 rounded-xl border border-[hsl(var(--border))]/70 bg-[hsl(var(--surface-card-1))]/80 px-1.5 text-[hsl(var(--fg))]/76 shadow-[0_8px_18px_-18px_hsl(var(--fg)/0.55)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[hsl(var(--accent)/0.36)] hover:bg-[hsl(var(--accent)/0.10)] hover:text-[hsl(var(--accent))] disabled:pointer-events-none disabled:opacity-45 sm:h-12"
      >
        <span className="flex h-5 items-center justify-center [&>svg]:h-[19px] [&>svg]:w-[19px]">{icon}</span>
        <span className="max-w-full truncate text-[10px] font-semibold leading-none sm:text-[11px]">{label}</span>
      </button>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden rounded-2xl border-[hsl(var(--border))]/75 shadow-[0_18px_40px_-30px_hsl(var(--fg)/0.45)]">
        <CardHeader className="p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-2xl font-bold tracking-tight">{t("users.title")}</div>
              <div className="text-sm text-[hsl(var(--fg))]/70">{t("users.subtitle")} • بروزرسانی خودکار هر ۳۰ ثانیه</div>
            </div>
            <a
              href={locked ? undefined : "/app/users/new"}
              aria-disabled={locked}
              onClick={(e) => {
                if (locked) e.preventDefault();
              }}
              className={
                "inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[hsl(var(--accent))] px-4 text-sm font-semibold text-[hsl(var(--accent-fg))] shadow-soft transition-all duration-200 hover:translate-y-[-1px] hover:brightness-95 " +
                (locked ? "pointer-events-none opacity-55" : "")
              }
            >
              <span className="text-xl leading-none">+</span>
              <span className="hidden sm:inline">{t("users.create")}</span>
            </a>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:px-0 xl:grid-cols-5">
            <div className="min-w-[136px] rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(135deg,rgba(59,130,246,0.10),rgba(14,165,233,0.06))] p-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-[hsl(var(--fg))]/70">{t("users.statsTotal")}</div>
                <Users size={18} className="opacity-70" />
              </div>
              <div className="mt-1 text-xl font-bold">{fmtNumber(stats.total)}</div>
            </div>
            <div className="min-w-[136px] rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(135deg,rgba(16,185,129,0.14),rgba(5,150,105,0.06))] p-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-[hsl(var(--fg))]/70">{t("users.statsActive")}</div>
                <CheckCircle2 size={18} className="text-emerald-600" />
              </div>
              <div className="mt-1 text-xl font-bold">{fmtNumber(stats.active)}</div>
            </div>
            <div className="min-w-[136px] rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(135deg,rgba(244,63,94,0.12),rgba(251,113,133,0.06))] p-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-[hsl(var(--fg))]/70">غیرفعال</div>
                <Ban size={18} className="text-rose-600" />
              </div>
              <div className="mt-1 text-xl font-bold">{fmtNumber(stats.disabled)}</div>
            </div>
            <div className="min-w-[136px] rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(135deg,rgba(245,158,11,0.13),rgba(249,115,22,0.05))] p-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-[hsl(var(--fg))]/70">حجم مصرف کل کاربران</div>
                <Gauge size={18} className="text-amber-600" />
              </div>
              <div className="mt-1 text-xl font-bold">{fmtTrafficBytes(stats.usedGb * 1024 * 1024 * 1024)}</div>
            </div>
            <div className="min-w-[136px] rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(135deg,rgba(129,140,248,0.14),rgba(56,189,248,0.06))] p-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-[hsl(var(--fg))]/70">مجموع حجم فروخته‌شده</div>
                <Layers size={18} className="text-indigo-600" />
              </div>
              <div className="mt-1 text-xl font-bold">{fmtGig(stats.soldGb)} گیگ</div>
            </div>
          </div>

          <div className="grid gap-2 lg:grid-cols-[minmax(260px,1fr)_auto]">
            <Input
              placeholder={t("users.search")}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-11 rounded-xl"
            />
            <div className="inline-flex h-11 items-center rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] px-3 text-sm text-[hsl(var(--fg))]/75">
              {t("users.balance")}: <span className="font-semibold">{fmtNumber(me?.balance ?? null)}</span>
            </div>
          </div>

          <div className="rounded-2xl border border-[hsl(var(--border))]/70 bg-[hsl(var(--surface-card-3))]/45 p-2.5">
            <div className="-mx-1 overflow-x-auto px-1 pb-2">
              <div className="flex min-w-max gap-2">
              <FilterButton value="all" label={t("users.filterAll")} />
              <FilterButton value="active" label={t("users.filterActive")} />
              <FilterButton value="on_hold" label="در انتظار اتصال" />
              <FilterButton value="limited" label="اتمام حجم" />
              <FilterButton value="disabled" label={t("users.filterDisabled")} />
              <FilterButton value="expired" label={t("users.filterExpired")} />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex items-center overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))]">
                <button
                  type="button"
                  onClick={() => setViewMode("single")}
                  className={
                    "inline-flex h-10 items-center gap-1.5 px-3 text-xs font-semibold transition-all duration-200 " +
                    (viewMode === "single"
                      ? "bg-[hsl(var(--accent))] text-[hsl(var(--accent-fg))]"
                      : "text-[hsl(var(--fg))]/75 hover:bg-[hsl(var(--surface-card-3))]")
                  }
                  title="نمایش تک‌ستونه"
                >
                  <List size={15} />
                  تک‌ستونه
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("grid2")}
                  className={
                    "inline-flex h-10 items-center gap-1.5 border-r border-[hsl(var(--border))] px-3 text-xs font-semibold transition-all duration-200 " +
                    (viewMode === "grid2"
                      ? "bg-[hsl(var(--accent))] text-[hsl(var(--accent-fg))]"
                      : "text-[hsl(var(--fg))]/75 hover:bg-[hsl(var(--surface-card-3))]")
                  }
                  title="نمایش دو ستونه"
                >
                  <LayoutGrid size={15} />
                  دو ستونه
                </button>
              </div>
              <Menu
                trigger={
                  <Button variant="outline" className="h-10 gap-2 rounded-lg">
                    <ArrowDownUp size={16} />
                    {t("users.sort")}
                  </Button>
                }
                items={[
                  { label: t("users.sortPriority"), onClick: () => setSortMode("priority") },
                  { label: t("users.sortExpirySoon"), onClick: () => setSortMode("expiry") },
                  { label: t("users.sortUsageHigh"), onClick: () => setSortMode("usage") },
                  { label: t("users.sortNewest"), onClick: () => setSortMode("newest") },
                ]}
              />
            </div>
          </div>

          {locked ? (
            <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-3))] p-3 text-xs">
              {t("users.balanceZero")}
            </div>
          ) : null}
          {err ? <div className="text-sm text-red-500">{err}</div> : null}
        </CardContent>
      </Card>

      {!data ? (
        <div className={"grid gap-3 sm:gap-4 " + (viewMode === "single" ? "grid-cols-1" : "grid-cols-1 xl:grid-cols-2")}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="rounded-xl">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                  <Skeleton className="h-7 w-24" />
                </div>
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-8 w-40" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className={"grid gap-3 sm:gap-4 " + (viewMode === "single" ? "grid-cols-1" : "grid-cols-1 xl:grid-cols-2")}>
          {items.map((u) => {
            const totalBytes = (u.total_gb || 0) * 1024 * 1024 * 1024;
            const usedBytes = Number(u.used_bytes || 0);
            const usedGb = bytesToGb(usedBytes);
            const pct = totalBytes > 0 ? clamp01((u.used_bytes || 0) / totalBytes) : 0;
            const percent = Math.round(pct * 100);
            const visiblePercent = usedBytes > 0 ? Math.max(1, percent) : 0;
            const remainingGb = Math.max((u.total_gb || 0) - usedGb, 0);

            const pr = computePriority(u);
            const expText = pr.days === null ? "—" : pr.days >= 0 ? t("users.expiresIn").replace("{days}", String(pr.days)) : t("users.expired");

            const sb = userStatusInfo(u);
            const StatusIcon = sb.Icon;
            const isActive = (u.status || "").toLowerCase() === "active";
            const busy = busyId === u.id;
            const isSingle = viewMode === "single";
            const actionSize = "h-12 w-12";
            const iconButtonClass = `${actionSize} rounded-xl border border-[hsl(var(--border))]/70 bg-[hsl(var(--surface-card-1))]/80 p-0 text-[hsl(var(--fg))]/74 shadow-none transition-all duration-200 hover:bg-[hsl(var(--accent)/0.10)] hover:text-[hsl(var(--accent))]`;
            const iconSize = 20;

            return (
              <Card
                key={u.id}
                role="button"
                tabIndex={0}
                onClick={() => openQuickEdit(u)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openQuickEdit(u);
                  }
                }}
                className="group relative cursor-pointer overflow-hidden rounded-2xl border-[hsl(var(--border))]/80 bg-[linear-gradient(150deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-2))_54%,hsl(var(--surface-card-3))_100%)] shadow-[0_18px_38px_-30px_hsl(var(--fg)/0.45)] transition-all duration-300 hover:-translate-y-0.5 hover:border-[hsl(var(--accent)/0.38)] hover:shadow-2xl hover:shadow-[hsl(var(--accent)/0.10)]"
              >
                <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${sb.cardGlow} opacity-70 transition-opacity duration-300 group-hover:opacity-100`} />
                <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-[hsl(var(--accent)/0.55)]" />
                <CardContent className={"relative " + (isSingle ? "space-y-3 p-3.5 sm:p-4" : "space-y-3 p-4")}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-[hsl(var(--border))]/70 bg-[hsl(var(--surface-card-1))] text-[hsl(var(--accent))] shadow-[0_10px_22px_-20px_hsl(var(--fg)/0.55)]">
                        <StatusIcon size={22} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xl font-black tracking-normal text-[hsl(var(--fg))] sm:text-2xl">{u.label}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[hsl(var(--fg))]/62">
                          <span className="inline-flex items-center gap-1">
                            <Clock3 size={14} className="opacity-70" />
                            {expText}
                          </span>
                          <span className="rounded-full bg-[hsl(var(--surface-card-3))] px-2 py-0.5">#{u.id}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2" onClick={(e) => e.stopPropagation()}>
                      <Switch checked={isActive} disabled={locked || busy} onCheckedChange={(v) => setStatus(u, v)} />
                      <Badge variant={sb.v} className={`gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${sb.badgeClass || ""}`}>
                        <StatusIcon size={13} />
                        {sb.label}
                      </Badge>
                    </div>
                  </div>

                  <div className={`flex min-w-0 items-center gap-2 rounded-xl border px-3 py-2 text-xs leading-5 ${sb.noteClass}`}>
                    <StatusIcon size={15} className="shrink-0" />
                    <span className="truncate">{sb.note}</span>
                  </div>

                  <div className="rounded-2xl border border-[hsl(var(--border))]/65 bg-[hsl(var(--surface-card-1))]/78 p-3 shadow-[inset_0_1px_0_hsl(var(--fg)/0.04)]">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-[hsl(var(--fg))]/80">
                      <div className="font-semibold">{usagePercentLabel(percent, usedBytes)} مصرف</div>
                      <div className="font-semibold">
                        {fmtTrafficBytes(usedBytes)} / {fmtGig(u.total_gb)} گیگ
                      </div>
                    </div>
                    <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-[hsl(var(--surface-card-3))]">
                      <div
                        className={"h-full rounded-full bg-gradient-to-r transition-[width] duration-500 ease-out " + progressTone(percent)}
                        style={{ width: `${visiblePercent}%` }}
                      />
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-[hsl(var(--fg))]/70">
                      <div>مجموع مصرف: <span className="font-semibold text-[hsl(var(--fg))]/90">{fmtTrafficBytes(usedBytes)}</span></div>
                      <div>باقی‌مانده: <span className="font-semibold text-[hsl(var(--fg))]/90">{fmtGig(remainingGb)} گیگ</span></div>
                    </div>
                  </div>

                  <div className="grid grid-cols-5 gap-2">
                    <UserActionButton
                      icon={<SquarePen size={20} />}
                      label="ویرایش"
                      title="ویرایش سریع"
                      disabled={busy}
                      onClick={(e) => {
                        e.stopPropagation();
                        openQuickEdit(u);
                      }}
                    />
                    <UserActionButton
                      icon={<Copy size={20} />}
                      label="کپی"
                      title="کپی سریع لینک اشتراک"
                      disabled={busy}
                      onClick={(e) => {
                        e.stopPropagation();
                        copyPrimaryLinkForUser(u, e);
                      }}
                    />
                    <div onClick={(e) => e.stopPropagation()} onMouseEnter={() => ensureQuickLinks(u, false)}>
                      <Menu
                        className="min-w-[260px]"
                        trigger={
                          <UserActionButton
                            icon={<Link2 size={20} />}
                            label="نودها"
                            title="انتخاب لینک نود"
                            disabled={busy}
                            onClick={() => ensureQuickLinks(u, false)}
                          />
                        }
                        items={quickLinkMenuItems(u)}
                      />
                    </div>
                    <UserActionButton
                      icon={<QrCode size={20} />}
                      label="QR"
                      title="نمایش QR لینک‌ها"
                      disabled={busy}
                      onClick={(e) => {
                        e.stopPropagation();
                        openQr(u);
                      }}
                    />
                    <div onClick={(e) => e.stopPropagation()}>
                      <Menu
                        trigger={
                          <UserActionButton
                            icon={<span className="text-xl font-black leading-none">...</span>}
                            label="بیشتر"
                            title={t("users.actions")}
                            disabled={busy}
                          />
                        }
                        items={[
                          {
                            label: t("users.links"),
                            icon: <Layers size={16} />,
                            onClick: () => openLinks(u),
                          },
                          {
                            label: t("users.details"),
                            icon: <Pencil size={16} />,
                            onClick: () => router.push(`/app/users/${u.id}`),
                          },
                          {
                            label: isActive ? t("common.disable") : t("common.enable"),
                            icon: <Power size={16} />,
                            disabled: locked || busy || renewalOnly,
                            onClick: () => setStatus(u, !isActive),
                          },
                          {
                            label: t("users.resetUsage"),
                            icon: <Gauge size={16} />,
                            disabled: locked || busy || renewalOnly,
                            onClick: () => ask("reset", u),
                          },
                          {
                            label: t("users.revoke"),
                            icon: <Unlink2 size={16} />,
                            disabled: busy,
                            danger: true,
                            onClick: () => ask("revoke", u),
                          },
                          {
                            label: t("users.delete"),
                            icon: <Trash2 size={16} />,
                            disabled: busy,
                            danger: true,
                            onClick: () => ask("delete", u),
                          },
                        ]}
                      />
                    </div>
                  </div>

                  <div className="hidden">
                    <Button
                      variant="ghost"
                      className={iconButtonClass}
                      size="sm"
                      title={t("users.links")}
                      aria-label={t("users.links")}
                      disabled={busy}
                      onClick={(e) => {
                        e.stopPropagation();
                        openLinks(u);
                      }}
                    >
                      <Layers size={iconSize} />
                    </Button>
                    <Button
                      variant="ghost"
                      className={iconButtonClass}
                      size="sm"
                      title={t("users.details")}
                      aria-label={t("users.details")}
                      disabled={busy}
                      onClick={(e) => {
                        e.stopPropagation();
                        router.push(`/app/users/${u.id}`);
                      }}
                    >
                      <SquarePen size={iconSize} />
                    </Button>
                    <Button
                      variant="ghost"
                      className={iconButtonClass}
                      size="sm"
                      title="کپی سریع لینک اشتراک"
                      aria-label="کپی سریع لینک اشتراک"
                      disabled={busy}
                      onClick={(e) => {
                        e.stopPropagation();
                        copyPrimaryLinkForUser(u, e);
                      }}
                    >
                      <Copy size={iconSize} />
                    </Button>
                    <div onClick={(e) => e.stopPropagation()} onMouseEnter={() => ensureQuickLinks(u, false)}>
                      <Menu
                        className="min-w-[260px]"
                        trigger={
                          <Button
                            variant="ghost"
                            className={iconButtonClass}
                            size="sm"
                            title="کپی لینک اشتراک"
                            aria-label="کپی لینک اشتراک"
                            disabled={busy}
                            onClick={() => ensureQuickLinks(u, false)}
                          >
                            <Link2 size={iconSize} />
                          </Button>
                        }
                        items={quickLinkMenuItems(u)}
                      />
                    </div>
                    <Button
                      variant="outline"
                      className={`hidden ${actionSize} rounded-lg border-[hsl(var(--border))]/90 p-0 transition-all duration-200 hover:-translate-y-0.5 hover:border-emerald-400/60 hover:bg-emerald-500/10`}
                      size="sm"
                      title="کپی لینک اصلی اشتراک"
                      aria-label="کپی لینک اصلی اشتراک"
                      disabled={busy}
                      onClick={(e) => {
                        e.stopPropagation();
                        copyMaster(u, e);
                      }}
                    >
                      <Copy size={18} />
                    </Button>
                    <Button
                      variant="outline"
                      className={`hidden ${actionSize} rounded-lg border-[hsl(var(--border))]/90 p-0 transition-all duration-200 hover:-translate-y-0.5 hover:border-cyan-400/60 hover:bg-cyan-500/10`}
                      size="sm"
                      title="کپی همه لینک‌ها"
                      aria-label="کپی همه لینک‌ها"
                      disabled={busy}
                      onClick={(e) => {
                        e.stopPropagation();
                        copyAllLinksForUser(u, e);
                      }}
                    >
                      <Link2 size={18} />
                    </Button>
                    <Button
                      variant="ghost"
                      className={iconButtonClass}
                      size="sm"
                      title="QR لینک‌ها"
                      aria-label="QR لینک‌ها"
                      disabled={busy}
                      onClick={(e) => {
                        e.stopPropagation();
                        openQr(u);
                      }}
                    >
                      <QrCode size={iconSize} />
                    </Button>
                    {isSingle ? (
                      <>
                        <Button
                          variant="ghost"
                          className={iconButtonClass}
                          size="sm"
                          title={t("users.resetUsage")}
                          aria-label={t("users.resetUsage")}
                          disabled={busy || locked || renewalOnly}
                          onClick={(e) => {
                            e.stopPropagation();
                            ask("reset", u);
                          }}
                        >
                          <Gauge size={iconSize} />
                        </Button>
                        <Button
                          variant="ghost"
                          className={iconButtonClass}
                          size="sm"
                          title={t("users.revoke")}
                          aria-label={t("users.revoke")}
                          disabled={busy}
                          onClick={(e) => {
                            e.stopPropagation();
                            ask("revoke", u);
                          }}
                        >
                          <Unlink2 size={iconSize} />
                        </Button>
                      </>
                    ) : null}

                    <div onClick={(e) => e.stopPropagation()}>
                      <Menu
                        trigger={
                          <Button
                            variant="ghost"
                            className={iconButtonClass}
                            size="sm"
                            title={t("users.actions")}
                            disabled={busy}
                            aria-label={t("users.actions")}
                          >
                            ⋯
                          </Button>
                        }
                        items={[
                          {
                            label: t("users.details"),
                            icon: <Pencil size={16} />,
                            onClick: () => router.push(`/app/users/${u.id}`),
                          },
                          {
                            label: "ویرایش سریع",
                            icon: <SquarePen size={16} />,
                            onClick: () => openQuickEdit(u),
                          },
                          {
                            label: "کپی لینک اصلی اشتراک",
                            icon: <Copy size={16} />,
                            disabled: !showMasterSub,
                            onClick: () => copyMaster(u),
                          },
                          {
                            label: "کپی همه لینک‌ها",
                            icon: <Copy size={16} />,
                            onClick: () => copyAllLinksForUser(u),
                          },
                          {
                            label: "نمایش QR لینک‌ها",
                            icon: <QrCode size={16} />,
                            onClick: () => openQr(u),
                          },
                          {
                            label: isActive ? t("common.disable") : t("common.enable"),
                            icon: <Power size={16} />,
                            disabled: locked || busy || renewalOnly,
                            onClick: () => setStatus(u, !isActive),
                          },
                          {
                            label: t("users.resetUsage"),
                            icon: <Gauge size={16} />,
                            disabled: locked || busy,
                            onClick: () => ask("reset", u),
                          },
                          {
                            label: t("users.revoke"),
                            icon: <Unlink2 size={16} />,
                            disabled: busy,
                            danger: true,
                            onClick: () => ask("revoke", u),
                          },
                          {
                            label: t("users.delete"),
                            icon: <Trash2 size={16} />,
                            disabled: busy,
                            danger: true,
                            onClick: () => ask("delete", u),
                          },
                        ]}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {data ? (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={data.total || 0}
          onPageChange={setPage}
          onPageSizeChange={(s) => {
            setPageSize(s);
            setPage(1);
          }}
        />
      ) : null}

      {copyHint ? (
        <div
          className="pointer-events-none fixed z-[70] rounded-md border border-emerald-400/35 bg-emerald-500/90 px-2.5 py-1 text-xs font-semibold text-white shadow-lg backdrop-blur-sm"
          style={{ left: copyHint.x + 12, top: copyHint.y - 10 }}
        >
          {copyHint.text}
        </div>
      ) : null}

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={confirmKind === "reset" ? t("users.confirmResetTitle") : confirmKind === "delete" ? t("users.confirmDeleteTitle") : t("users.confirmRevokeTitle")}
      >
        <div className="space-y-4">
          <div className="text-sm text-[hsl(var(--fg))]/80">
            {confirmKind === "reset" ? t("users.confirmResetBody") : confirmKind === "delete" ? t("users.confirmDeleteBody") : t("users.confirmRevokeBody")}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={doConfirm}>{t("common.confirm")}</Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title={editUser ? `ویرایش سریع: ${editUser.label}` : "ویرایش سریع"}
      >
        {editUser ? (
          <div className="space-y-4 text-sm">
            {renewalOnly ? (
              <div className="max-w-full overflow-hidden rounded-xl border border-violet-500/25 bg-violet-500/10 p-3 text-xs leading-6 text-[hsl(var(--fg))]/75 break-words [overflow-wrap:anywhere]">
                برای این رسیلر ویرایش آزاد بسته شده است؛ فقط تمدید بسته‌ای طبق پکیج‌های مجاز سوپرادمین انجام می‌شود.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                <Button type="button" size="sm" variant={quickMode === "renewal" ? "primary" : "outline"} onClick={() => setQuickMode("renewal")}>
                  تمدید بسته‌ای
                </Button>
                <Button type="button" size="sm" variant={quickMode === "extend" ? "primary" : "outline"} onClick={() => setQuickMode("extend")}>
                  افزایش زمان
                </Button>
                <Button type="button" size="sm" variant={quickMode === "add" ? "primary" : "outline"} onClick={() => setQuickMode("add")}>
                  افزایش حجم
                </Button>
                <Button type="button" size="sm" variant={quickMode === "dec" ? "primary" : "outline"} onClick={() => setQuickMode("dec")}>
                  کاهش حجم
                </Button>
                <Button type="button" size="sm" variant={quickMode === "time_dec" ? "primary" : "outline"} onClick={() => setQuickMode("time_dec")}>
                  کاهش زمان
                </Button>
              </div>
            )}

            {quickMode === "renewal" ? (
              <div className="rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(155deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3)/0.28)_100%)] p-3 space-y-3 transition-all duration-200 hover:border-[hsl(var(--accent)/0.35)] hover:shadow-soft">
                <div>
                  <div className="font-medium">تمدید بسته‌ای</div>
                  <div className="mt-1 text-xs leading-6 text-[hsl(var(--fg))]/70">
                    سیاست تمدید توسط سوپرادمین تعیین می‌شود و رسیلر فقط مقدار روز و حجم پکیج را انتخاب می‌کند.
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="text-xs font-medium text-[hsl(var(--fg))]/75">مدت تمدید</div>
                  <div className="flex flex-wrap gap-2">
                    {renewalDurationPresets.map((p) => (
                      <Button key={p.key} type="button" size="sm" variant={editRenewDays === p.days ? "primary" : "outline"} onClick={() => setEditRenewDays(p.days)}>
                        {p.label}
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="text-xs font-medium text-[hsl(var(--fg))]/75">حجم تمدید</div>
                  <div className="flex flex-wrap gap-2">
                    {renewalTrafficPresets.map((g) => (
                      <Button key={g} type="button" size="sm" variant={editRenewGb === g ? "primary" : "outline"} onClick={() => setEditRenewGb(g)}>
                        {g} گیگ
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-[1fr,1fr,auto]">
                  <Input className="min-w-0" type="number" min={1} value={editRenewDays} disabled={renewalOnly} onChange={(e) => setEditRenewDays(Math.max(1, Number(e.target.value) || 1))} />
                  <Input className="min-w-0" type="number" min={1} value={editRenewGb} disabled={renewalOnly} onChange={(e) => setEditRenewGb(Math.max(1, Number(e.target.value) || 1))} />
                  <Button
                    disabled={busyId === editUser.id || locked}
                    onClick={async () => {
                      const ok = await op(editUser.id, `/api/v1/reseller/users/${editUser.id}/renew`, {
                        days: editRenewDays,
                        total_gb: editRenewGb,
                        pricing_mode: "bundle",
                      });
                      if (ok) setEditOpen(false);
                    }}
                  >
                    اجرا
                  </Button>
                </div>
              </div>
            ) : null}

            {!renewalOnly && quickMode === "extend" ? (
              <div className="rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(155deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3)/0.28)_100%)] p-3 space-y-3 transition-all duration-200 hover:border-[hsl(var(--accent)/0.35)] hover:shadow-soft">
                <div className="font-medium">افزایش زمان (روز)</div>
                <div className="flex flex-wrap gap-2">
                  {[7, 31, 90, 180].map((d) => (
                    <Button key={d} type="button" size="sm" variant={editDays === d ? "primary" : "outline"} onClick={() => setEditDays(d)}>
                      {d}
                    </Button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Input className="min-w-[130px] flex-1" type="number" value={editDays} onChange={(e) => setEditDays(Math.max(1, Number(e.target.value) || 1))} />
                  <JalaliDateTimePicker
                    mode="icon"
                    value={editTargetDate}
                    onChange={(d) => {
                      setEditTargetDate(d);
                      if (!editUser) return;
                      const delta = computeDaysDeltaFromTarget(editUser.expire_at, d);
                      if (delta.ok && delta.direction === "up" && delta.diffDays > 0) {
                        setEditDays(Math.max(1, Math.min(3650, delta.diffDays)));
                      }
                    }}
                  />
                  <Button
                    disabled={busyId === editUser.id || locked}
                    onClick={async () => {
                      const ok = await op(editUser.id, `/api/v1/reseller/users/${editUser.id}/extend`, { days: editDays });
                      if (ok) setEditOpen(false);
                    }}
                  >
                    اجرا
                  </Button>
                </div>
                <div className="text-xs text-[hsl(var(--fg))]/75">
                  تاریخ پایان فعلی: <span className="font-semibold">{formatJalaliDateTime(new Date(editUser.expire_at))}</span>
                  {editTargetDate ? (
                    <span className="mr-2">
                      | تاریخ انتخابی: <span className="font-semibold">{formatJalaliDateTime(editTargetDate)}</span>
                    </span>
                  ) : null}
                </div>
              </div>
            ) : null}

            {!renewalOnly && quickMode === "add" ? (
              <div className="rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(155deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3)/0.24)_100%)] p-3 space-y-2 transition-all duration-200 hover:border-[hsl(var(--accent)/0.35)] hover:shadow-soft">
                <div className="font-medium">افزایش حجم (گیگ)</div>
                <div className="flex flex-wrap gap-2">
                  {[5, 10, 20, 50].map((g) => (
                    <Button key={g} type="button" size="sm" variant={editAddGb === g ? "primary" : "outline"} onClick={() => setEditAddGb(g)}>
                      +{g}
                    </Button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Input className="min-w-[130px] flex-1" type="number" value={editAddGb} onChange={(e) => setEditAddGb(Math.max(1, Number(e.target.value) || 1))} />
                  <Button
                    disabled={busyId === editUser.id || locked}
                    onClick={async () => {
                      const ok = await op(editUser.id, `/api/v1/reseller/users/${editUser.id}/add-traffic`, { add_gb: editAddGb });
                      if (ok) setEditOpen(false);
                    }}
                  >
                    اجرا
                  </Button>
                </div>
              </div>
            ) : null}

            {!renewalOnly && quickMode === "dec" ? (
              <div className="rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(155deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3)/0.24)_100%)] p-3 space-y-2 transition-all duration-200 hover:border-[hsl(var(--accent)/0.35)] hover:shadow-soft">
                <div className="font-medium">کاهش حجم (ریفاند)</div>
                <div className="flex flex-wrap gap-2">
                  {[1, 5, 10, 20].map((g) => (
                    <Button key={g} type="button" size="sm" variant={editDecGb === g ? "primary" : "outline"} onClick={() => setEditDecGb(g)}>
                      -{g}
                    </Button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Input className="min-w-[130px] flex-1" type="number" value={editDecGb} onChange={(e) => setEditDecGb(Math.max(1, Number(e.target.value) || 1))} />
                  <Button
                    variant="outline"
                    disabled={busyId === editUser.id || locked}
                    onClick={async () => {
                      const ok = await op(editUser.id, `/api/v1/reseller/users/${editUser.id}/refund`, {
                        action: "decrease",
                        decrease_gb: editDecGb,
                      });
                      if (ok) setEditOpen(false);
                    }}
                  >
                    اجرا
                  </Button>
                </div>
              </div>
            ) : null}

            {!renewalOnly && quickMode === "time_dec" ? (
              <div className="rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(155deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3)/0.28)_100%)] p-3 space-y-3 transition-all duration-200 hover:border-[hsl(var(--accent)/0.35)] hover:shadow-soft">
                <div className="font-medium">کاهش زمان (همراه ریفاند)</div>
                <div className="flex flex-wrap gap-2">
                  {[1, 3, 7, 15, 31].map((d) => (
                    <Button key={d} type="button" size="sm" variant={editDecDays === d ? "primary" : "outline"} onClick={() => setEditDecDays(d)}>
                      -{d} روز
                    </Button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Input className="min-w-[130px] flex-1" type="number" min={1} value={editDecDays} onChange={(e) => setEditDecDays(Math.max(1, Number(e.target.value) || 1))} />
                  <JalaliDateTimePicker
                    mode="icon"
                    value={editTargetDate}
                    onChange={(d) => {
                      setEditTargetDate(d);
                      if (!editUser) return;
                      const delta = computeDaysDeltaFromTarget(editUser.expire_at, d);
                      if (delta.ok && delta.direction === "down" && delta.diffDays > 0) {
                        setEditDecDays(Math.max(1, Math.min(3650, delta.diffDays)));
                      }
                    }}
                  />
                  <Button
                    variant="outline"
                    disabled={busyId === editUser.id || locked}
                    onClick={async () => {
                      const ok = await op(editUser.id, `/api/v1/reseller/users/${editUser.id}/decrease-time`, { days: editDecDays });
                      if (ok) setEditOpen(false);
                    }}
                  >
                    اجرا
                  </Button>
                </div>
                <div className="text-xs text-[hsl(var(--fg))]/75">
                  تاریخ پایان فعلی: <span className="font-semibold">{formatJalaliDateTime(new Date(editUser.expire_at))}</span>
                  {editTargetDate ? (
                    <span className="mr-2">
                      | تاریخ انتخابی: <span className="font-semibold">{formatJalaliDateTime(editTargetDate)}</span>
                    </span>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(150deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3)/0.3)_100%)] p-3 space-y-2 transition-all duration-200 hover:border-[hsl(var(--accent)/0.35)] hover:shadow-soft">
              <div className="font-medium">کنترل سریع</div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="gap-2"
                  disabled={busyId === editUser.id || locked || renewalOnly}
                  onClick={() => {
                    setEditOpen(false);
                    ask("reset", editUser);
                  }}
                >
                  <Gauge size={15} /> ریست مصرف
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="gap-2"
                  disabled={busyId === editUser.id}
                  onClick={() => {
                    setEditOpen(false);
                    ask("revoke", editUser);
                  }}
                >
                  <Unlink2 size={15} /> بازسازی لینک
                </Button>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditOpen(false)}>{t("common.cancel")}</Button>
              <Button variant="outline" className="gap-2" onClick={() => router.push(`/app/users/${editUser.id}`)}>
                <SquarePen size={16} /> رفتن به جزئیات
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={qrOpen}
        onClose={() => setQrOpen(false)}
        title={qrUser ? `QR لینک‌ها: ${qrUser.label}` : "QR لینک‌ها"}
        className="max-w-5xl"
      >
        {qrErr ? <div className="text-sm text-red-500">{qrErr}</div> : null}
        {!qrLinks && !qrErr ? <div className="text-sm text-[hsl(var(--fg))]/70">{t("common.loading")}</div> : null}

        {qrLinks ? (
          <div className="space-y-4">
            <div className="max-w-full overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-3))] p-3 text-xs text-[hsl(var(--fg))]/80 break-words [overflow-wrap:anywhere]">
              QR کد لینک مرکزی و لینک هر نود نمایش داده می‌شود. با Revoke، لینک مرکزی قبلی هم باطل می‌شود.
            </div>

            {qrItems.length ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {qrItems.map((item) => (
                  <article key={item.key} className="rounded-2xl border border-[hsl(var(--border))] p-3 space-y-3">
                    <div>
                      <div className="font-semibold break-all">{item.title}</div>
                      <div className="text-xs text-[hsl(var(--fg))]/70">{item.subtitle}</div>
                    </div>
                    <div className="mx-auto w-fit rounded-xl border border-[hsl(var(--border))] bg-white p-2">
                      <img src={qrImageUrl(item.url)} alt={`QR ${item.title}`} width={220} height={220} className="h-[220px] w-[220px] object-contain" />
                    </div>
                    <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-3))]/50 p-2 text-[11px] break-all">
                      {item.url}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        onClick={() => {
                          copyText(item.url).then((ok) => push({ title: ok ? t("common.copied") : t("common.failed"), type: ok ? "success" : "error" }));
                        }}
                      >
                        <Copy size={14} /> {t("common.copy")}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        onClick={() => {
                          window.open(item.url, "_blank", "noopener,noreferrer");
                        }}
                      >
                        <ExternalLink size={14} /> باز کردن
                      </Button>
                      {item.isWg ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-2"
                          onClick={() => {
                            window.open(item.url, "_blank", "noopener,noreferrer");
                          }}
                        >
                          <Download size={14} /> دانلود .conf
                        </Button>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="text-sm text-[hsl(var(--fg))]/70">لینکی برای ساخت QR یافت نشد.</div>
            )}
          </div>
        ) : null}
      </Modal>

      <Modal open={linksOpen} onClose={() => setLinksOpen(false)} title={t("users.linksTitle").replace("{label}", linksUser?.label || "")}>
        {linksErr ? <div className="text-sm text-red-500">{linksErr}</div> : null}
        {!links && !linksErr ? <div className="text-sm text-[hsl(var(--fg))]/70">{t("common.loading")}</div> : null}

        {links ? (
          <div className="space-y-4 text-sm">
            <div className="max-w-full overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-3))] p-3 text-xs text-[hsl(var(--fg))]/80 break-words [overflow-wrap:anywhere]">
              پیشنهاد: لینک مستقیم پنل را به کاربر بدهید. لینک اصلی اشتراک برای حالت چندنودی مناسب‌تر است.
            </div>
            {links.master_link ? (
            <div className="space-y-2">
              <div className="font-semibold">{t("users.masterSub")}</div>
              <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-3))] p-3 break-all">{links.master_link}</div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    copyText(links.master_link || "").then((ok) => push({ title: ok ? t("common.copied") : t("common.failed"), type: ok ? "success" : "error" }));
                  }}
                >
                  {t("common.copy")}
                </Button>
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={() => {
                    const directList = extractDirectLinks(links);
                    if (!directList.length) {
                      push({ title: "لینک مستقیم موجود نیست", type: "warning" });
                      return;
                    }
                    const direct = directList.join("\n");
                    copyText(direct).then((ok) => push({ title: ok ? t("common.copied") : t("common.failed"), type: ok ? "success" : "error" }));
                  }}
                >
                  <Link2 size={15} /> کپی لینک‌های مستقیم
                </Button>
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={() => {
                    const direct = extractDirectLinks(links);
                    const all = [...direct, links.master_link].filter(Boolean).join("\n");
                    copyText(all).then((ok) => push({ title: ok ? t("common.copied") : t("common.failed"), type: ok ? "success" : "error" }));
                  }}
                >
                  <Copy size={15} /> کپی همه لینک‌ها
                </Button>
              </div>
            </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => {
                  const directList = extractDirectLinks(links);
                  if (!directList.length) {
                    push({ title: "لینک مستقیم موجود نیست", type: "warning" });
                    return;
                  }
                  copyText(directList.join("\n")).then((ok) => push({ title: ok ? t("common.copied") : t("common.failed"), type: ok ? "success" : "error" }));
                }}
              >
                <Link2 size={15} /> کپی لینک‌های مستقیم
              </Button>
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => {
                  const direct = extractDirectLinks(links);
                  const all = [...direct, links.master_link].filter(Boolean).join("\n");
                  if (!all) {
                    push({ title: "لینکی برای کپی وجود ندارد", type: "warning" });
                    return;
                  }
                  copyText(all).then((ok) => push({ title: ok ? t("common.copied") : t("common.failed"), type: ok ? "success" : "error" }));
                }}
              >
                <Copy size={15} /> کپی همه لینک‌ها
              </Button>
            </div>

            <div className="space-y-2">
              <div className="font-semibold">{t("users.panelSubs")}</div>
              <div className="space-y-2">
                {links.node_links.map((nl) => {
                  const node = nodeMap.get(nl.node_id);
                  const nodeName = node?.name || nl.node_name;
                  const isWg = (nl.panel_type || "").toLowerCase() === "wg_dashboard";
                  const full = nl.config_download_url
                    ? nl.config_download_url
                    : nl.full_url
                    ? nl.full_url
                    : nl.direct_url
                    ? normalizeUrl(nl.direct_url, node?.base_url)
                    : "";
                  return (
                  <div key={nl.node_id} className="rounded-xl border border-[hsl(var(--border))] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs text-[hsl(var(--fg))]/70">{nodeName ? `${nodeName} (#${nl.node_id})` : `Node #${nl.node_id}`}</div>
                      <Badge variant={nl.status === "ok" ? "success" : nl.status === "missing" ? "warning" : "danger"}>{nl.status}</Badge>
                    </div>
                    {full ? (
                      <>
                        <div className="mt-2 break-all text-xs">{full}</div>
                        <div className="mt-2">
                          <div className="flex flex-wrap gap-2">
                            <Button
                              variant="outline"
                              onClick={() => {
                                if (!full) return;
                                copyText(full).then((ok) => push({ title: ok ? t("common.copied") : t("common.failed"), type: ok ? "success" : "error" }));
                              }}
                            >
                              {t("common.copy")}
                            </Button>
                            {isWg ? (
                              <Button
                                variant="outline"
                                className="gap-2"
                                onClick={() => {
                                  window.open(full, "_blank", "noopener,noreferrer");
                                }}
                              >
                                <Download size={15} /> دانلود .conf
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="mt-2 text-xs text-[hsl(var(--fg))]/70">{nl.detail || t("users.noLink")}</div>
                    )}
                  </div>
                );
                })}
              </div>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
