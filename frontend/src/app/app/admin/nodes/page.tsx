"use client";

import * as React from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { HelpTip } from "@/components/ui/help-tip";
import { useI18n } from "@/components/i18n-context";

type NodeOut = {
  id: number;
  name: string;
  panel_type: string;
  base_url: string;
  credentials: Record<string, any>;
  tags: string[];
  is_enabled: boolean;
  is_visible_in_sub: boolean;
};

export default function AdminNodesPage() {
  const { push } = useToast();
  const { t } = useI18n();
  const [nodes, setNodes] = React.useState<NodeOut[]>([]);

  const [editingId, setEditingId] = React.useState<number | null>(null);
  const [name, setName] = React.useState("");
  const [panelType, setPanelType] = React.useState("marzban");
  const [baseUrl, setBaseUrl] = React.useState("");
  const [tags, setTags] = React.useState("");
  const [creds, setCreds] = React.useState('{"username":"admin","password":"pass"}');
  const [enabled, setEnabled] = React.useState(true);
  const [visibleInSub, setVisibleInSub] = React.useState(true);
  const [q, setQ] = React.useState("");

  function resetForm() {
    setEditingId(null);
    setName("");
    setPanelType("marzban");
    setBaseUrl("");
    setTags("");
    setCreds('{"username":"admin","password":"pass"}');
    setEnabled(true);
    setVisibleInSub(true);
  }

  function parseCreds(): any {
    try {
      return JSON.parse(creds || "{}") || {};
    } catch {
      throw new Error(t("adminNodes.credsInvalid"));
    }
  }

  async function createOrSave() {
    try {
      const payload = {
        name,
        panel_type: panelType,
        base_url: baseUrl,
        credentials: parseCreds(),
        tags: tags ? tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
        is_enabled: enabled,
        is_visible_in_sub: visibleInSub,
      };

      if (editingId == null) {
        const res = await apiFetch<NodeOut>("/api/v1/admin/nodes", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        push({ title: t("adminNodes.created"), desc: `ID: ${res.id}`, type: "success" });
        setNodes((p) => [res, ...p]);
        resetForm();
      } else {
        const res = await apiFetch<NodeOut>(`/api/v1/admin/nodes/${editingId}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        push({ title: t("adminNodes.saved"), desc: `ID: ${res.id}`, type: "success" });
        await load();
        resetForm();
      }
    } catch (e: any) {
      push({ title: t("common.error"), desc: String(e.message || e), type: "error" });
    }
  }

  async function load() {
    try {
      const res = await apiFetch<NodeOut[]>("/api/v1/admin/nodes");
      setNodes(res);
    } catch (e: any) {
      push({ title: t("common.error"), desc: String(e.message || e), type: "error" });
    }
  }

  async function test(id: number) {
    try {
      const res = await apiFetch<any>(`/api/v1/admin/nodes/${id}/test-connection`, { method: "POST" });
      push({ title: res.ok ? "OK" : "FAIL", desc: res.detail, type: res.ok ? "success" : "error" });
    } catch (e: any) {
      push({ title: t("common.error"), desc: String(e.message || e), type: "error" });
    }
  }

  async function disable(id: number) {
    try {
      const res = await apiFetch<any>(`/api/v1/admin/nodes/${id}`, { method: "DELETE" });
      push({ title: t("adminNodes.disabled"), desc: `enabled=${res.is_enabled}`, type: "success" });
      await load();
    } catch (e: any) {
      push({ title: t("common.error"), desc: String(e.message || e), type: "error" });
    }
  }

  async function toggle(id: number, patch: Partial<NodeOut>) {
    try {
      await apiFetch<NodeOut>(`/api/v1/admin/nodes/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      await load();
    } catch (e: any) {
      push({ title: t("common.error"), desc: String(e.message || e), type: "error" });
    }
  }

  function startEdit(n: NodeOut) {
    setEditingId(n.id);
    setName(n.name);
    setPanelType(n.panel_type);
    setBaseUrl(n.base_url);
    setTags((n.tags || []).join(","));
    setCreds(JSON.stringify(n.credentials || {}, null, 0) || "{}");
    setEnabled(n.is_enabled);
    setVisibleInSub(n.is_visible_in_sub);
  }

  const filtered = nodes.filter((n) => {
    const s = `${n.id} ${n.name} ${n.panel_type} ${n.base_url} ${(n.tags || []).join(" ")}`.toLowerCase();
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
          <div className="text-xl font-semibold">{t("adminNodes.title")}</div>
          <div className="text-sm text-[hsl(var(--fg))]/70">{t("adminNodes.subtitle")}</div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm flex items-center gap-2">
                {t("adminNodes.name")} <HelpTip text={t("adminNodes.help.name")} />
              </label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <label className="text-sm flex items-center gap-2">
                {t("adminNodes.panelType")} <HelpTip text={t("adminNodes.help.panelType")} />
              </label>
              <select
                className="w-full rounded-xl border border-[hsl(var(--border))] bg-transparent px-3 py-2 text-sm"
                value={panelType}
                onChange={(e) => setPanelType(e.target.value)}
              >
                <option value="marzban">marzban</option>
                <option value="pasarguard">pasarguard</option>
                <option value="wg_dashboard">wg_dashboard</option>
              </select>
            </div>
            <div className="space-y-2 md:col-span-2">
              <label className="text-sm flex items-center gap-2">
                {t("adminNodes.baseUrl")} <HelpTip text={t("adminNodes.help.baseUrl")} />
              </label>
              <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://panel.example.com" />
            </div>
            <div className="space-y-2">
              <label className="text-sm flex items-center gap-2">
                {t("adminNodes.tags")} <HelpTip text={t("adminNodes.help.tags")} />
              </label>
              <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="group tags: DEFAULT_POOL,VIP_POOL" />
            </div>
            <div className="space-y-2">
              <label className="text-sm flex items-center gap-2">
                {t("adminNodes.credentials")} <HelpTip text={t("adminNodes.help.credentials")} />
              </label>
              <textarea
                className="w-full min-h-[42px] rounded-xl border border-[hsl(var(--border))] bg-transparent px-3 py-2 text-sm"
                value={creds}
                onChange={(e) => setCreds(e.target.value)}
                spellCheck={false}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm">{t("adminNodes.enabled")}</label>
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                <span>{enabled ? t("common.yes") : t("common.no")}</span>
              </label>
            </div>
            <div className="space-y-2">
              <label className="text-sm">{t("adminNodes.visibleInSub")}</label>
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" checked={visibleInSub} onChange={(e) => setVisibleInSub(e.target.checked)} />
                <span>{visibleInSub ? t("common.yes") : t("common.no")}</span>
              </label>
            </div>
          </div>

          <div className="flex gap-2">
            <Button type="button" onClick={createOrSave}>{editingId == null ? t("adminNodes.create") : t("adminNodes.save")}</Button>
            <Button type="button" variant="outline" onClick={load}>{t("common.reload")}</Button>
            {editingId != null ? (
              <Button type="button" variant="outline" onClick={resetForm}>{t("common.cancel")}</Button>
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
                  <th className="text-right py-2">Name</th>
                  <th className="text-right py-2">Type</th>
                  <th className="text-right py-2">Enabled</th>
                  <th className="text-right py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((n) => (
                  <tr key={n.id} className="border-b border-[hsl(var(--border))]">
                    <td className="py-2">{n.id}</td>
                    <td className="py-2">{n.name}</td>
                    <td className="py-2">{n.panel_type}</td>
                    <td className="py-2">
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={n.is_enabled}
                          onChange={(e) => toggle(n.id, { is_enabled: e.target.checked } as any)}
                        />
                        <span>{n.is_enabled ? t("common.yes") : t("common.no")}</span>
                      </label>
                      <div className="text-xs text-[hsl(var(--fg))]/60">
                        {t("adminNodes.visibleInSub")}: {n.is_visible_in_sub ? t("common.yes") : t("common.no")}
                      </div>
                      <button
                        type="button"
                        className="text-xs underline text-[hsl(var(--fg))]/80 hover:text-[hsl(var(--fg))]"
                        onClick={() => toggle(n.id, { is_visible_in_sub: !n.is_visible_in_sub } as any)}
                      >
                        {t("adminNodes.toggleVisible")}
                      </button>
                    </td>
                    <td className="py-2 flex flex-wrap gap-2">
                      <Button type="button" variant="outline" onClick={() => test(n.id)}>{t("adminNodes.test")}</Button>
                      <Button type="button" variant="outline" onClick={() => startEdit(n)}>{t("common.edit")}</Button>
                      <Button type="button" variant="outline" onClick={() => disable(n.id)}>{t("adminNodes.disable")}</Button>
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
