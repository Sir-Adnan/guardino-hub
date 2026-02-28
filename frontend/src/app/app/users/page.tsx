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
import { Menu } from "@/components/ui/menu";
import { JalaliDateTimePicker } from "@/components/ui/jalali-datetime-picker";
import { useToast } from "@/components/ui/toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Pagination } from "@/components/ui/pagination";
import {
  ArrowDownUp,
  Copy,
  Pencil,
  Power,
  Trash2,
  Users,
  Link2,
  SquarePen,
  Layers,
  Download,
  QrCode,
  ExternalLink,
  Ban,
  CheckCircle2,
  LayoutGrid,
  List,
  Sparkles,
  Gauge,
} from "lucide-react";

type UserOut = { id: number; label: string; total_gb: number; used_bytes: number; expire_at: string; status: string };
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
type NodeLinkOut = LinksResp["node_links"][number];
type NodeLite = { id: number; name: string; base_url: string };

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

type StatusFilter = "all" | "active" | "disabled" | "expired";
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

function statusBadge(status: string) {
  const s = (status || "").toLowerCase();
  if (s === "active") return { v: "success" as const, label: "فعال", Icon: CheckCircle2 };
  if (s === "disabled") return { v: "muted" as const, label: "غیرفعال", Icon: Ban };
  if (s === "expired") return { v: "danger" as const, label: "منقضی", Icon: Ban };
  return { v: "default" as const, label: status || "—", Icon: Sparkles };
}

