"use client";

import * as React from "react";
import { Activity, Database, KeyRound, Link2, Pencil, PlugZap, Plus, ShieldCheck, Trash2, UploadCloud, UsersRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ConfirmModal } from "@/components/ui/confirm";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Pagination } from "@/components/ui/pagination";
import { Switch } from "@/components/ui/switch";
import { apiFetch } from "@/lib/api";
import { fmtNumber } from "@/lib/format";
import { useI18n } from "@/components/i18n-context";
import { useToast } from "@/components/ui/toast";

type AllocationOut = {
  id: number;
  reseller_id: number;
  node_id: number;
  enabled: boolean;
  default_for_reseller: boolean;
  price_per_gb_override?: number | null;
  credential_mode?: "shared" | "dedicated";
  credentials?: Record<string, unknown>;
};

type NodeOut = {
  id: number;
  name: string;
  panel_type: string;
  is_enabled: boolean;
};
type NodeList = { items: NodeOut[]; total: number };

type GroupedAllocationItem = AllocationOut & {
  node_name: string;
  panel_type: string;
  node_is_enabled: boolean;
};

type ResellerAllocationGroup = {
  reseller_id: number;
  reseller_name: string;
  reseller_role?: string;
  reseller_status: string;
  allocations: GroupedAllocationItem[];
  nodes: NodeOut[];
  active_panels_count: number;
};
type GroupedAllocationList = { items: ResellerAllocationGroup[]; total: number };

const ADMIN_FETCH_LIMIT = 200;

type CredentialAuthType = "password" | "token";
type CredentialDraft = {
  mode: "shared" | "dedicated";
  authType: CredentialAuthType;
  username: string;
  password: string;
  token: string;
  autoImport: boolean;
};

function emptyCredentialDraft(mode: "shared" | "dedicated" = "shared"): CredentialDraft {
  return {
    mode,
    authType: "password",
    username: "",
    password: "",
    token: "",
    autoImport: true,
  };
}

function credentialDraftFromAllocation(a: Pick<AllocationOut, "credential_mode" | "credentials">): CredentialDraft {
  const credentials = a.credentials || {};
  const token = String(credentials.token || credentials.access_token || credentials.api_key || credentials.apikey || "");
  const username = String(credentials.username || "");
  const password = String(credentials.password || "");
  return {
    mode: a.credential_mode || "shared",
    authType: token && !username ? "token" : "password",
    username,
    password,
    token,
    autoImport: true,
  };
}

async function fetchAllNodesForAdmin(maxPages = 50): Promise<NodeOut[]> {
  const all: NodeOut[] = [];
  let offset = 0;
  let total = 0;
  for (let i = 0; i < maxPages; i++) {
    const res = await apiFetch<NodeList>(`/api/v1/admin/nodes?offset=${offset}&limit=${ADMIN_FETCH_LIMIT}`);
    const chunk = res.items || [];
    all.push(...chunk.map((n) => ({ id: n.id, name: n.name, panel_type: n.panel_type, is_enabled: n.is_enabled })));
    total = res.total || all.length;
    if (!chunk.length || all.length >= total) break;
    offset += chunk.length;
  }
  return all;
}

function statusVariant(status: string): "success" | "warning" | "danger" | "muted" {
  if (status === "active") return "success";
  if (status === "disabled") return "warning";
  if (status === "deleted") return "muted";
  return "danger";
}

function allocationVariant(a: GroupedAllocationItem): "default" | "success" | "warning" | "danger" | "muted" {
  if (!a.node_is_enabled) return "danger";
  if (!a.enabled) return "muted";
  if (a.default_for_reseller) return "success";
  return "default";
}

function isAdminGroup(group: ResellerAllocationGroup | null): boolean {
  return (group?.reseller_role || "").toLowerCase() === "admin";
}

function accountRoleLabel(group: ResellerAllocationGroup | null): string {
  return isAdminGroup(group) ? "سوپرادمین" : "رسیلر";
}

