"use client";

import * as React from "react";
import { Activity, Link2, Pencil, Plus, ShieldCheck, Trash2, UsersRound } from "lucide-react";
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
  reseller_status: string;
  allocations: GroupedAllocationItem[];
  nodes: NodeOut[];
  active_panels_count: number;
};
type GroupedAllocationList = { items: ResellerAllocationGroup[]; total: number };

const ADMIN_FETCH_LIMIT = 200;

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
  const [priceDrafts, setPriceDrafts] = React.useState<Record<number, number | "">>({});
  const [confirmDelete, setConfirmDelete] = React.useState<GroupedAllocationItem | null>(null);
  const [busy, setBusy] = React.useState(false);
  const initialDeepLinkHandled = React.useRef(false);

  const selectedGroup = React.useMemo(
    () => groups.find((g) => g.reseller_id === selectedResellerId) || null,
    [groups, selectedResellerId]
  );

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
    setBusy(true);
    try {
      await apiFetch<AllocationOut>("/api/v1/admin/allocations", {
        method: "POST",
        body: JSON.stringify({
          reseller_id: selectedGroup.reseller_id,
          node_id: Number(addNodeId),
          enabled: addEnabled,
          default_for_reseller: addDefault,
          price_per_gb_override: addPriceOverride === "" ? null : Number(addPriceOverride),
        }),
      });
      push({ title: t("adminAllocations.created"), type: "success" });
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
    selectedGroup.allocations.forEach((a) => {
      drafts[a.id] = a.price_per_gb_override == null ? "" : a.price_per_gb_override;
    });
    setPriceDrafts(drafts);
    resetAddForm();
  }, [selectedGroup?.reseller_id, selectedGroup?.allocations.length]);

  const selectClass =
    "w-full rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(155deg,hsl(var(--surface-input-1))_0%,hsl(var(--surface-input-2))_58%,hsl(var(--surface-input-3))_100%)] px-3 py-2 text-sm outline-none transition-all duration-200 hover:border-[hsl(var(--accent)/0.35)] focus:ring-2 focus:ring-[hsl(var(--accent)/0.35)]";
  const metricCardClass =
    "rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(155deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] p-3 shadow-[0_10px_22px_-20px_hsl(var(--fg)/0.6)]";

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
            <p className="mt-1 text-sm text-[hsl(var(--fg))]/70">نمای رسیلر محور برای مدیریت نودها، پنل‌ها و قیمت‌های اختصاصی.</p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(130deg,hsl(var(--accent)/0.16),hsl(var(--surface-card-1)))] px-3 py-2 text-xs font-medium text-[hsl(var(--fg))]/80">
            <Activity size={14} />
            {fmtNumber(total)} رسیلر
          </div>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className={metricCardClass}>
          <div className="flex items-center justify-between">
            <div className="text-xs text-[hsl(var(--fg))]/70">رسیلرهای دارای تخصیص</div>
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
          <div className="text-xl font-semibold">تخصیص‌ها بر اساس رسیلر</div>
          <div className="text-sm text-[hsl(var(--fg))]/70">هر رسیلر فقط یک بار نمایش داده می‌شود و نودهای مرتبط داخل همان کارت دیده می‌شوند.</div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(130deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] p-2">
            <Input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              placeholder="جستجوی رسیلر، ID یا نام کاربری"
            />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            {groups.map((group) => {
              const activeNodes = group.allocations.filter((a) => a.enabled && a.node_is_enabled).length;
              return (
                <article key={group.reseller_id} className="rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(155deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] p-4 shadow-[0_12px_26px_-22px_hsl(var(--fg)/0.5)]">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-base font-semibold">{group.reseller_name}</h2>
                        <Badge variant={statusVariant(group.reseller_status)}>{group.reseller_status}</Badge>
                      </div>
                      <div className="mt-1 text-xs text-[hsl(var(--fg))]/65">#{group.reseller_id}</div>
                    </div>
                    <Button type="button" size="sm" variant="outline" onClick={() => setSelectedResellerId(group.reseller_id)}>
                      مدیریت تخصیص‌ها
                    </Button>
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                    <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] p-2">
                      <div className="text-[hsl(var(--fg))]/60">نودها</div>
                      <div className="mt-1 font-semibold">{fmtNumber(group.allocations.length)}</div>
                    </div>
                    <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] p-2">
                      <div className="text-[hsl(var(--fg))]/60">فعال</div>
                      <div className="mt-1 font-semibold text-emerald-600">{fmtNumber(activeNodes)}</div>
                    </div>
                    <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] p-2">
                      <div className="text-[hsl(var(--fg))]/60">پنل‌ها</div>
                      <div className="mt-1 font-semibold">{fmtNumber(group.active_panels_count)}</div>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {group.allocations.slice(0, 8).map((a) => (
                      <Badge key={a.id} variant={allocationVariant(a)}>
                        {a.node_name} · {a.panel_type}
                      </Badge>
                    ))}
                    {group.allocations.length > 8 ? <Badge variant="muted">+{fmtNumber(group.allocations.length - 8)}</Badge> : null}
                    {!group.allocations.length ? <Badge variant="muted">بدون تخصیص</Badge> : null}
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
        title={selectedGroup ? `مدیریت تخصیص‌ها - ${selectedGroup.reseller_name}` : "مدیریت تخصیص‌ها"}
        className="max-w-5xl"
      >
        {selectedGroup ? (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] p-3">
                <div className="text-xs text-[hsl(var(--fg))]/60">رسیلر</div>
                <div className="mt-1 truncate text-sm font-semibold">{selectedGroup.reseller_name}</div>
              </div>
              <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] p-3">
                <div className="text-xs text-[hsl(var(--fg))]/60">تعداد نود</div>
                <div className="mt-1 text-sm font-semibold">{fmtNumber(selectedGroup.allocations.length)}</div>
              </div>
              <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] p-3">
                <div className="text-xs text-[hsl(var(--fg))]/60">پنل فعال</div>
                <div className="mt-1 text-sm font-semibold">{fmtNumber(selectedGroup.active_panels_count)}</div>
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
              <div className="grid gap-3 md:grid-cols-[1.5fr,1fr,auto,auto,auto] md:items-end">
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
                <label className="flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] px-3 py-2 text-xs">
                  <Switch checked={addEnabled} onCheckedChange={setAddEnabled} />
                  فعال
                </label>
                <label className="flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] px-3 py-2 text-xs">
                  <Switch checked={addDefault} onCheckedChange={setAddDefault} />
                  پیش‌فرض
                </label>
                <Button type="button" onClick={addAllocation} disabled={busy || addNodeId === ""}>
                  افزودن
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              {selectedGroup.allocations.map((a) => (
                <div key={a.id} className="rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(155deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] p-3">
                  <div className="grid gap-3 lg:grid-cols-[1.4fr,0.8fr,auto,auto,1fr,auto] lg:items-center">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="truncate text-sm font-semibold">{a.node_name}</div>
                        <Badge variant={a.node_is_enabled ? "default" : "danger"}>{a.node_is_enabled ? "node enabled" : "node disabled"}</Badge>
                        <Badge variant={a.enabled ? "success" : "muted"}>{a.enabled ? "allocation enabled" : "allocation disabled"}</Badge>
                      </div>
                      <div className="mt-1 text-xs text-[hsl(var(--fg))]/65">{a.panel_type} · node #{a.node_id} · allocation #{a.id}</div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {a.default_for_reseller ? <Badge variant="warning">پیش‌فرض</Badge> : <Badge variant="muted">غیر پیش‌فرض</Badge>}
                      {a.price_per_gb_override != null ? <Badge variant="default">{fmtNumber(a.price_per_gb_override)}/GB</Badge> : null}
                    </div>

                    <label className="flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] px-3 py-2 text-xs">
                      <Switch checked={a.enabled} onCheckedChange={(v) => patchAllocation(a.id, { enabled: v })} />
                      فعال
                    </label>

                    <label className="flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] px-3 py-2 text-xs">
                      <Switch checked={a.default_for_reseller} onCheckedChange={(v) => patchAllocation(a.id, { default_for_reseller: v })} />
                      پیش‌فرض
                    </label>

                    <div className="flex gap-2">
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
                        onClick={() =>
                          patchAllocation(a.id, {
                            price_per_gb_override: priceDrafts[a.id] === "" || priceDrafts[a.id] == null ? null : Number(priceDrafts[a.id]),
                          })
                        }
                      >
                        <Pencil size={14} />
                      </Button>
                    </div>

                    <Button type="button" size="sm" variant="outline" className="text-red-600" onClick={() => setConfirmDelete(a)}>
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </div>
              ))}

              {!selectedGroup.allocations.length ? (
                <div className="rounded-xl border border-[hsl(var(--border))] p-4 text-sm text-[hsl(var(--fg))]/70">هنوز نودی به این رسیلر تخصیص داده نشده است.</div>
              ) : null}
            </div>
          </div>
        ) : null}
      </Modal>

      <ConfirmModal
        open={!!confirmDelete}
        onClose={() => (busy ? null : setConfirmDelete(null))}
        title={t("common.areYouSure")}
        body={confirmDelete ? `تخصیص ${confirmDelete.node_name} از این رسیلر حذف می‌شود.` : t("common.thisActionCannotBeUndone")}
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
