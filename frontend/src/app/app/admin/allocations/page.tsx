"use client";

import * as React from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Menu } from "@/components/ui/menu";
import { ConfirmModal } from "@/components/ui/confirm";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { HelpTip } from "@/components/ui/help-tip";
import { useI18n } from "@/components/i18n-context";
import { Pagination } from "@/components/ui/pagination";
import { fmtNumber } from "@/lib/format";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";

type AllocationOut = {
  id: number;
  reseller_id: number;
  node_id: number;
  enabled: boolean;
  default_for_reseller: boolean;
  price_per_gb_override?: number | null;
};
type AllocationList = { items: AllocationOut[]; total: number };

type NodeOut = { id: number; name: string; panel_type: string; is_enabled: boolean };
type NodeList = { items: NodeOut[]; total: number };

type ResellerOut = { id: number; username: string; status: string };
type ResellerList = { items: ResellerOut[]; total: number };

export default function AllocationsPage() {
  const { push } = useToast();
  const { t } = useI18n();

  const [nodes, setNodes] = React.useState<NodeOut[]>([]);
  const [resellers, setResellers] = React.useState<ResellerOut[]>([]);
  const [items, setItems] = React.useState<AllocationOut[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(50);

  const [editingId, setEditingId] = React.useState<number | null>(null);
  const [resellerId, setResellerId] = React.useState<number | "">("");
  const [nodeId, setNodeId] = React.useState<number | "">("");
  const [nodeIds, setNodeIds] = React.useState<number[]>([]);
  const [nodePickQ, setNodePickQ] = React.useState("");
  const [priceOverride, setPriceOverride] = React.useState<number | "">("");
  const [enabled, setEnabled] = React.useState(true);
  const [def, setDef] = React.useState(false);
  const [q, setQ] = React.useState("");

  const [confirmDelete, setConfirmDelete] = React.useState<AllocationOut | null>(null);
  const [busy, setBusy] = React.useState(false);

  const resellerMap = React.useMemo(() => {
    const m = new Map<number, ResellerOut>();
    for (const r of resellers) m.set(r.id, r);
    return m;
  }, [resellers]);

  const nodeMap = React.useMemo(() => {
    const m = new Map<number, NodeOut>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  }, [nodes]);

  function resetForm() {
    setEditingId(null);
    setResellerId("");
    setNodeId("");
    setNodeIds([]);
    setNodePickQ("");
    setPriceOverride("");
    setEnabled(true);
    setDef(false);
  }

  async function load() {
    try {
      const [nodesRes, resellersRes, allocationsRes] = await Promise.all([
        apiFetch<NodeList>("/api/v1/admin/nodes?offset=0&limit=500"),
        apiFetch<ResellerList>("/api/v1/admin/resellers?offset=0&limit=500"),
        apiFetch<AllocationList>(`/api/v1/admin/allocations?offset=${(page - 1) * pageSize}&limit=${pageSize}`),
      ]);

      setNodes((nodesRes.items || []).map((n) => ({ id: n.id, name: n.name, panel_type: n.panel_type, is_enabled: n.is_enabled })));
      setResellers((resellersRes.items || []).map((r) => ({ id: r.id, username: r.username, status: r.status })));
      setItems(allocationsRes.items || []);
      setTotal(allocationsRes.total || 0);
    } catch (e: any) {
      push({ title: t("common.error"), desc: String(e.message || e), type: "error" });
    }
  }

  async function patchAllocation(id: number, payload: Partial<AllocationOut>) {
    await apiFetch<AllocationOut>(`/api/v1/admin/allocations/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  }

  async function createOrSave() {
    try {
      if (resellerId === "") throw new Error(t("adminAllocations.errSelect"));

      const payload = {
        enabled,
        default_for_reseller: def,
        price_per_gb_override: priceOverride === "" ? null : Number(priceOverride),
      };

      if (editingId == null) {
        const targets = nodeIds.length ? nodeIds : (nodeId === "" ? [] : [Number(nodeId)]);
        if (!targets.length) throw new Error(t("adminAllocations.errSelect"));

        setBusy(true);
        const results = await Promise.allSettled(
          targets.map((nid) =>
            apiFetch<AllocationOut>("/api/v1/admin/allocations", {
              method: "POST",
              body: JSON.stringify({ reseller_id: Number(resellerId), node_id: Number(nid), ...payload }),
            })
          )
        );

        const ok = results.filter((r) => r.status === "fulfilled").length;
        const fail = results.length - ok;
        push({
          title: t("adminAllocations.created"),
          desc: fail ? `${ok} OK, ${fail} failed` : `${ok} OK`,
          type: fail ? "error" : "success",
        });
      } else {
        const res = await apiFetch<AllocationOut>(`/api/v1/admin/allocations/${editingId}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        push({ title: t("adminAllocations.saved"), desc: `ID: ${res.id}`, type: "success" });
      }

      await load();
      resetForm();
    } catch (e: any) {
      push({ title: t("common.error"), desc: String(e.message || e), type: "error" });
    } finally {
      setBusy(false);
    }
  }

  function startEdit(a: AllocationOut) {
    setEditingId(a.id);
    setResellerId(a.reseller_id);
    setNodeId(a.node_id);
    setNodeIds([]);
    setNodePickQ("");
    setEnabled(a.enabled);
    setDef(a.default_for_reseller);
    setPriceOverride(a.price_per_gb_override == null ? "" : a.price_per_gb_override);
  }

  const filteredPickNodes = React.useMemo(() => {
    const qq = nodePickQ.trim().toLowerCase();
    if (!qq) return nodes;
    return nodes.filter((n) => `${n.id} ${n.name} ${n.panel_type}`.toLowerCase().includes(qq));
  }, [nodes, nodePickQ]);

  const allSelected = nodes.length > 0 && nodeIds.length === nodes.length;
  function toggleAll(v: boolean) {
    setNodeIds(v ? nodes.map((n) => n.id) : []);
  }

  function toggleOne(id: number, v: boolean) {
    setNodeIds((prev) => {
      const s = new Set(prev);
      if (v) s.add(id);
      else s.delete(id);
      return Array.from(s);
    });
  }

  async function del(a: AllocationOut) {
    try {
      await apiFetch<any>(`/api/v1/admin/allocations/${a.id}`, { method: "DELETE" });
      push({ title: t("adminAllocations.deleted"), desc: `ID: ${a.id}`, type: "success" });
      await load();
    } catch (e: any) {
      push({ title: t("common.error"), desc: String(e.message || e), type: "error" });
    }
  }

  const filtered = items.filter((a) => {
    const r = resellerMap.get(a.reseller_id);
    const n = nodeMap.get(a.node_id);
    const s = `${a.id} ${a.reseller_id} ${r?.username || ""} ${a.node_id} ${n?.name || ""} ${n?.panel_type || ""}`.toLowerCase();
    return s.includes(q.toLowerCase());
  });

  React.useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="text-xl font-semibold">{t("adminAllocations.title")}</div>
          <div className="text-sm text-[hsl(var(--fg))]/70">{t("adminAllocations.subtitle")}</div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm flex items-center gap-2">
                {t("adminAllocations.reseller")} <HelpTip text={t("adminAllocations.help.reseller")} />
              </label>
              <select
                className="w-full rounded-xl border border-[hsl(var(--border))] bg-transparent px-3 py-2 text-sm"
                value={resellerId}
                onChange={(e) => setResellerId(e.target.value === "" ? "" : Number(e.target.value))}
              >
                <option value="">--</option>
                {resellers.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.username} (#{r.id})
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm flex items-center gap-2">
                {t("adminAllocations.node")} <HelpTip text={t("adminAllocations.help.node")} />
              </label>

              {editingId != null ? (
                // Edit mode: single allocation
                <>
                  <select
                    className="w-full rounded-xl border border-[hsl(var(--border))] bg-transparent px-3 py-2 text-sm"
                    value={nodeId}
                    onChange={(e) => setNodeId(e.target.value === "" ? "" : Number(e.target.value))}
                    disabled
                  >
                    <option value="">--</option>
                    {nodes.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.name} ({n.panel_type}) (#{n.id})
                      </option>
                    ))}
                  </select>
                  <div className="text-xs text-[hsl(var(--fg))]/70">{t("adminAllocations.nodeHint")}</div>
                </>
              ) : (
                // Create mode: multi-select nodes (+ all)
                <div className="space-y-2">
                  <Input value={nodePickQ} onChange={(e) => setNodePickQ(e.target.value)} placeholder={t("common.search")} />

                  <div className="rounded-2xl border border-[hsl(var(--border))] p-2 max-h-[220px] overflow-auto">
                    <label className="flex items-center justify-between gap-3 px-2 py-2 rounded-xl hover:bg-[hsl(var(--muted))]/40 cursor-pointer">
                      <div className="text-sm font-medium">{t("common.all")}</div>
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={(e) => toggleAll(e.target.checked)}
                      />
                    </label>
                    <div className="h-px bg-[hsl(var(--border))] my-1" />

                    {filteredPickNodes.map((n) => {
                      const checked = nodeIds.includes(n.id);
                      return (
                        <label
                          key={n.id}
                          className="flex items-center justify-between gap-3 px-2 py-2 rounded-xl hover:bg-[hsl(var(--muted))]/40 cursor-pointer"
                        >
                          <div className="min-w-0">
                            <div className="text-sm truncate">{n.name}</div>
                            <div className="text-xs text-[hsl(var(--fg))]/70 truncate">{n.panel_type} • #{n.id}</div>
                          </div>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => toggleOne(n.id, e.target.checked)}
                          />
                        </label>
                      );
                    })}
                  </div>

                  <div className="text-xs text-[hsl(var(--fg))]/70">
                    {t("adminAllocations.nodeHint")} • {nodeIds.length ? `${nodeIds.length} selected` : "—"}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm flex items-center gap-2">
                {t("adminAllocations.priceOverride")} <HelpTip text={t("adminAllocations.help.priceOverride")} />
              </label>
              <Input type="number" value={priceOverride} onChange={(e) => setPriceOverride(e.target.value === "" ? "" : Number(e.target.value))} />
            </div>

            <div className="space-y-2">
              <label className="text-sm">{t("adminAllocations.flags")}</label>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm text-[hsl(var(--fg))]/75">
                  <span>{t("adminAllocations.enabled")}</span>
                  <HelpTip text={t("adminAllocations.help.enabled")} />
                </div>
                <Switch checked={enabled} onCheckedChange={setEnabled} />
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm text-[hsl(var(--fg))]/75">
                  <span>{t("adminAllocations.default")}</span>
                  <HelpTip text={t("adminAllocations.help.default")} />
                </div>
                <Switch checked={def} onCheckedChange={setDef} />
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <Button type="button" onClick={createOrSave} disabled={busy}>
              {editingId == null ? t("adminAllocations.create") : t("adminAllocations.save")}
            </Button>
            <Button type="button" variant="outline" onClick={load}>
              {t("common.reload")}
            </Button>
            {editingId != null ? (
              <Button type="button" variant="outline" onClick={resetForm}>
                {t("common.cancel")}
              </Button>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("common.search")} />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[hsl(var(--fg))]/70">
                <tr className="border-b border-[hsl(var(--border))]">
                  <th className="text-[start] py-2">ID</th>
                  <th className="text-[start] py-2">{t("adminAllocations.reseller")}</th>
                  <th className="text-[start] py-2">{t("adminAllocations.node")}</th>
                  <th className="text-[start] py-2">{t("adminAllocations.enabled")}</th>
                  <th className="text-[start] py-2">{t("adminAllocations.default")}</th>
                  <th className="text-[start] py-2">{t("adminAllocations.priceOverride")}</th>
                  <th className="text-[end] py-2">{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((a) => {
                  const r = resellerMap.get(a.reseller_id);
                  const n = nodeMap.get(a.node_id);
                  return (
                    <tr key={a.id} className="border-b border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/40">
                      <td className="py-2">{a.id}</td>
                      <td className="py-2">{r ? `${r.username} (#${a.reseller_id})` : a.reseller_id}</td>
                      <td className="py-2">{n ? `${n.name} (${n.panel_type}) (#${a.node_id})` : a.node_id}</td>
                      <td className="py-2">
                        <Switch
                          checked={a.enabled}
                          onCheckedChange={async (v) => {
                            try {
                              await patchAllocation(a.id, { enabled: v });
                              await load();
                            } catch (e: any) {
                              push({ title: t("common.error"), desc: String(e.message || e), type: "error" });
                            }
                          }}
                        />
                      </td>
                      <td className="py-2">
                        <Switch
                          checked={a.default_for_reseller}
                          onCheckedChange={async (v) => {
                            try {
                              await patchAllocation(a.id, { default_for_reseller: v } as any);
                              await load();
                            } catch (e: any) {
                              push({ title: t("common.error"), desc: String(e.message || e), type: "error" });
                            }
                          }}
                        />
                      </td>
                      <td className="py-2">{a.price_per_gb_override == null ? "-" : fmtNumber(a.price_per_gb_override)}</td>
                      <td className="py-2 text-[end]">
                        <Menu
                          trigger={
                            <Button variant="ghost" className="px-2" title={t("common.actions")}>
                              <MoreHorizontal size={18} />
                            </Button>
                          }
                          items={[
                            { label: t("common.edit"), icon: <Pencil size={16} />, onClick: () => startEdit(a) },
                            { label: t("common.delete"), icon: <Trash2 size={16} />, onClick: () => setConfirmDelete(a), danger: true },
                          ]}
                        />
                      </td>
                    </tr>
                  );
                })}

                {!filtered.length ? (
                  <tr>
                    <td className="py-3 text-[hsl(var(--fg))]/70" colSpan={7}>
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
