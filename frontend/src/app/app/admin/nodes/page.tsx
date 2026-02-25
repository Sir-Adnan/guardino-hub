"use client";

import * as React from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Menu } from "@/components/ui/menu";
import { ConfirmModal } from "@/components/ui/confirm";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { HelpTip } from "@/components/ui/help-tip";
import { useI18n } from "@/components/i18n-context";
import { Pagination } from "@/components/ui/pagination";
import { MoreHorizontal, Pencil, PlugZap, Power } from "lucide-react";

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
type NodeList = { items: NodeOut[]; total: number };

export default function AdminNodesPage() {
  const { push } = useToast();
  const { t } = useI18n();
  const [nodes, setNodes] = React.useState<NodeOut[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(50);

  const [editingId, setEditingId] = React.useState<number | null>(null);
  const [name, setName] = React.useState("");
  const [panelType, setPanelType] = React.useState("marzban");
  const [baseUrl, setBaseUrl] = React.useState("");
  const [tags, setTags] = React.useState("");
  const [creds, setCreds] = React.useState('{"username":"admin","password":"pass"}');
  const [enabled, setEnabled] = React.useState(true);
  const [visibleInSub, setVisibleInSub] = React.useState(true);
  const [q, setQ] = React.useState("");

  const [confirmDisable, setConfirmDisable] = React.useState<NodeOut | null>(null);
  const [busy, setBusy] = React.useState(false);

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
        tags: tags ? tags.split(",").map((x) => x.trim()).filter(Boolean) : [],
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
      const offset = (page - 1) * pageSize;
      const res = await apiFetch<NodeList>(`/api/v1/admin/nodes?offset=${offset}&limit=${pageSize}`);
      setNodes(res.items || []);
      setTotal(res.total || 0);
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
    setCreds(JSON.stringify(n.credentials || {}, null, 2) || "{}");
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
  }, [page, pageSize]);

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
              <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="DEFAULT_POOL,VIP_POOL" />
            </div>
            <div className="space-y-2">
              <label className="text-sm flex items-center gap-2">
                {t("adminNodes.credentials")} <HelpTip text={t("adminNodes.help.credentials")} />
              </label>
              <textarea
                className="w-full min-h-[90px] rounded-xl border border-[hsl(var(--border))] bg-transparent px-3 py-2 text-sm"
                value={creds}
                onChange={(e) => setCreds(e.target.value)}
                spellCheck={false}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm flex items-center gap-2">{t("adminNodes.enabled")} <HelpTip text={t("adminNodes.help.enabled")} /></label>
              <div className="flex items-center gap-2">
                <Switch checked={enabled} onCheckedChange={setEnabled} />
                <span className="text-sm text-[hsl(var(--fg))]/75">{enabled ? t("common.yes") : t("common.no")}</span>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm flex items-center gap-2">{t("adminNodes.visibleInSub")} <HelpTip text={t("adminNodes.help.visibleInSub")} /></label>
              <div className="flex items-center gap-2">
                <Switch checked={visibleInSub} onCheckedChange={setVisibleInSub} />
                <span className="text-sm text-[hsl(var(--fg))]/75">{visibleInSub ? t("common.yes") : t("common.no")}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={createOrSave}>
              {editingId == null ? t("adminNodes.create") : t("adminNodes.save")}
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
                  <th className="text-[start] py-2">{t("adminNodes.name")}</th>
                  <th className="text-[start] py-2">{t("adminNodes.panelType")}</th>
                  <th className="text-[start] py-2">{t("adminNodes.tags")}</th>
                  <th className="text-[start] py-2">{t("adminNodes.enabled")}</th>
                  <th className="text-[start] py-2">{t("adminNodes.visibleInSub")}</th>
                  <th className="text-[end] py-2">{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((n) => (
                  <tr key={n.id} className="border-b border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/40">
                    <td className="py-2">{n.id}</td>
                    <td className="py-2">
                      <div className="font-medium">{n.name}</div>
                      <div className="text-xs text-[hsl(var(--fg))]/60 truncate max-w-[420px]">{n.base_url}</div>
                    </td>
                    <td className="py-2">{n.panel_type}</td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-1">
                        {(n.tags || []).slice(0, 3).map((tg) => (
                          <Badge key={tg} variant="muted">{tg}</Badge>
                        ))}
                        {(n.tags || []).length > 3 ? (
                          <Badge variant="muted">+{(n.tags || []).length - 3}</Badge>
                        ) : null}
                      </div>
                    </td>
                    <td className="py-2">
                      <Switch checked={n.is_enabled} onCheckedChange={(v) => toggle(n.id, { is_enabled: v } as any)} />
                    </td>
                    <td className="py-2">
                      <Switch checked={n.is_visible_in_sub} onCheckedChange={(v) => toggle(n.id, { is_visible_in_sub: v } as any)} />
                    </td>
                    <td className="py-2 text-[end]">
                      <Menu
                        trigger={
                          <Button variant="ghost" className="px-2" title={t("common.actions")}>
                            <MoreHorizontal size={18} />
                          </Button>
                        }
                        items={[
                          { label: t("adminNodes.test"), icon: <PlugZap size={16} />, onClick: () => test(n.id) },
                          { label: t("common.edit"), icon: <Pencil size={16} />, onClick: () => startEdit(n) },
                          n.is_enabled
                            ? { label: t("common.disable"), icon: <Power size={16} />, onClick: () => setConfirmDisable(n), danger: true }
                            : { label: t("common.enable"), icon: <Power size={16} />, onClick: () => toggle(n.id, { is_enabled: true } as any) },
                        ]}
                      />
                    </td>
                  </tr>
                ))}

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
        open={!!confirmDisable}
        onClose={() => (busy ? null : setConfirmDisable(null))}
        title={t("common.areYouSure")}
        body={t("common.thisActionCannotBeUndone")}
        confirmText={t("common.disable")}
        cancelText={t("common.cancel")}
        danger
        busy={busy}
        onConfirm={async () => {
          if (!confirmDisable) return;
          setBusy(true);
          try {
            await disable(confirmDisable.id);
          } finally {
            setBusy(false);
            setConfirmDisable(null);
          }
        }}
      />
    </div>
  );
}
