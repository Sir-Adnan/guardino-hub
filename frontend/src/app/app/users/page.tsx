"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { copyText } from "@/lib/copy";
import { fmtNumber } from "@/lib/format";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/components/auth-context";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/i18n-context";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Modal } from "@/components/ui/modal";
import { Switch } from "@/components/ui/switch";
import { Menu } from "@/components/ui/menu";
import { useToast } from "@/components/ui/toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Pagination } from "@/components/ui/pagination";
import { ArrowDownUp, Copy, Pencil, Power, Trash2, Clock3, Flame, Users, Link2, SquarePen, Layers, Download, QrCode, ExternalLink } from "lucide-react";

type UserOut = { id: number; label: string; total_gb: number; used_bytes: number; expire_at: string; status: string };
type UsersPage = { items: UserOut[]; total: number };
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

type StatusFilter = "all" | "active" | "disabled" | "expired";
type SortMode = "priority" | "expiry" | "usage" | "newest";

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
  if (s === "active") return { v: "success" as const, label: "Active" };
  if (s === "disabled") return { v: "muted" as const, label: "Disabled" };
  if (s === "expired") return { v: "danger" as const, label: "Expired" };
  return { v: "default" as const, label: status || "—" };
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

export default function UsersPage() {
  const router = useRouter();
  const { me, refresh: refreshMe } = useAuth();
  const { t } = useI18n();
  const { push } = useToast();
  const locked = (me?.balance ?? 1) <= 0;

  const [q, setQ] = React.useState("");
  const [data, setData] = React.useState<UsersPage | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<StatusFilter>("all");
  const [sortMode, setSortMode] = React.useState<SortMode>("newest");

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
  const [quickMode, setQuickMode] = React.useState<"extend" | "add" | "dec">("extend");
  const [editDays, setEditDays] = React.useState(30);
  const [editAddGb, setEditAddGb] = React.useState(10);
  const [editDecGb, setEditDecGb] = React.useState(5);
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(50);

  async function load() {
    setErr(null);
    try {
      const offset = (page - 1) * pageSize;
      const res = await apiFetch<UsersPage>(`/api/v1/reseller/users?offset=${offset}&limit=${pageSize}`);
      setData(res);
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
    loadNodes().catch(() => undefined);
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
    const total = data?.total ?? rawItems.length;
    const active = rawItems.filter((u) => (u.status || "").toLowerCase() === "active").length;
    const expiringSoon = rawItems.filter((u) => {
      const d = safeDaysLeft(u.expire_at);
      const s = (u.status || "").toLowerCase();
      return s === "active" && d !== null && d >= 0 && d <= 7;
    }).length;
    const highUsage = rawItems.filter((u) => computePriority(u).percent >= 80 && (u.status || "").toLowerCase() === "active").length;
    return { total, active, expiringSoon, highUsage };
  }, [rawItems, data?.total]);

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

  async function copyMaster(u: UserOut) {
    try {
      const res = await fetchUserLinks(u, true);
      const ok = await copyText(res.master_link);
      push({ title: ok ? t("common.copied") : t("common.failed"), type: ok ? "success" : "error" });
    } catch (e: any) {
      push({ title: t("common.error"), desc: String(e.message || e), type: "error" });
    }
  }

  async function copyAllLinksForUser(u: UserOut) {
    try {
      const res = await fetchUserLinks(u, true);
      const direct = extractDirectLinks(res);
      const lines = [...direct, res.master_link].filter(Boolean).join("\n");
      const ok = await copyText(lines);
      push({ title: ok ? t("common.copied") : t("common.failed"), type: ok ? "success" : "error" });
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
    setEditAddGb(10);
    setEditDecGb(5);
    setEditOpen(true);
  }

  function FilterButton({ value, label }: { value: StatusFilter; label: string }) {
    const active = filter === value;
    return (
      <button
        type="button"
        onClick={() => setFilter(value)}
        className={
          "px-3 py-1.5 text-xs rounded-xl border transition " +
          (active
            ? "bg-[hsl(var(--accent))] text-[hsl(var(--accent-fg))] border-transparent shadow-soft"
            : "bg-[hsl(var(--card))] border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]")
        }
      >
        {label}
      </button>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xl font-semibold">{t("users.title")}</div>
              <div className="text-sm text-[hsl(var(--fg))]/70">{t("users.subtitle")}</div>
            </div>
            <a
              href="/app/users/new"
              className="rounded-xl px-4 py-2 text-sm font-medium bg-[hsl(var(--accent))] text-[hsl(var(--accent-fg))] shadow-soft"
            >
              {t("users.create")}
            </a>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3">
              <div className="flex items-center justify-between">
                <div className="text-xs text-[hsl(var(--fg))]/70">{t("users.statsTotal")}</div>
                <Users size={16} className="opacity-60" />
              </div>
              <div className="mt-1 text-lg font-semibold">{fmtNumber(stats.total)}</div>
            </div>
            <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3">
              <div className="flex items-center justify-between">
                <div className="text-xs text-[hsl(var(--fg))]/70">{t("users.statsActive")}</div>
                <div className="h-2 w-2 rounded-full bg-emerald-500/70" />
              </div>
              <div className="mt-1 text-lg font-semibold">{fmtNumber(stats.active)}</div>
            </div>
            <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3">
              <div className="flex items-center justify-between">
                <div className="text-xs text-[hsl(var(--fg))]/70">{t("users.statsExpiringSoon")}</div>
                <Clock3 size={16} className="opacity-60" />
              </div>
              <div className="mt-1 text-lg font-semibold">{fmtNumber(stats.expiringSoon)}</div>
            </div>
            <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3">
              <div className="flex items-center justify-between">
                <div className="text-xs text-[hsl(var(--fg))]/70">{t("users.statsHighUsage")}</div>
                <Flame size={16} className="opacity-60" />
              </div>
              <div className="mt-1 text-lg font-semibold">{fmtNumber(stats.highUsage)}</div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Input
              placeholder={t("users.search")}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="max-w-md"
            />
            <div className="text-xs text-[hsl(var(--fg))]/70">
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

            <Menu
              trigger={
                <Button variant="outline" className="gap-2">
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

          {locked ? (
            <div className="text-xs rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))] p-3">
              {t("users.balanceZero")}
            </div>
          ) : null}
          {err ? <div className="text-sm text-red-500">{err}</div> : null}
        </CardContent>
      </Card>

      {!data ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
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
        <div className="grid gap-4 md:grid-cols-2">
          {items.map((u) => {
            const totalBytes = (u.total_gb || 0) * 1024 * 1024 * 1024;
            const usedGb = bytesToGb(u.used_bytes || 0);
            const pct = totalBytes > 0 ? clamp01((u.used_bytes || 0) / totalBytes) : 0;
            const percent = Math.round(pct * 100);

            const pr = computePriority(u);
            const expText = pr.days === null ? "—" : pr.days >= 0 ? t("users.expiresIn").replace("{days}", String(pr.days)) : t("users.expired");

            const sb = statusBadge(u.status);
            const isActive = (u.status || "").toLowerCase() === "active";
            const busy = busyId === u.id;

            return (
              <Card key={u.id} className="overflow-hidden">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="text-base font-semibold break-all leading-relaxed">{u.label}</div>
                      </div>
                      <div className="mt-1 text-xs text-[hsl(var(--fg))]/70">{expText}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={sb.v}>{sb.label}</Badge>
                      <Switch checked={isActive} disabled={locked || busy} onCheckedChange={(v) => setStatus(u, v)} />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs text-[hsl(var(--fg))]/70">
                      <div>{t("users.usage")}</div>
                      <div>
                        <span className="font-semibold">{new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(usedGb)}</span> / {fmtNumber(u.total_gb)} GB ({percent}%)
                      </div>
                    </div>
                    <Progress value={percent} />
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      className="h-9 w-9 p-0"
                      size="sm"
                      title={t("users.links")}
                      aria-label={t("users.links")}
                      disabled={busy}
                      onClick={() => openLinks(u)}
                    >
                      <Layers size={16} />
                    </Button>
                    <Button
                      variant="outline"
                      className="h-9 w-9 p-0"
                      size="sm"
                      title={t("users.details")}
                      aria-label={t("users.details")}
                      disabled={busy}
                      onClick={() => router.push(`/app/users/${u.id}`)}
                    >
                      <SquarePen size={16} />
                    </Button>
                    <Button
                      variant="outline"
                      className="h-9 w-9 p-0"
                      size="sm"
                      title="کپی لینک اصلی اشتراک"
                      aria-label="کپی لینک اصلی اشتراک"
                      disabled={busy}
                      onClick={() => copyMaster(u)}
                    >
                      <Copy size={16} />
                    </Button>
                    <Button
                      variant="outline"
                      className="h-9 w-9 p-0"
                      size="sm"
                      title="QR لینک‌ها"
                      aria-label="QR لینک‌ها"
                      disabled={busy}
                      onClick={() => openQr(u)}
                    >
                      <QrCode size={16} />
                    </Button>

                    <Menu
                      trigger={
                        <Button
                          variant="outline"
                          className="h-9 w-9 p-0"
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
                          icon: <Flame size={16} />,
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
                      ]} />
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
            <div className="grid grid-cols-3 gap-2">
              <Button type="button" size="sm" variant={quickMode === "extend" ? "primary" : "outline"} onClick={() => setQuickMode("extend")}>
                تمدید
              </Button>
              <Button type="button" size="sm" variant={quickMode === "add" ? "primary" : "outline"} onClick={() => setQuickMode("add")}>
                افزایش حجم
              </Button>
              <Button type="button" size="sm" variant={quickMode === "dec" ? "primary" : "outline"} onClick={() => setQuickMode("dec")}>
                کاهش حجم
              </Button>
            </div>

            {quickMode === "extend" ? (
              <div className="rounded-xl border border-[hsl(var(--border))] p-3 space-y-2">
                <div className="font-medium">تمدید زمانی (روز)</div>
                <div className="flex flex-wrap gap-2">
                  {[7, 30, 90, 180].map((d) => (
                    <Button key={d} type="button" size="sm" variant={editDays === d ? "primary" : "outline"} onClick={() => setEditDays(d)}>
                      {d}
                    </Button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input type="number" value={editDays} onChange={(e) => setEditDays(Math.max(1, Number(e.target.value) || 1))} />
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
              </div>
            ) : null}

            {quickMode === "add" ? (
              <div className="rounded-xl border border-[hsl(var(--border))] p-3 space-y-2">
                <div className="font-medium">افزایش حجم (GB)</div>
                <div className="flex flex-wrap gap-2">
                  {[5, 10, 20, 50].map((g) => (
                    <Button key={g} type="button" size="sm" variant={editAddGb === g ? "primary" : "outline"} onClick={() => setEditAddGb(g)}>
                      +{g}
                    </Button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input type="number" value={editAddGb} onChange={(e) => setEditAddGb(Math.max(1, Number(e.target.value) || 1))} />
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
              <div className="rounded-xl border border-[hsl(var(--border))] p-3 space-y-2">
                <div className="font-medium">کاهش حجم (ریفاند)</div>
                <div className="flex flex-wrap gap-2">
                  {[1, 5, 10, 20].map((g) => (
                    <Button key={g} type="button" size="sm" variant={editDecGb === g ? "primary" : "outline"} onClick={() => setEditDecGb(g)}>
                      -{g}
                    </Button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input type="number" value={editDecGb} onChange={(e) => setEditDecGb(Math.max(1, Number(e.target.value) || 1))} />
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
            <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))] p-3 text-xs text-[hsl(var(--fg))]/80">
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
                    <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/50 p-2 text-[11px] break-all">
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
            <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))] p-3 text-xs text-[hsl(var(--fg))]/80">
              پیشنهاد: لینک مستقیم پنل را به کاربر بدهید. لینک اصلی اشتراک برای حالت چندنودی مناسب‌تر است.
            </div>
            <div className="space-y-2">
              <div className="font-semibold">{t("users.masterSub")}</div>
              <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))] p-3 break-all">{links.master_link}</div>
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
