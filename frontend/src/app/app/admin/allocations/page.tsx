"use client";

import * as React from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { HelpTip } from "@/components/ui/help-tip";
import { useI18n } from "@/components/i18n-context";

type AllocationOut = {
  id: number;
  reseller_id: number;
  node_id: number;
  enabled: boolean;
  default_for_reseller: boolean;
  price_per_gb_override?: number | null;
};

type NodeOut = { id: number; name: string; panel_type: string; is_enabled: boolean };

type ResellerOut = { id: number; username: string; status: string };

export default function AllocationsPage() {
  const { push } = useToast();
  const { t } = useI18n();

  const [nodes, setNodes] = React.useState<NodeOut[]>([]);
  const [resellers, setResellers] = React.useState<ResellerOut[]>([]);
  const [items, setItems] = React.useState<AllocationOut[]>([]);

  const [editingId, setEditingId] = React.useState<number | null>(null);
  const [resellerId, setResellerId] = React.useState<number | "">("");
  const [nodeId, setNodeId] = React.useState<number | "">("");
  const [priceOverride, setPriceOverride] = React.useState<number | "">("");
  const [enabled, setEnabled] = React.useState(true);
  const [def, setDef] = React.useState(false);
  const [q, setQ] = React.useState("");

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
    setPriceOverride("");
    setEnabled(true);
    setDef(false);
  }

  async function load() {
    try {
      const [nodesRes, resellersRes, allocationsRes] = await Promise.all([
        apiFetch<any[]>("/api/v1/admin/nodes"),
        apiFetch<any[]>("/api/v1/admin/resellers"),
        apiFetch<AllocationOut[]>("/api/v1/admin/allocations"),
      ]);

      setNodes((nodesRes || []).map((n) => ({ id: n.id, name: n.name, panel_type: n.panel_type, is_enabled: n.is_enabled })));
      setResellers((resellersRes || []).map((r) => ({ id: r.id, username: r.username, status: r.status })));
      setItems(allocationsRes || []);
    } catch (e: any) {
      push({ title: t("common.error"), desc: String(e.message || e), type: "error" });
    }
  }

  async function createOrSave() {
    try {
      if (resellerId === "" || nodeId === "") throw new Error(t("adminAllocations.errSelect"));

      const payload = {
        enabled,
        default_for_reseller: def,
        price_per_gb_override: priceOverride === "" ? null : Number(priceOverride),
      };

      if (editingId == null) {
        const res = await apiFetch<AllocationOut>("/api/v1/admin/allocations", {
          method: "POST",
          body: JSON.stringify({ reseller_id: Number(resellerId), node_id: Number(nodeId), ...payload }),
        });
        push({ title: t("adminAllocations.created"), desc: `ID: ${res.id}`, type: "success" });
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
    }
  }

  function startEdit(a: AllocationOut) {
    setEditingId(a.id);
    setResellerId(a.reseller_id);
    setNodeId(a.node_id);
    setEnabled(a.enabled);
    setDef(a.default_for_reseller);
    setPriceOverride(a.price_per_gb_override == null ? "" : a.price_per_gb_override);
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
  }, []);

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
              <select
                className="w-full rounded-xl border border-[hsl(var(--border))] bg-transparent px-3 py-2 text-sm"
                value={nodeId}
                onChange={(e) => setNodeId(e.target.value === "" ? "" : Number(e.target.value))}
              >
                <option value="">--</option>
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name} ({n.panel_type}) (#{n.id})
                  </option>
                ))}
              </select>
              <div className="text-xs text-[hsl(var(--fg))]/70">{t("adminAllocations.nodeHint")}</div>
            </div>

            <div className="space-y-2">
              <label className="text-sm flex items-center gap-2">
                {t("adminAllocations.priceOverride")} <HelpTip text={t("adminAllocations.help.priceOverride")} />
              </label>
              <Input type="number" value={priceOverride} onChange={(e) => setPriceOverride(e.target.value === "" ? "" : Number(e.target.value))} />
            </div>

            <div className="space-y-2">
              <label className="text-sm">{t("adminAllocations.flags")}</label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                <span>{t("adminAllocations.enabled")}</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={def} onChange={(e) => setDef(e.target.checked)} />
                <span>{t("adminAllocations.default")}</span>
              </label>
            </div>
          </div>

          <div className="flex gap-2">
            <Button type="button" onClick={createOrSave}>
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
                  <th className="text-right py-2">ID</th>
                  <th className="text-right py-2">{t("adminAllocations.reseller")}</th>
                  <th className="text-right py-2">{t("adminAllocations.node")}</th>
                  <th className="text-right py-2">{t("adminAllocations.enabled")}</th>
                  <th className="text-right py-2">{t("adminAllocations.default")}</th>
                  <th className="text-right py-2">{t("adminAllocations.priceOverride")}</th>
                  <th className="text-right py-2">{t("adminAllocations.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((a) => {
                  const r = resellerMap.get(a.reseller_id);
                  const n = nodeMap.get(a.node_id);
                  return (
                    <tr key={a.id} className="border-b border-[hsl(var(--border))]">
                      <td className="py-2">{a.id}</td>
                      <td className="py-2">{r ? `${r.username} (#${a.reseller_id})` : a.reseller_id}</td>
                      <td className="py-2">{n ? `${n.name} (${n.panel_type}) (#${a.node_id})` : a.node_id}</td>
                      <td className="py-2">{a.enabled ? t("common.yes") : t("common.no")}</td>
                      <td className="py-2">{a.default_for_reseller ? t("common.yes") : t("common.no")}</td>
                      <td className="py-2">{a.price_per_gb_override ?? "-"}</td>
                      <td className="py-2">
                        <div className="flex gap-2">
                          <Button type="button" variant="outline" onClick={() => startEdit(a)}>
                            {t("common.edit")}
                          </Button>
                          <Button type="button" variant="outline" onClick={() => del(a)}>
                            {t("adminAllocations.delete")}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {!filtered.length ? (
                  <tr>
                    <td className="py-3 text-[hsl(var(--fg))]/70" colSpan={7}>
                      {t("adminAllocations.empty")}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
