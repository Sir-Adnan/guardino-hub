"use client";

import * as React from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Menu } from "@/components/ui/menu";
import { ConfirmModal } from "@/components/ui/confirm";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { HelpTip } from "@/components/ui/help-tip";
import { useI18n } from "@/components/i18n-context";
import { MoreHorizontal, Pencil, Trash2, Wallet, Power } from "lucide-react";

type ResellerOut = {
  id: number;
  parent_id?: number | null;
  username: string;
  status: string;
  balance: number;
  price_per_gb: number;
  bundle_price_per_gb?: number | null;
  price_per_day?: number | null;
  can_create_subreseller?: boolean;
};

type NodeOut = {
  id: number;
  name: string;
  panel_type: string;
  base_url: string;
  is_enabled: boolean;
};

function statusBadgeVariant(s: string): "success" | "danger" | "muted" | "warning" {
  if (s === "active") return "success";
  if (s === "disabled") return "danger";
  if (s === "deleted") return "muted";
  return "warning";
}

export default function AdminResellersPage() {
  const { push } = useToast();
  const { t } = useI18n();

  const [items, setItems] = React.useState<ResellerOut[]>([]);
  const [q, setQ] = React.useState("");

  const [editingId, setEditingId] = React.useState<number | null>(null);
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [parentId, setParentId] = React.useState<number | "">("");
  const [priceGb, setPriceGb] = React.useState<number>(0);
  const [bundleGb, setBundleGb] = React.useState<number>(0);
  const [priceDay, setPriceDay] = React.useState<number>(0);
  const [canCreateSub, setCanCreateSub] = React.useState(true);
  const [assignAllNodes, setAssignAllNodes] = React.useState(true);

  const [creditId, setCreditId] = React.useState<number | "">("");
  const [creditQuery, setCreditQuery] = React.useState("");
  const [creditAmount, setCreditAmount] = React.useState<number>(10000);

  const [confirmDelete, setConfirmDelete] = React.useState<ResellerOut | null>(null);
  const [confirmToggleStatus, setConfirmToggleStatus] = React.useState<{ r: ResellerOut; to: "active" | "disabled" } | null>(null);
  const [busy, setBusy] = React.useState(false);

  function resetForm() {
    setEditingId(null);
    setUsername("");
    setPassword("");
    setParentId("");
    setPriceGb(0);
    setBundleGb(0);
    setPriceDay(0);
    setCanCreateSub(true);
    setAssignAllNodes(true);
  }

  async function load() {
    try {
      const res = await apiFetch<ResellerOut[]>("/api/v1/admin/resellers");
      setItems(res || []);
    } catch (e: any) {
      push({ title: t("common.error"), desc: String(e.message || e), type: "error" });
    }
  }


async function assignAllNodesForReseller(resellerId: number) {
  // Best-effort: allocate all enabled nodes to this reseller for immediate usability.
  const nodes = await apiFetch<NodeOut[]>("/api/v1/admin/nodes");
  const enabled = (nodes || []).filter((n) => n.is_enabled);
  await Promise.all(
    enabled.map((n) =>
      apiFetch("/api/v1/admin/allocations", {
        method: "POST",
        body: JSON.stringify({
          reseller_id: resellerId,
          node_id: n.id,
          enabled: true,
          default_for_reseller: true,
          price_per_gb_override: null,
        }),
      }).catch(() => null)
    )
  );
}

  async function createOrSave() {
    try {
      if (editingId == null) {
        if (!username || username.length < 3) throw new Error(t("adminResellers.errUsername"));
        if (!password || password.length < 6) throw new Error(t("adminResellers.errPassword"));
        const res = await apiFetch<ResellerOut>("/api/v1/admin/resellers", {
          method: "POST",
          body: JSON.stringify({
            username,
            password,
            parent_id: parentId === "" ? null : Number(parentId),
            price_per_gb: Number(priceGb) || 0,
            bundle_price_per_gb: Number(bundleGb) || 0,
            price_per_day: Number(priceDay) || 0,
            can_create_subreseller: canCreateSub,
          }),
        });
        push({ title: t("adminResellers.created"), desc: `ID: ${res.id}`, type: "success" });
        if (assignAllNodes) {
          try {
            await assignAllNodesForReseller(res.id);
            push({ title: t("adminResellers.assignedAllNodes"), desc: t("adminResellers.assignedAllNodesDesc"), type: "success" });
          } catch {
            push({ title: t("common.warn"), desc: t("adminResellers.assignAllNodesWarn"), type: "warning" });
          }
        }
        setItems((p) => [res, ...p]);
        resetForm();
      } else {
        const res = await apiFetch<ResellerOut>(`/api/v1/admin/resellers/${editingId}`, {
          method: "PATCH",
          body: JSON.stringify({
            parent_id: parentId === "" ? null : Number(parentId),
            password: password ? password : null,
            price_per_gb: Number(priceGb),
            bundle_price_per_gb: Number(bundleGb),
            price_per_day: Number(priceDay),
            can_create_subreseller: canCreateSub,
          }),
        });
        push({ title: t("adminResellers.saved"), desc: `ID: ${res.id}`, type: "success" });
        await load();
        resetForm();
      }
    } catch (e: any) {
      push({ title: t("common.error"), desc: String(e.message || e), type: "error" });
    }
  }

  function startEdit(x: ResellerOut) {
    setEditingId(x.id);
    setUsername(x.username);
    setPassword("");
    setParentId(x.parent_id ?? "");
    setPriceGb(x.price_per_gb ?? 0);
    setBundleGb((x.bundle_price_per_gb ?? 0) as number);
    setPriceDay((x.price_per_day ?? 0) as number);
    setCanCreateSub(x.can_create_subreseller ?? true);
  }

  async function toggleStatus(x: ResellerOut, next: "active" | "disabled") {
    try {
      await apiFetch<ResellerOut>(`/api/v1/admin/resellers/${x.id}/set-status`, {
        method: "POST",
        body: JSON.stringify({ status: next }),
      });
      push({
        title: next === "active" ? t("adminResellers.enabledOk") : t("adminResellers.disabledOk"),
        desc: `${x.username} (#${x.id})`,
        type: next === "active" ? "success" : "warning",
      });
      await load();
    } catch (e: any) {
      push({ title: t("common.error"), desc: String(e.message || e), type: "error" });
    }
  }

  async function del(x: ResellerOut) {
    try {
      await apiFetch<ResellerOut>(`/api/v1/admin/resellers/${x.id}`, { method: "DELETE" });
      push({ title: t("adminResellers.deleted"), desc: x.username, type: "success" });
      await load();
    } catch (e: any) {
      push({ title: t("common.error"), desc: String(e.message || e), type: "error" });
    }
  }

  async function credit() {
    try {
      if (creditId === "") throw new Error(t("adminResellers.errCreditId"));
      const res = await apiFetch<any>(`/api/v1/admin/resellers/${Number(creditId)}/credit`, {
        method: "POST",
        body: JSON.stringify({ amount: Number(creditAmount) || 0, reason: "manual_credit" }),
      });
      push({ title: t("adminResellers.credited"), desc: `balance=${res.balance}`, type: "success" });
      await load();
    } catch (e: any) {
      push({ title: t("common.error"), desc: String(e.message || e), type: "error" });
    }
  }

  const filtered = items.filter((x) => {
    const s = `${x.id} ${x.username} ${x.status} ${x.balance}`.toLowerCase();
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
          <div className="text-xl font-semibold">{t("adminResellers.title")}</div>
          <div className="text-sm text-[hsl(var(--fg))]/70">{t("adminResellers.subtitle")}</div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm flex items-center gap-2">
                {t("adminResellers.username")} <HelpTip text={t("adminResellers.help.username")} />
              </label>
              <Input value={username} onChange={(e) => setUsername(e.target.value)} disabled={editingId != null} />
            </div>
            <div className="space-y-2">
              <label className="text-sm flex items-center gap-2">
                {editingId == null ? t("adminResellers.password") : t("adminResellers.passwordOptional")} <HelpTip text={t("adminResellers.help.password")} />
              </label>
              <Input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder={editingId == null ? "******" : "(optional)"} />
            </div>

            <div className="space-y-2">
              <label className="text-sm flex items-center gap-2">
                {t("adminResellers.parentId")} <HelpTip text={t("adminResellers.help.parentId")} />
              </label>
              <Input value={parentId} onChange={(e) => setParentId(e.target.value === "" ? "" : Number(e.target.value))} type="number" placeholder="(optional)" />
            </div>

            <div className="space-y-2">
              <label className="text-sm flex items-center gap-2">
                {t("adminResellers.canCreateSub")} <HelpTip text={t("adminResellers.help.canCreateSub")} />
              </label>
              <div className="flex items-center gap-2">
                <Switch checked={canCreateSub} onCheckedChange={setCanCreateSub} />
                <span className="text-sm text-[hsl(var(--fg))]/75">{canCreateSub ? t("common.yes") : t("common.no")}</span>
              </div>
            </div>

{editingId == null && (
  <div className="space-y-2">
    <label className="text-sm flex items-center gap-2">
      {t("adminResellers.assignAllNodes")} <HelpTip text={t("adminResellers.help.assignAllNodes")} />
    </label>
    <div className="flex items-center gap-2">
      <Switch checked={assignAllNodes} onCheckedChange={setAssignAllNodes} />
      <span className="text-sm text-[hsl(var(--fg))]/75">{assignAllNodes ? t("common.yes") : t("common.no")}</span>
    </div>
  </div>
)}

<div className="space-y-2 md:col-span-2">
              <label className="text-sm flex items-center gap-2">
                {t("adminResellers.pricing")} <HelpTip text={t("adminResellers.help.pricing")} />
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
  <div className="space-y-1">
    <div className="text-xs text-[hsl(var(--fg))]/70 flex items-center gap-2">
      {t("adminResellers.pricePerGb")} <HelpTip text={t("adminResellers.help.pricePerGb")} />
    </div>
    <Input type="number" value={priceGb} onChange={(e) => setPriceGb(Number(e.target.value))} />
  </div>
  <div className="space-y-1">
    <div className="text-xs text-[hsl(var(--fg))]/70 flex items-center gap-2">
      {t("adminResellers.bundlePerGb")} <HelpTip text={t("adminResellers.help.bundlePerGb")} />
    </div>
    <Input type="number" value={bundleGb} onChange={(e) => setBundleGb(Number(e.target.value))} />
  </div>
  <div className="space-y-1">
    <div className="text-xs text-[hsl(var(--fg))]/70 flex items-center gap-2">
      {t("adminResellers.pricePerDay")} <HelpTip text={t("adminResellers.help.pricePerDay")} />
    </div>
    <Input type="number" value={priceDay} onChange={(e) => setPriceDay(Number(e.target.value))} />
  </div>
</div>
<div className="text-xs text-[hsl(var(--fg))]/70">{t("adminResellers.pricingNote")}</div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={createOrSave}>
              {editingId == null ? t("adminResellers.create") : t("adminResellers.save")}
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

          <Card>
            <CardHeader>
              <div className="text-sm font-medium">{t("adminResellers.creditTitle")}</div>
              <div className="text-xs text-[hsl(var(--fg))]/70">{t("adminResellers.creditSubtitle")}</div>
            </CardHeader>
            <CardContent className="grid gap-2 md:grid-cols-4">
  <div className="md:col-span-2 grid gap-2 sm:grid-cols-2">
    <Input
      placeholder={t("common.search")}
      value={creditQuery}
      onChange={(e) => setCreditQuery(e.target.value)}
    />
    <select
      className="h-10 rounded-xl border border-[hsl(var(--border))] bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
      value={creditId}
      onChange={(e) => setCreditId(e.target.value === "" ? "" : Number(e.target.value))}
    >
      <option value="">{t("adminResellers.selectReseller")}</option>
      {items
        .filter((r) => `${r.id} ${r.username}`.toLowerCase().includes(creditQuery.toLowerCase()))
        .slice(0, 200)
        .map((r) => (
          <option key={r.id} value={r.id}>
            {r.username} (#{r.id}) — {new Intl.NumberFormat().format(r.balance)}
          </option>
        ))}
    </select>
  </div>
  <Input
    placeholder={t("adminResellers.amount")}
    type="number"
    value={creditAmount}
    onChange={(e) => setCreditAmount(Number(e.target.value))}
  />
  <Button type="button" variant="outline" onClick={credit}>
    {t("adminResellers.credit")}
  </Button>
</CardContent>
          </Card>

          <div className="flex items-center gap-2">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("common.search")} />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[hsl(var(--fg))]/70">
                <tr className="border-b border-[hsl(var(--border))]">
                  <th className="text-[start] py-2">ID</th>
                  <th className="text-[start] py-2">{t("adminResellers.username")}</th>
                  <th className="text-[start] py-2">{t("adminResellers.status")}</th>
                  <th className="text-[start] py-2">{t("adminResellers.balance")}</th>
                  <th className="text-[start] py-2">{t("adminResellers.pricePerGb")}</th>
                  <th className="text-[start] py-2">{t("adminResellers.bundlePerGb")}</th>
                  <th className="text-[start] py-2">{t("adminResellers.pricePerDay")}</th>
                  <th className="text-[end] py-2">{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((x) => (
                  <tr key={x.id} className="border-b border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/40">
                    <td className="py-2">{x.id}</td>
                    <td className="py-2">
                      <div className="font-medium">{x.username}</div>
                      {x.parent_id ? <div className="text-xs text-[hsl(var(--fg))]/60">parent: #{x.parent_id}</div> : null}
                    </td>
                    <td className="py-2">
                      <div className="flex items-center gap-3">
                        <Badge variant={statusBadgeVariant(x.status)}>{x.status}</Badge>
                        <Switch
                          checked={x.status === "active"}
                          onCheckedChange={() => toggleStatus(x)}
                          disabled={x.status === "deleted"}
                        />
                      </div>
                    </td>
                    <td className="py-2">{x.balance}</td>
                    <td className="py-2">{x.price_per_gb}</td>
                    <td className="py-2">{x.bundle_price_per_gb ?? 0}</td>
                    <td className="py-2">{x.price_per_day ?? 0}</td>
                    <td className="py-2 text-[end]">
                      <Menu
                        trigger={
                          <Button variant="ghost" className="px-2" title={t("common.actions")}>
                            <MoreHorizontal size={18} />
                          </Button>
                        }
                        items={[
                          { label: t("common.edit"), icon: <Pencil size={16} />, onClick: () => startEdit(x) },
                          {
                            label: t("adminResellers.pickForCredit"),
                            icon: <Wallet size={16} />,
                            onClick: () => {
                              setCreditId(x.id);
                              push({ title: t("adminResellers.creditHint"), desc: `${x.username} (#${x.id})`, type: "success" });
                            },
                          },
                          x.status !== "deleted"
                            ? {
                                label: x.status === "active" ? t("common.disable") : t("common.enable"),
                                icon: <Power size={16} />,
                                onClick: () =>
                                  setConfirmToggleStatus({ r: x, to: x.status === "active" ? "disabled" : "active" }),
                              }
                            : { label: t("adminResellers.toggleStatus"), icon: <Power size={16} />, onClick: () => {} , disabled: true },
                          { label: t("common.delete"), icon: <Trash2 size={16} />, onClick: () => setConfirmDelete(x), danger: true },
                        ]}
                      />
                    </td>
                  </tr>
                ))}

                {!filtered.length ? (
                  <tr>
                    <td className="py-3 text-[hsl(var(--fg))]/70" colSpan={8}>
                      {t("common.empty")}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      
      <ConfirmModal
        open={!!confirmToggleStatus}
        onClose={() => (busy ? null : setConfirmToggleStatus(null))}
        title={t("adminResellers.toggleStatus")}
        body={t("adminResellers.toggleStatusDesc")}
        confirmText={confirmToggleStatus?.to === "active" ? t("common.enable") : t("common.disable")}
        cancelText={t("common.cancel")}
        danger={confirmToggleStatus?.to === "disabled"}
        busy={busy}
        onConfirm={async () => {
          if (!confirmToggleStatus) return;
          setBusy(true);
          try {
            await toggleStatus(confirmToggleStatus.r, confirmToggleStatus.to);
          } finally {
            setBusy(false);
            setConfirmToggleStatus(null);
          }
        }}
      />
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