export default function AllocationsPage() {
  const { push } = useToast();
  const { t } = useI18n();

  const [nodes, setNodes] = React.useState<NodeOut[]>([]);
  const [groups, setGroups] = React.useState<ResellerAllocationGroup[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(20);
  const [q, setQ] = React.useState("");

  const [selectedResellerId, setSelectedResellerId] = React.useState<number | null>(null);
  const [addNodeId, setAddNodeId] = React.useState<number | "">("");
  const [addPriceOverride, setAddPriceOverride] = React.useState<number | "">("");
  const [addEnabled, setAddEnabled] = React.useState(true);
  const [addDefault, setAddDefault] = React.useState(false);
  const [addCredentialDraft, setAddCredentialDraft] = React.useState<CredentialDraft>(() => emptyCredentialDraft());
  const [priceDrafts, setPriceDrafts] = React.useState<Record<number, number | "">>({});
  const [credentialDrafts, setCredentialDrafts] = React.useState<Record<number, CredentialDraft>>({});
  const [confirmDelete, setConfirmDelete] = React.useState<GroupedAllocationItem | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [credentialBusy, setCredentialBusy] = React.useState<number | null>(null);
  const initialDeepLinkHandled = React.useRef(false);

  const selectedGroup = React.useMemo(
    () => groups.find((g) => g.reseller_id === selectedResellerId) || null,
    [groups, selectedResellerId]
  );
  const selectedActivePanelTypes = React.useMemo(() => {
    if (!selectedGroup) return 0;
    return new Set(
      selectedGroup.allocations
        .filter((a) => a.enabled && a.node_is_enabled)
        .map((a) => a.panel_type)
    ).size;
  }, [selectedGroup]);

  const availableNodes = React.useMemo(() => {
    const used = new Set((selectedGroup?.allocations || []).map((a) => a.node_id));
    return nodes.filter((n) => !used.has(n.id));
  }, [nodes, selectedGroup]);

  const stats = React.useMemo(() => {
    const allocatedResellers = groups.filter((g) => g.allocations.length > 0).length;
    const enabledAllocations = groups.reduce((sum, g) => sum + g.allocations.filter((a) => a.enabled && a.node_is_enabled).length, 0);
    const defaultAllocations = groups.reduce((sum, g) => sum + g.allocations.filter((a) => a.default_for_reseller).length, 0);
    const activePanelTypes = new Set<string>();
    groups.forEach((g) => g.allocations.forEach((a) => {
      if (a.enabled && a.node_is_enabled) activePanelTypes.add(a.panel_type);
    }));
    return { allocatedResellers, enabledAllocations, defaultAllocations, activePanelTypes: activePanelTypes.size };
  }, [groups]);

  async function load(nextPage = page, nextPageSize = pageSize, search = q) {
    try {
      const params = new URLSearchParams({
        offset: String((nextPage - 1) * nextPageSize),
        limit: String(nextPageSize),
      });
      const term = search.trim();
      if (term) params.set("q", term);

      const [groupedRes, nodeRows] = await Promise.all([
        apiFetch<GroupedAllocationList>(`/api/v1/admin/resellers/allocations/grouped?${params.toString()}`),
        fetchAllNodesForAdmin(),
      ]);
      setGroups(groupedRes.items || []);
      setTotal(groupedRes.total || 0);
      setNodes(nodeRows);

      const safeTotal = groupedRes.total || 0;
      const offset = (nextPage - 1) * nextPageSize;
      if ((groupedRes.items || []).length === 0 && safeTotal > 0 && offset >= safeTotal) {
        const lastPage = Math.max(1, Math.ceil(safeTotal / nextPageSize));
        if (lastPage !== nextPage) setPage(lastPage);
      }
    } catch (e: any) {
      push({ title: t("common.error"), desc: String(e.message || e), type: "error" });
    }
  }

  function resetAddForm() {
    setAddNodeId("");
    setAddPriceOverride("");
    setAddEnabled(true);
    setAddDefault(false);
    setAddCredentialDraft(emptyCredentialDraft());
  }

  function credentialsFromDraft(draft: CredentialDraft): Record<string, unknown> | null {
    if (draft.mode === "shared") return {};
    if (draft.authType === "token") {
      const token = draft.token.trim();
      if (!token) {
        push({ title: t("common.error"), desc: t("adminAllocations.errCredentials"), type: "error" });
        return null;
      }
      return { token };
    }

    const username = draft.username.trim();
    const password = draft.password;
    if (!username || !password) {
      push({ title: t("common.error"), desc: t("adminAllocations.errCredentials"), type: "error" });
      return null;
    }
    return { username, password };
  }

  function isImportSupported(panelType: string) {
    return panelType === "pasarguard" || panelType === "marzban";
  }

  function updateAllocationDraft(id: number, patch: Partial<CredentialDraft>) {
    setCredentialDrafts((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] || emptyCredentialDraft()),
        ...patch,
      },
    }));
  }

  async function patchAllocation(id: number, payload: Partial<AllocationOut>) {
    try {
      await apiFetch<AllocationOut>(`/api/v1/admin/allocations/${id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      await load(page, pageSize, q);
    } catch (e: any) {
      push({ title: t("common.error"), desc: String(e.message || e), type: "error" });
    }
  }

  async function addAllocation() {
    if (!selectedGroup || addNodeId === "") return;
    const selectedNode = nodes.find((n) => n.id === Number(addNodeId));
    const parsedCredentials = credentialsFromDraft(addCredentialDraft);
    if (!parsedCredentials) return;
    setBusy(true);
    try {
      const created = await apiFetch<AllocationOut>("/api/v1/admin/allocations", {
        method: "POST",
        body: JSON.stringify({
          reseller_id: selectedGroup.reseller_id,
          node_id: Number(addNodeId),
          enabled: addEnabled,
          default_for_reseller: addDefault,
          price_per_gb_override: addPriceOverride === "" ? null : Number(addPriceOverride),
          credential_mode: addCredentialDraft.mode,
          credentials: addCredentialDraft.mode === "dedicated" ? parsedCredentials : {},
        }),
      });
      push({ title: t("adminAllocations.created"), type: "success" });
      if (addCredentialDraft.mode === "dedicated" && addCredentialDraft.autoImport && selectedNode && isImportSupported(selectedNode.panel_type)) {
        await importAllocationUsersById(created.id, false);
      }
      resetAddForm();
      await load(page, pageSize, q);
    } catch (e: any) {
      push({ title: t("common.error"), desc: String(e.message || e), type: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function deleteAllocation(a: GroupedAllocationItem) {
    try {
      await apiFetch<any>(`/api/v1/admin/allocations/${a.id}`, { method: "DELETE" });
      push({ title: t("adminAllocations.deleted"), desc: `${a.node_name} (#${a.node_id})`, type: "success" });
      await load(page, pageSize, q);
    } catch (e: any) {
      push({ title: t("common.error"), desc: String(e.message || e), type: "error" });
    }
  }

  async function saveAllocationCredentials(a: GroupedAllocationItem) {
    const draft = credentialDrafts[a.id] || credentialDraftFromAllocation(a);
    const parsedCredentials = credentialsFromDraft(draft);
    if (!parsedCredentials) return;
    setCredentialBusy(a.id);
    try {
      await apiFetch<AllocationOut>(`/api/v1/admin/allocations/${a.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          credential_mode: draft.mode,
          credentials: draft.mode === "dedicated" ? parsedCredentials : {},
        }),
      });
      push({ title: t("adminAllocations.credentialsSaved"), type: "success" });
      if (draft.mode === "dedicated" && draft.autoImport && isImportSupported(a.panel_type)) {
        await importAllocationUsersById(a.id, false);
      }
      await load(page, pageSize, q);
    } catch (e: any) {
      push({ title: t("common.error"), desc: String(e.message || e), type: "error" });
    } finally {
      setCredentialBusy(null);
    }
  }

  async function testAllocation(a: GroupedAllocationItem) {
    setCredentialBusy(a.id);
    try {
      const res = await apiFetch<{ ok: boolean; detail: string }>(`/api/v1/admin/allocations/${a.id}/test-connection`, { method: "POST" });
      push({ title: res.ok ? t("adminAllocations.connectionOk") : t("adminAllocations.connectionFailed"), desc: res.detail || "-", type: res.ok ? "success" : "error" });
    } catch (e: any) {
      push({ title: t("common.error"), desc: String(e.message || e), type: "error" });
    } finally {
      setCredentialBusy(null);
    }
  }

  async function importAllocationUsersById(allocationId: number, dryRun: boolean) {
      const res = await apiFetch<{ scanned: number; imported: number; skipped_existing: number; errors: number; total_remote?: number }>(
        `/api/v1/admin/allocations/${allocationId}/import-users`,
        {
          method: "POST",
          body: JSON.stringify({ dry_run: dryRun, limit: 500, offset: 0, skip_existing: true }),
        }
      );
      push({
        title: dryRun ? t("adminAllocations.importPreview") : t("adminAllocations.importCompleted"),
        desc: `scanned=${fmtNumber(res.scanned)} imported=${fmtNumber(res.imported)} skipped=${fmtNumber(res.skipped_existing)} errors=${fmtNumber(res.errors)}`,
        type: res.errors ? "warning" : "success",
      });
      if (!dryRun) await load(page, pageSize, q);
  }

  async function importAllocationUsers(a: GroupedAllocationItem, dryRun: boolean) {
    setCredentialBusy(a.id);
    try {
      await importAllocationUsersById(a.id, dryRun);
    } catch (e: any) {
      push({ title: t("common.error"), desc: String(e.message || e), type: "error" });
    } finally {
      setCredentialBusy(null);
    }
  }

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const resellerId = Number(params.get("resellerId") || 0);
    if (resellerId > 0) {
      setQ(String(resellerId));
      setPage(1);
    }
  }, []);

  React.useEffect(() => {
    load(page, pageSize, q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, q]);

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const resellerId = Number(params.get("resellerId") || 0);
    if (resellerId <= 0 || initialDeepLinkHandled.current) return;
    const group = groups.find((g) => g.reseller_id === resellerId);
    if (group) {
      initialDeepLinkHandled.current = true;
      setSelectedResellerId(group.reseller_id);
    }
  }, [groups]);

  React.useEffect(() => {
    if (!selectedGroup) {
      setPriceDrafts({});
      return;
    }
    const drafts: Record<number, number | ""> = {};
    const credentialNext: Record<number, CredentialDraft> = {};
    selectedGroup.allocations.forEach((a) => {
      drafts[a.id] = a.price_per_gb_override == null ? "" : a.price_per_gb_override;
      credentialNext[a.id] = credentialDraftFromAllocation(a);
    });
    setPriceDrafts(drafts);
    setCredentialDrafts(credentialNext);
    resetAddForm();
  }, [selectedGroup]);

  const selectClass =
    "w-full rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(155deg,hsl(var(--surface-input-1))_0%,hsl(var(--surface-input-2))_58%,hsl(var(--surface-input-3))_100%)] px-3 py-2 text-sm outline-none transition-all duration-200 hover:border-[hsl(var(--accent)/0.35)] focus:ring-2 focus:ring-[hsl(var(--accent)/0.35)]";
  const metricCardClass =
    "rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(155deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] p-3 shadow-[0_10px_22px_-20px_hsl(var(--fg)/0.6)]";
  const credentialBoxClass =
    "rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-2))] p-3";
  const selectedAddNode = React.useMemo(
    () => nodes.find((n) => n.id === Number(addNodeId)) || null,
    [nodes, addNodeId]
  );

  function renderCredentialEditor(
    draft: CredentialDraft,
    onChange: (patch: Partial<CredentialDraft>) => void,
    panelType?: string | null
  ) {
    const dedicated = draft.mode === "dedicated";
    const importable = !!panelType && isImportSupported(panelType);
    return (
      <div className="grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-medium text-[hsl(var(--fg))]/75">
            <KeyRound size={13} />
            {t("adminAllocations.credentialsTitle")}
          </div>
          <select className={selectClass} value={draft.mode} onChange={(e) => onChange({ mode: e.target.value as "shared" | "dedicated" })}>
            <option value="shared">{t("adminAllocations.credentialsShared")}</option>
            <option value="dedicated">{t("adminAllocations.credentialsDedicated")}</option>
          </select>
          <Badge variant={dedicated ? "warning" : "muted"}>
            {dedicated ? t("adminAllocations.roleDedicated") : t("adminAllocations.roleShared")}
          </Badge>
        </div>

        {dedicated ? (
          <div className={credentialBoxClass}>
            <div className="grid gap-2 md:grid-cols-[180px_minmax(0,1fr)_minmax(0,1fr)]">
              <div className="space-y-1">
                <div className="text-xs text-[hsl(var(--fg))]/65">{t("adminAllocations.authMethod")}</div>
                <select className={selectClass} value={draft.authType} onChange={(e) => onChange({ authType: e.target.value as CredentialAuthType })}>
                  <option value="password">{t("adminAllocations.authPassword")}</option>
                  <option value="token">{t("adminAllocations.authToken")}</option>
                </select>
              </div>
              {draft.authType === "password" ? (
                <>
                  <div className="space-y-1">
                    <div className="text-xs text-[hsl(var(--fg))]/65">{t("common.username")}</div>
                    <Input value={draft.username} onChange={(e) => onChange({ username: e.target.value })} autoComplete="off" />
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs text-[hsl(var(--fg))]/65">{t("common.password")}</div>
                    <Input value={draft.password} onChange={(e) => onChange({ password: e.target.value })} type="password" autoComplete="new-password" />
                  </div>
                </>
              ) : (
                <div className="space-y-1 md:col-span-2">
                  <div className="text-xs text-[hsl(var(--fg))]/65">{t("common.token")}</div>
                  <Input value={draft.token} onChange={(e) => onChange({ token: e.target.value })} type="password" autoComplete="off" />
                </div>
              )}
            </div>
            {importable ? (
              <label className="mt-3 flex items-start gap-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] px-3 py-2 text-xs leading-5 text-[hsl(var(--fg))]/75">
                <Switch checked={draft.autoImport} onCheckedChange={(v) => onChange({ autoImport: v })} />
                <span>{t("adminAllocations.autoImportHint")}</span>
              </label>
            ) : null}
          </div>
        ) : (
          <div className={credentialBoxClass}>
            <div className="text-xs leading-6 text-[hsl(var(--fg))]/70">{t("adminAllocations.sharedHint")}</div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(110deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] p-4 shadow-[0_15px_28px_-20px_hsl(var(--fg)/0.35)] sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] px-3 py-1 text-xs text-[hsl(var(--fg))]/75">
              <Link2 size={13} />
              Reseller Node Access
            </div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight">{t("adminAllocations.title")}</h1>
            <p className="mt-1 text-sm text-[hsl(var(--fg))]/70">نمای حساب‌محور برای مدیریت نودها، پنل‌ها و قیمت‌های اختصاصی سوپرادمین و رسیلرها.</p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(130deg,hsl(var(--accent)/0.16),hsl(var(--surface-card-1)))] px-3 py-2 text-xs font-medium text-[hsl(var(--fg))]/80">
            <Activity size={14} />
            {fmtNumber(total)} حساب
          </div>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className={metricCardClass}>
          <div className="flex items-center justify-between">
            <div className="text-xs text-[hsl(var(--fg))]/70">حساب‌های دارای تخصیص</div>
            <UsersRound size={16} className="opacity-60" />
          </div>
          <div className="mt-1 text-lg font-semibold">{fmtNumber(stats.allocatedResellers)}</div>
        </div>
        <div className={metricCardClass}>
          <div className="flex items-center justify-between">
            <div className="text-xs text-[hsl(var(--fg))]/70">تخصیص فعال</div>
            <ShieldCheck size={16} className="opacity-60" />
          </div>
          <div className="mt-1 text-lg font-semibold text-emerald-600">{fmtNumber(stats.enabledAllocations)}</div>
        </div>
        <div className={metricCardClass}>
          <div className="flex items-center justify-between">
            <div className="text-xs text-[hsl(var(--fg))]/70">نود پیش‌فرض</div>
            <Link2 size={16} className="opacity-60" />
          </div>
          <div className="mt-1 text-lg font-semibold text-amber-600">{fmtNumber(stats.defaultAllocations)}</div>
        </div>
        <div className={metricCardClass}>
          <div className="flex items-center justify-between">
            <div className="text-xs text-[hsl(var(--fg))]/70">نوع پنل فعال</div>
            <Activity size={16} className="opacity-60" />
          </div>
          <div className="mt-1 text-lg font-semibold">{fmtNumber(stats.activePanelTypes)}</div>
        </div>
      </div>

      <Card className="overflow-hidden">
        <CardHeader>
          <div className="text-xl font-semibold">تخصیص‌ها بر اساس حساب</div>
          <div className="text-sm text-[hsl(var(--fg))]/70">سوپرادمین و هر رسیلر فقط یک بار نمایش داده می‌شوند و نودهای مرتبط داخل همان کارت دیده می‌شوند.</div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(130deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] p-2">
            <Input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              placeholder="جستجوی سوپرادمین، رسیلر، ID یا نام کاربری"
            />
          </div>

          <div className="overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))]">
            {groups.map((group) => {
              const activeNodes = group.allocations.filter((a) => a.enabled && a.node_is_enabled).length;
              const activePanelTypes = new Set(
                group.allocations
                  .filter((a) => a.enabled && a.node_is_enabled)
                  .map((a) => a.panel_type)
              ).size;
              const roleLabel = accountRoleLabel(group);
              const adminAccount = isAdminGroup(group);
              return (
                <article
                  key={group.reseller_id}
                  className="grid gap-3 border-b border-[hsl(var(--border))] p-2.5 transition-colors last:border-b-0 hover:bg-[hsl(var(--accent)/0.06)] md:grid-cols-[minmax(150px,1.1fr)_72px_72px_72px_minmax(220px,2fr)_auto] md:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-sm font-semibold">{group.reseller_name}</h2>
                      <Badge variant={adminAccount ? "warning" : "default"}>{roleLabel}</Badge>
                      <Badge variant={statusVariant(group.reseller_status)}>{group.reseller_status}</Badge>
                    </div>
                    <div className="mt-1 text-xs text-[hsl(var(--fg))]/60">#{group.reseller_id}</div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-xs md:contents">
                    <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-2))] px-2 py-1.5 md:border-0 md:bg-transparent md:p-0">
                      <div className="text-[hsl(var(--fg))]/55">نود</div>
                      <div className="font-semibold">{fmtNumber(group.allocations.length)}</div>
                    </div>
                    <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-2))] px-2 py-1.5 md:border-0 md:bg-transparent md:p-0">
                      <div className="text-[hsl(var(--fg))]/55">فعال</div>
                      <div className="font-semibold text-emerald-600">{fmtNumber(activeNodes)}</div>
                    </div>
                    <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-2))] px-2 py-1.5 md:border-0 md:bg-transparent md:p-0">
                      <div className="text-[hsl(var(--fg))]/55">پنل</div>
                      <div className="font-semibold">{fmtNumber(activePanelTypes)}</div>
                    </div>
                  </div>

                  <div className="min-w-0">
                    <div className="flex max-h-16 flex-wrap gap-1.5 overflow-hidden">
                      {group.allocations.slice(0, 6).map((a) => (
                        <Badge key={a.id} variant={allocationVariant(a)}>
                          {a.node_name} · {a.panel_type}
                        </Badge>
                      ))}
                      {group.allocations.length > 6 ? <Badge variant="muted">+{fmtNumber(group.allocations.length - 6)}</Badge> : null}
                      {!group.allocations.length ? <Badge variant="muted">بدون تخصیص</Badge> : null}
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <Button type="button" size="sm" variant="outline" onClick={() => setSelectedResellerId(group.reseller_id)}>
                      مدیریت
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>

          {!groups.length ? <div className="rounded-xl border border-[hsl(var(--border))] p-4 text-sm text-[hsl(var(--fg))]/70">{t("common.empty")}</div> : null}

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

      <Modal
        open={!!selectedGroup}
        onClose={() => setSelectedResellerId(null)}
        title={selectedGroup ? `مدیریت تخصیص‌ها - ${accountRoleLabel(selectedGroup)} ${selectedGroup.reseller_name}` : "مدیریت تخصیص‌ها"}
        className="!max-w-6xl"
      >
        {selectedGroup ? (
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] p-3">
                <div className="text-xs text-[hsl(var(--fg))]/60">حساب</div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-semibold">{selectedGroup.reseller_name}</span>
                  <Badge variant={isAdminGroup(selectedGroup) ? "warning" : "default"}>{accountRoleLabel(selectedGroup)}</Badge>
                </div>
              </div>
              <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] p-3">
                <div className="text-xs text-[hsl(var(--fg))]/60">تعداد نود</div>
                <div className="mt-1 text-sm font-semibold">{fmtNumber(selectedGroup.allocations.length)}</div>
              </div>
              <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] p-3">
                <div className="text-xs text-[hsl(var(--fg))]/60">نوع پنل فعال</div>
                <div className="mt-1 text-sm font-semibold">{fmtNumber(selectedActivePanelTypes)}</div>
              </div>
              <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] p-3">
                <div className="text-xs text-[hsl(var(--fg))]/60">وضعیت</div>
                <div className="mt-1"><Badge variant={statusVariant(selectedGroup.reseller_status)}>{selectedGroup.reseller_status}</Badge></div>
              </div>
            </div>

            <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] p-3">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Plus size={16} />
                افزودن نود جدید
              </div>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_120px_120px_auto] xl:items-end">
                <div className="space-y-1">
                  <div className="text-xs text-[hsl(var(--fg))]/65">نود</div>
                  <select className={selectClass} value={addNodeId} onChange={(e) => setAddNodeId(e.target.value === "" ? "" : Number(e.target.value))}>
                    <option value="">انتخاب نود</option>
                    {availableNodes.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.name} ({n.panel_type}) #{n.id}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-[hsl(var(--fg))]/65">قیمت اختصاصی/GB</div>
                  <Input type="number" value={addPriceOverride} onChange={(e) => setAddPriceOverride(e.target.value === "" ? "" : Number(e.target.value))} />
                </div>
                <label className="flex h-10 items-center gap-2 rounded-xl border border-[hsl(var(--border))] px-3 text-xs">
                  <Switch checked={addEnabled} onCheckedChange={setAddEnabled} />
                  فعال
                </label>
                <label className="flex h-10 items-center gap-2 rounded-xl border border-[hsl(var(--border))] px-3 text-xs">
                  <Switch checked={addDefault} onCheckedChange={setAddDefault} />
                  پیش‌فرض
                </label>
                <Button type="button" onClick={addAllocation} disabled={busy || addNodeId === ""}>
                  افزودن
                </Button>
              </div>
              <div className="mt-3">
                {renderCredentialEditor(
                  addCredentialDraft,
                  (patch) => setAddCredentialDraft((prev) => ({ ...prev, ...patch })),
                  selectedAddNode?.panel_type
                )}
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))]">
              {selectedGroup.allocations.map((a) => (
                <div key={a.id} className="border-b border-[hsl(var(--border))] p-3 last:border-b-0">
                  <div className="grid gap-3 xl:grid-cols-[minmax(180px,1.2fr)_minmax(170px,1fr)_auto_minmax(180px,1fr)_auto] xl:items-center">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="truncate text-sm font-semibold">{a.node_name}</div>
                        <Badge variant={a.node_is_enabled ? "default" : "danger"}>{a.node_is_enabled ? "نود فعال" : "نود غیرفعال"}</Badge>
                        <Badge variant={a.enabled ? "success" : "muted"}>{a.enabled ? "تخصیص فعال" : "تخصیص غیرفعال"}</Badge>
                      </div>
                      <div className="mt-1 text-xs text-[hsl(var(--fg))]/65">{a.panel_type} · node #{a.node_id} · allocation #{a.id}</div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {a.default_for_reseller ? <Badge variant="warning">پیش‌فرض</Badge> : <Badge variant="muted">غیر پیش‌فرض</Badge>}
                      {a.price_per_gb_override != null ? <Badge variant="default">{fmtNumber(a.price_per_gb_override)}/GB</Badge> : null}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <label className="flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] px-3 py-2 text-xs">
                        <Switch checked={a.enabled} onCheckedChange={(v) => patchAllocation(a.id, { enabled: v })} />
                        فعال
                      </label>

                      <label className="flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] px-3 py-2 text-xs">
                        <Switch checked={a.default_for_reseller} onCheckedChange={(v) => patchAllocation(a.id, { default_for_reseller: v })} />
                        پیش‌فرض
                      </label>
                    </div>

                    <div className="flex min-w-0 gap-2">
                      <Input
                        type="number"
                        value={priceDrafts[a.id] ?? ""}
                        placeholder="قیمت override"
                        onChange={(e) => setPriceDrafts((prev) => ({ ...prev, [a.id]: e.target.value === "" ? "" : Number(e.target.value) }))}
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        title="ذخیره قیمت"
                        onClick={() =>
                          patchAllocation(a.id, {
                            price_per_gb_override: priceDrafts[a.id] === "" || priceDrafts[a.id] == null ? null : Number(priceDrafts[a.id]),
                          })
                        }
                      >
                        <Pencil size={14} />
                      </Button>
                    </div>

                    <div className="flex justify-end">
                      <Button type="button" size="sm" variant="outline" className="text-red-600" title="حذف تخصیص" onClick={() => setConfirmDelete(a)}>
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-3 border-t border-[hsl(var(--border))] pt-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
                    {renderCredentialEditor(
                      credentialDrafts[a.id] || credentialDraftFromAllocation(a),
                      (patch) => updateAllocationDraft(a.id, patch),
                      a.panel_type
                    )}
                    <div className="flex flex-wrap gap-2 xl:max-w-[260px]">
                      <Button type="button" variant="outline" size="sm" onClick={() => saveAllocationCredentials(a)} disabled={credentialBusy === a.id}>
                        <Pencil size={14} />
                        {t("common.save")}
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => testAllocation(a)} disabled={credentialBusy === a.id}>
                        <PlugZap size={14} />
                        {t("common.test")}
                      </Button>
                      {isImportSupported(a.panel_type) ? (
                        <>
                          <Button type="button" variant="outline" size="sm" onClick={() => importAllocationUsers(a, true)} disabled={credentialBusy === a.id}>
                            <Database size={14} />
                            {t("common.preview")}
                          </Button>
                          <Button type="button" variant="outline" size="sm" onClick={() => importAllocationUsers(a, false)} disabled={credentialBusy === a.id}>
                            <UploadCloud size={14} />
                            {t("common.import")}
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}

              {!selectedGroup.allocations.length ? (
                <div className="rounded-xl border border-[hsl(var(--border))] p-4 text-sm text-[hsl(var(--fg))]/70">هنوز نودی به این حساب تخصیص داده نشده است.</div>
              ) : null}
            </div>
          </div>
        ) : null}
      </Modal>

      <ConfirmModal
        open={!!confirmDelete}
        onClose={() => (busy ? null : setConfirmDelete(null))}
        title={t("common.areYouSure")}
        body={confirmDelete ? `تخصیص ${confirmDelete.node_name} از این حساب حذف می‌شود.` : t("common.thisActionCannotBeUndone")}
        confirmText={t("common.delete")}
        cancelText={t("common.cancel")}
        danger
        busy={busy}
        onConfirm={async () => {
          if (!confirmDelete) return;
          setBusy(true);
          try {
            await deleteAllocation(confirmDelete);
          } finally {
            setBusy(false);
            setConfirmDelete(null);
          }
        }}
      />
    </div>
  );
}