function computePriority(u: UserOut) {
  const s = (u.status || "").toLowerCase();
  const totalBytes = (u.total_gb || 0) * 1024 * 1024 * 1024;
  const pct = totalBytes > 0 ? clamp01((u.used_bytes || 0) / totalBytes) : 0;
  const percent = Math.round(pct * 100);
  const days = safeDaysLeft(u.expire_at);

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
  const [data, setData] = React.useState<UsersPage | null>(null);
  const [resellerStats, setResellerStats] = React.useState<ResellerStatsOut | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<StatusFilter>("all");
  const [sortMode, setSortMode] = React.useState<SortMode>("newest");
  const [viewMode, setViewMode] = React.useState<ViewMode>("grid2");

  const [nodes, setNodes] = React.useState<NodeLite[] | null>(null);
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
  const [quickMode, setQuickMode] = React.useState<"extend" | "add" | "dec" | "time_dec">("extend");
  const [editDays, setEditDays] = React.useState(30);
  const [editDecDays, setEditDecDays] = React.useState(7);
  const [editAddGb, setEditAddGb] = React.useState(10);
  const [editDecGb, setEditDecGb] = React.useState(5);
  const [editTargetDate, setEditTargetDate] = React.useState<Date | null>(null);
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(50);
  const [copyHint, setCopyHint] = React.useState<{ text: string; x: number; y: number; id: number } | null>(null);
  const copyHintTimerRef = React.useRef<number | null>(null);

  async function load() {
    setErr(null);
    try {
      const offset = (page - 1) * pageSize;
      const res = await apiFetch<UsersPage>(`/api/v1/reseller/users?offset=${offset}&limit=${pageSize}`);
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

  React.useEffect(() => {
    load();
  }, [page, pageSize]);

  React.useEffect(() => {
    const timer = window.setInterval(() => {
      load().catch(() => undefined);
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [page, pageSize]);

  React.useEffect(() => {
    loadNodes().catch(() => undefined);
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
    const qq = q.trim().toLowerCase();
    let out = items;
    if (qq) out = out.filter((u) => (u.label || "").toLowerCase().includes(qq));

    if (filter !== "all") {
      out = out.filter((u) => (u.status || "").toLowerCase() === filter);
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
      const lines = [...direct, res.master_link].filter(Boolean).join("\n");
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
    setQuickMode("extend");
    setEditDays(30);
    setEditDecDays(7);
    setEditAddGb(10);
    setEditDecGb(5);
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
          "rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all duration-200 " +
          (active
            ? "border-transparent bg-[hsl(var(--accent))] text-[hsl(var(--accent-fg))] shadow-soft"
            : "border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] hover:border-[hsl(var(--accent)/0.35)] hover:bg-[hsl(var(--surface-card-3))]")
        }
      >
        {label}
      </button>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden rounded-xl border-[hsl(var(--border))]/80">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-2xl font-bold tracking-tight">{t("users.title")}</div>
              <div className="text-sm text-[hsl(var(--fg))]/70">{t("users.subtitle")} • بروزرسانی خودکار هر ۳۰ ثانیه</div>
            </div>
            <a
              href="/app/users/new"
              className="rounded-lg bg-[hsl(var(--accent))] px-4 py-2 text-sm font-semibold text-[hsl(var(--accent-fg))] shadow-soft transition-all duration-200 hover:translate-y-[-1px] hover:brightness-95"
            >
              {t("users.create")}
            </a>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <div className="rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(135deg,rgba(59,130,246,0.10),rgba(14,165,233,0.06))] p-4">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-[hsl(var(--fg))]/70">{t("users.statsTotal")}</div>
                <Users size={18} className="opacity-70" />
              </div>
              <div className="mt-2 text-2xl font-bold">{fmtNumber(stats.total)}</div>
            </div>
            <div className="rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(135deg,rgba(16,185,129,0.14),rgba(5,150,105,0.06))] p-4">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-[hsl(var(--fg))]/70">{t("users.statsActive")}</div>
                <CheckCircle2 size={18} className="text-emerald-600" />
              </div>
              <div className="mt-2 text-2xl font-bold">{fmtNumber(stats.active)}</div>
            </div>
            <div className="rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(135deg,rgba(244,63,94,0.12),rgba(251,113,133,0.06))] p-4">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-[hsl(var(--fg))]/70">غیرفعال</div>
                <Ban size={18} className="text-rose-600" />
              </div>
              <div className="mt-2 text-2xl font-bold">{fmtNumber(stats.disabled)}</div>
            </div>
            <div className="rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(135deg,rgba(245,158,11,0.13),rgba(249,115,22,0.05))] p-4">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-[hsl(var(--fg))]/70">حجم مصرف کل کاربران</div>
                <Gauge size={18} className="text-amber-600" />
              </div>
              <div className="mt-2 text-2xl font-bold">{fmtGig(stats.usedGb)} گیگ</div>
            </div>
            <div className="rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(135deg,rgba(129,140,248,0.14),rgba(56,189,248,0.06))] p-4">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-[hsl(var(--fg))]/70">مجموع حجم فروخته‌شده</div>
                <Layers size={18} className="text-indigo-600" />
              </div>
              <div className="mt-2 text-2xl font-bold">{fmtGig(stats.soldGb)} گیگ</div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Input
              placeholder={t("users.search")}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-11 max-w-lg rounded-lg"
            />
            <div className="text-sm text-[hsl(var(--fg))]/75">
              {t("users.balance")}: <span className="font-semibold">{fmtNumber(me?.balance ?? null)}</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              <FilterButton value="all" label={t("users.filterAll")} />
              <FilterButton value="active" label={t("users.filterActive")} />
              <FilterButton value="disabled" label={t("users.filterDisabled")} />
              <FilterButton value="expired" label={t("users.filterExpired")} />
            </div>

            <div className="flex items-center gap-2">
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
        <div className={"grid gap-4 " + (viewMode === "single" ? "grid-cols-1" : "grid-cols-1 xl:grid-cols-2")}>
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
        <div className={"grid gap-4 " + (viewMode === "single" ? "grid-cols-1" : "grid-cols-1 xl:grid-cols-2")}>
          {items.map((u) => {
            const totalBytes = (u.total_gb || 0) * 1024 * 1024 * 1024;
            const usedGb = bytesToGb(u.used_bytes || 0);
            const pct = totalBytes > 0 ? clamp01((u.used_bytes || 0) / totalBytes) : 0;
            const percent = Math.round(pct * 100);
            const remainingGb = Math.max((u.total_gb || 0) - usedGb, 0);

            const pr = computePriority(u);
            const expText = pr.days === null ? "—" : pr.days >= 0 ? t("users.expiresIn").replace("{days}", String(pr.days)) : t("users.expired");

            const sb = statusBadge(u.status);
            const StatusIcon = sb.Icon;
            const isActive = (u.status || "").toLowerCase() === "active";
            const busy = busyId === u.id;
            const isSingle = viewMode === "single";
            const actionSize = isSingle ? "h-11 w-11" : "h-10 w-10";

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
                className="group relative cursor-pointer overflow-hidden rounded-xl border-[hsl(var(--border))]/85 transition-all duration-300 hover:-translate-y-0.5 hover:border-[hsl(var(--accent)/0.35)] hover:shadow-2xl hover:shadow-sky-500/10"
              >
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_120%_at_100%_0%,rgba(14,165,233,0.16),transparent_55%),radial-gradient(50%_90%_at_0%_100%,rgba(16,185,129,0.14),transparent_60%)] opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                <CardContent className={"relative " + (isSingle ? "space-y-3 p-4" : "space-y-4 p-5")}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className={(isSingle ? "text-base" : "text-lg") + " font-bold break-all leading-relaxed"}>{u.label}</div>
                      </div>
                      <div className={(isSingle ? "mt-1 text-xs" : "mt-1.5 text-sm") + " text-[hsl(var(--fg))]/75"}>{expText}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={sb.v} className="gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-bold">
                        <StatusIcon size={14} />
                        {sb.label}
                      </Badge>
                      <div onClick={(e) => e.stopPropagation()}>
                        <Switch className="h-5 w-10" checked={isActive} disabled={locked || busy} onCheckedChange={(v) => setStatus(u, v)} />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-[hsl(var(--fg))]/80">
                      <div className="font-semibold">{percent}٪ مصرف</div>
                      <div className="font-semibold">
                        {fmtGig(usedGb)} / {fmtGig(u.total_gb)} گیگ
                      </div>
                    </div>
                    <div className="h-2.5 w-full overflow-hidden rounded-md bg-[hsl(var(--surface-card-3))]">
                      <div
                        className={"h-full rounded-md bg-gradient-to-r transition-[width] duration-500 ease-out " + progressTone(percent)}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[hsl(var(--fg))]/70">
                      <div>مجموع مصرف: <span className="font-semibold text-[hsl(var(--fg))]/90">{fmtGig(usedGb)} گیگ</span></div>
                      <div>باقی‌مانده: <span className="font-semibold text-[hsl(var(--fg))]/90">{fmtGig(remainingGb)} گیگ</span></div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      className={`${actionSize} rounded-lg border-[hsl(var(--border))]/90 p-0 transition-all duration-200 hover:-translate-y-0.5 hover:border-sky-400/60 hover:bg-sky-500/10`}
                      size="sm"
                      title={t("users.links")}
                      aria-label={t("users.links")}
                      disabled={busy}
                      onClick={(e) => {
                        e.stopPropagation();
                        openLinks(u);
                      }}
                    >
                      <Layers size={18} />
                    </Button>
                    <Button
                      variant="outline"
                      className={`${actionSize} rounded-lg border-[hsl(var(--border))]/90 p-0 transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo-400/60 hover:bg-indigo-500/10`}
                      size="sm"
                      title={t("users.details")}
                      aria-label={t("users.details")}
                      disabled={busy}
                      onClick={(e) => {
                        e.stopPropagation();
                        router.push(`/app/users/${u.id}`);
                      }}
                    >
                      <SquarePen size={18} />
                    </Button>
                    <Button
                      variant="outline"
                      className={`${actionSize} rounded-lg border-[hsl(var(--border))]/90 p-0 transition-all duration-200 hover:-translate-y-0.5 hover:border-emerald-400/60 hover:bg-emerald-500/10`}
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
                      className={`${actionSize} rounded-lg border-[hsl(var(--border))]/90 p-0 transition-all duration-200 hover:-translate-y-0.5 hover:border-cyan-400/60 hover:bg-cyan-500/10`}
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
                      variant="outline"
                      className={`${actionSize} rounded-lg border-[hsl(var(--border))]/90 p-0 transition-all duration-200 hover:-translate-y-0.5 hover:border-fuchsia-400/60 hover:bg-fuchsia-500/10`}
                      size="sm"
                      title="QR لینک‌ها"
                      aria-label="QR لینک‌ها"
                      disabled={busy}
                      onClick={(e) => {
                        e.stopPropagation();
                        openQr(u);
                      }}
                    >
                      <QrCode size={18} />
                    </Button>
                    {isSingle ? (
                      <>
                        <Button
                          variant="outline"
                          className={`${actionSize} rounded-lg border-[hsl(var(--border))]/90 p-0 transition-all duration-200 hover:-translate-y-0.5 hover:border-amber-400/60 hover:bg-amber-500/10`}
                          size="sm"
                          title={t("users.resetUsage")}
                          aria-label={t("users.resetUsage")}
                          disabled={busy || locked}
                          onClick={(e) => {
                            e.stopPropagation();
                            ask("reset", u);
                          }}
                        >
                          <Gauge size={18} />
                        </Button>
                        <Button
                          variant="outline"
                          className={`${actionSize} rounded-lg border-[hsl(var(--border))]/90 p-0 transition-all duration-200 hover:-translate-y-0.5 hover:border-rose-400/60 hover:bg-rose-500/10`}
                          size="sm"
                          title={t("users.revoke")}
                          aria-label={t("users.revoke")}
                          disabled={busy || locked}
                          onClick={(e) => {
                            e.stopPropagation();
                            ask("revoke", u);
                          }}
                        >
                          <Trash2 size={18} />
                        </Button>
                      </>
                    ) : null}

                    <div onClick={(e) => e.stopPropagation()}>
                      <Menu
                        trigger={
                          <Button
                            variant="outline"
                            className={`${actionSize} rounded-lg border-[hsl(var(--border))]/90 p-0 transition-all duration-200 hover:-translate-y-0.5 hover:border-[hsl(var(--accent)/0.6)] hover:bg-[hsl(var(--accent)/0.12)]`}
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
                            disabled: locked || busy,
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
                            icon: <Trash2 size={16} />,
                            disabled: locked || busy,
                            danger: true,
                            onClick: () => ask("revoke", u),
                          },
                          {
                            label: t("users.delete"),
                            icon: <Trash2 size={16} />,
                            disabled: locked || busy,
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
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Button type="button" size="sm" variant={quickMode === "extend" ? "primary" : "outline"} onClick={() => setQuickMode("extend")}>
                تمدید
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

            {quickMode === "extend" ? (
              <div className="rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(155deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3)/0.28)_100%)] p-3 space-y-3 transition-all duration-200 hover:border-[hsl(var(--accent)/0.35)] hover:shadow-soft">
                <div className="font-medium">تمدید زمانی (روز)</div>
                <div className="flex flex-wrap gap-2">
                  {[7, 30, 90, 180].map((d) => (
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

            {quickMode === "add" ? (
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

            {quickMode === "dec" ? (
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

            {quickMode === "time_dec" ? (
              <div className="rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(155deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3)/0.28)_100%)] p-3 space-y-3 transition-all duration-200 hover:border-[hsl(var(--accent)/0.35)] hover:shadow-soft">
                <div className="font-medium">کاهش زمان (همراه ریفاند)</div>
                <div className="flex flex-wrap gap-2">
                  {[1, 3, 7, 15, 30].map((d) => (
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
                  disabled={busyId === editUser.id || locked}
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
                  disabled={busyId === editUser.id || locked}
                  onClick={() => {
                    setEditOpen(false);
                    ask("revoke", editUser);
                  }}
                >
                  <Trash2 size={15} /> بازسازی لینک
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
            <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-3))] p-3 text-xs text-[hsl(var(--fg))]/80">
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
            <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-3))] p-3 text-xs text-[hsl(var(--fg))]/80">
              پیشنهاد: لینک مستقیم پنل را به کاربر بدهید. لینک اصلی اشتراک برای حالت چندنودی مناسب‌تر است.
            </div>
            <div className="space-y-2">
              <div className="font-semibold">{t("users.masterSub")}</div>
              <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-3))] p-3 break-all">{links.master_link}</div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    copyText(links.master_link).then((ok) => push({ title: ok ? t("common.copied") : t("common.failed"), type: ok ? "success" : "error" }));
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
