"use client";

import * as React from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/ui/toast";

type AllocationOut = { id: number; reseller_id: number; node_id: number; enabled: boolean; default_for_reseller: boolean; price_per_gb_override?: number | null };
type NodeOut = { id: number; name: string; panel_type: string; is_enabled: boolean };

export default function AllocationsPage() {
  const { push } = useToast();
  const [resellerId, setResellerId] = React.useState<number>(0);
  const [nodeId, setNodeId] = React.useState<number>(0);
  const [priceOverride, setPriceOverride] = React.useState<number>(0);
  const [enabled, setEnabled] = React.useState(true);
  const [def, setDef] = React.useState(false);

  const [nodes, setNodes] = React.useState<NodeOut[]>([]);
  const [created, setCreated] = React.useState<AllocationOut[]>([]);

  async function loadNodes() {
    try {
      const res = await apiFetch<any[]>("/api/v1/admin/nodes");
      setNodes(res.map((n) => ({ id: n.id, name: n.name, panel_type: n.panel_type, is_enabled: n.is_enabled })));
    } catch (e: any) {
      push({ title: "Error", desc: String(e.message || e), type: "error" });
    }
  }

  async function create() {
    try {
      const res = await apiFetch<AllocationOut>("/api/v1/admin/allocations", {
        method: "POST",
        body: JSON.stringify({
          reseller_id: resellerId,
          node_id: nodeId,
          enabled,
          default_for_reseller: def,
          price_per_gb_override: priceOverride > 0 ? priceOverride : null,
        }),
      });
      push({ title: "Allocation created", desc: `ID: ${res.id}`, type: "success" });
      setCreated((p) => [res, ...p]);
    } catch (e: any) {
      push({ title: "Error", desc: String(e.message || e), type: "error" });
    }
  }

  React.useEffect(() => {
    loadNodes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="text-xl font-semibold">Admin: Allocations</div>
          <div className="text-sm text-[hsl(var(--fg))]/70">تخصیص نود به نماینده + قیمت اختصاصی + نود پیش‌فرض</div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm">Reseller ID</label>
              <Input type="number" value={resellerId} onChange={(e) => setResellerId(Number(e.target.value))} />
            </div>
            <div className="space-y-2">
              <label className="text-sm">Node ID</label>
              <Input type="number" value={nodeId} onChange={(e) => setNodeId(Number(e.target.value))} />
              <div className="text-xs text-[hsl(var(--fg))]/70">راحت‌تر: از لیست پایین Node ID را کپی کن.</div>
            </div>

            <div className="space-y-2">
              <label className="text-sm">Price Override / GB (اختیاری)</label>
              <Input type="number" value={priceOverride} onChange={(e) => setPriceOverride(Number(e.target.value))} />
            </div>
            <div className="space-y-2">
              <label className="text-sm">Flags</label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                enabled
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={def} onChange={(e) => setDef(e.target.checked)} />
                default_for_reseller
              </label>
            </div>
          </div>

          <div className="flex gap-2">
            <Button type="button" onClick={create}>Create Allocation</Button>
            <Button type="button" variant="outline" onClick={loadNodes}>Reload Nodes</Button>
          </div>

          <Card>
            <CardHeader>
              <div className="text-sm text-[hsl(var(--fg))]/70">Nodes</div>
              <div className="text-lg font-semibold">لیست نودها</div>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-[hsl(var(--fg))]/70">
                  <tr className="border-b border-[hsl(var(--border))]">
                    <th className="text-right py-2">ID</th>
                    <th className="text-right py-2">Name</th>
                    <th className="text-right py-2">Type</th>
                    <th className="text-right py-2">Enabled</th>
                  </tr>
                </thead>
                <tbody>
                  {nodes.map((n) => (
                    <tr key={n.id} className="border-b border-[hsl(var(--border))]">
                      <td className="py-2">{n.id}</td>
                      <td className="py-2">{n.name}</td>
                      <td className="py-2">{n.panel_type}</td>
                      <td className="py-2">{n.is_enabled ? "yes" : "no"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {created.length ? (
            <Card>
              <CardHeader>
                <div className="text-sm text-[hsl(var(--fg))]/70">Created allocations (this session)</div>
                <div className="text-lg font-semibold">تخصیص‌های ساخته‌شده</div>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-[hsl(var(--fg))]/70">
                    <tr className="border-b border-[hsl(var(--border))]">
                      <th className="text-right py-2">ID</th>
                      <th className="text-right py-2">Reseller</th>
                      <th className="text-right py-2">Node</th>
                      <th className="text-right py-2">Default</th>
                      <th className="text-right py-2">Override</th>
                    </tr>
                  </thead>
                  <tbody>
                    {created.map((a) => (
                      <tr key={a.id} className="border-b border-[hsl(var(--border))]">
                        <td className="py-2">{a.id}</td>
                        <td className="py-2">{a.reseller_id}</td>
                        <td className="py-2">{a.node_id}</td>
                        <td className="py-2">{a.default_for_reseller ? "yes" : "no"}</td>
                        <td className="py-2">{a.price_per_gb_override ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
