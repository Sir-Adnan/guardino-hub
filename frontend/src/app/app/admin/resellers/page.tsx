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
import { MoreHorizontal } from "lucide-react";

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

  const [creditId, setCreditId] = React.useState<number | "">("");
  const [creditAmount, setCreditAmount] = React.useState<number>(10000);

  const [confirmDelete, setConfirmDelete] = React.useState<ResellerOut | null>(null);
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
  }

  async function load() {
    try {
      const res = await apiFetch<ResellerOut[]>("/api/v1/admin/resellers");
      setItems(res || []);
    } catch (e: any) {
      push({ title: t("common.error"), desc: String(e.message || e), type: "error" });
    }
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

  async function toggleStatus(x: ResellerOut) {
    try {
      const next = x.status === "active" ? "disabled" : "active";
      await apiFetch<ResellerOut>(`/api/v1/admin/resellers/${x.id}/set-status`, {
        method: "POST",
        body: JSON.stringify({ status: next }),
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

            <div className="space-y-2 md:col-span-2">
              <label className="text-sm flex items-center gap-2">
                {t("adminResellers.pricing")} <HelpTip text={t("adminResellers.help.pricing")} />
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <Input placeholder={t("adminResellers.pricePerGb")} type="number" value={priceGb} onChange={(e) => setPriceGb(Number(e.target.value))} />
                <Input placeholder={t("adminResellers.bundlePerGb")} type="number" value={bundleGb} onChange={(e) => setBundleGb(Number(e.target.value))} />
                <Input placeholder={t("adminResellers.pricePerDay")} type="number" value={priceDay} onChange={(e) => setPriceDay(Number(e.target.value))} />
              </div>
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
            <CardContent className="grid gap-2 md:grid-cols-3">
              <Input
                placeholder={t("adminResellers.resellerId")}
                type="number"
                value={creditId}
                onChange={(e) => setCreditId(e.target.value === "" ? "" : Number(e.target.value))}
              />
              <Input placeholder={t("adminResellers.amount")} type="number" value={creditAmount} onChange={(e) => setCreditAmount(Number(e.target.value))} />
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
                          { label: t("common.edit"), onClick: () => startEdit(x) },
                          {
                            label: t("adminResellers.pickForCredit"),
                            onClick: () => {
                              setCreditId(x.id);
                              push({ title: t("adminResellers.creditHint"), desc: `${x.username} (#${x.id})`, type: "success" });
                            },
                          },
                          { label: t("common.delete"), onClick: () => setConfirmDelete(x), danger: true },
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
