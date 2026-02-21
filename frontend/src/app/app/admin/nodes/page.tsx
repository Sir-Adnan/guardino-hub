"use client";

import * as React from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/ui/toast";

type NodeOut = {
  id: number;
  name: string;
  panel_type: string;
  base_url: string;
  tags: string[];
  is_enabled: boolean;
  is_visible_in_sub: boolean;
};

export default function AdminNodesPage() {
  const { push } = useToast();
  const [nodes, setNodes] = React.useState<NodeOut[]>([]);

  const [name, setName] = React.useState("");
  const [panelType, setPanelType] = React.useState("marzban");
  const [baseUrl, setBaseUrl] = React.useState("");
  const [tags, setTags] = React.useState("");
  const [creds, setCreds] = React.useState('{"username":"admin","password":"pass"}');

  async function create() {
    try {
      const res = await apiFetch<NodeOut>("/api/v1/admin/nodes", {
        method: "POST",
        body: JSON.stringify({
          name,
          panel_type: panelType,
          base_url: baseUrl,
          credentials: JSON.parse(creds || "{}"),
          tags: tags ? tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
          is_enabled: true,
          is_visible_in_sub: true,
        }),
      });
      push({ title: "Node created", desc: `ID: ${res.id}`, type: "success" });
      setNodes((p) => [res, ...p]);
    } catch (e: any) {
      push({ title: "Error", desc: String(e.message || e), type: "error" });
    }
  }

  async function load() {
    try {
      const res = await apiFetch<NodeOut[]>("/api/v1/admin/nodes");
      setNodes(res);
    } catch (e: any) {
      push({ title: "Error", desc: String(e.message || e), type: "error" });
    }
  }

  async function test(id: number) {
    try {
      const res = await apiFetch<any>(`/api/v1/admin/nodes/${id}/test-connection`, { method: "POST" });
      push({ title: res.ok ? "OK" : "FAIL", desc: res.detail, type: res.ok ? "success" : "error" });
    } catch (e: any) {
      push({ title: "Error", desc: String(e.message || e), type: "error" });
    }
  }

  async function disable(id: number) {
    try {
      const res = await apiFetch<any>(`/api/v1/admin/nodes/${id}`, { method: "DELETE" });
      push({ title: "Disabled", desc: `enabled=${res.is_enabled}`, type: "success" });
      await load();
    } catch (e: any) {
      push({ title: "Error", desc: String(e.message || e), type: "error" });
    }
  }

  React.useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="text-xl font-semibold">Admin: Nodes</div>
          <div className="text-sm text-[hsl(var(--fg))]/70">افزودن نود + تست اتصال + غیرفعال‌سازی</div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm">Name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <label className="text-sm">Panel Type</label>
              <Input value={panelType} onChange={(e) => setPanelType(e.target.value)} placeholder="marzban | pasarguard | wg_dashboard" />
            </div>
            <div className="space-y-2 md:col-span-2">
              <label className="text-sm">Base URL</label>
              <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://panel.example.com" />
            </div>
            <div className="space-y-2">
              <label className="text-sm">Tags</label>
              <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="group tags: DEFAULT_POOL,VIP_POOL" />
            </div>
            <div className="space-y-2">
              <label className="text-sm">Credentials (JSON)</label>
              <Input value={creds} onChange={(e) => setCreds(e.target.value)} />
            </div>
          </div>

          <div className="flex gap-2">
            <Button type="button" onClick={create}>Create</Button>
            <Button type="button" variant="outline" onClick={load}>Reload</Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[hsl(var(--fg))]/70">
                <tr className="border-b border-[hsl(var(--border))]">
                  <th className="text-right py-2">ID</th>
                  <th className="text-right py-2">Name</th>
                  <th className="text-right py-2">Type</th>
                  <th className="text-right py-2">Enabled</th>
                  <th className="text-right py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {nodes.map((n) => (
                  <tr key={n.id} className="border-b border-[hsl(var(--border))]">
                    <td className="py-2">{n.id}</td>
                    <td className="py-2">{n.name}</td>
                    <td className="py-2">{n.panel_type}</td>
                    <td className="py-2">{n.is_enabled ? "yes" : "no"}</td>
                    <td className="py-2 flex flex-wrap gap-2">
                      <Button type="button" variant="outline" onClick={() => test(n.id)}>Test</Button>
                      <Button type="button" variant="outline" onClick={() => disable(n.id)}>Disable</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
