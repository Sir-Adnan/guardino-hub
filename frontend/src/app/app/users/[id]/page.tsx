"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { copyText } from "@/lib/copy";
import { useAuth } from "@/components/auth-context";
import { useI18n } from "@/components/i18n-context";
import { useToast } from "@/components/ui/toast";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Modal } from "@/components/ui/modal";
import { HelpTip } from "@/components/ui/help-tip";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Copy, RefreshCcw } from "lucide-react";

type UserOut = { id: number; label: string; total_gb: number; used_bytes: number; expire_at: string; status: string };
type UsersPage = { items: UserOut[]; total: number };
type LinksResp = {
  user_id: number;
  master_link: string;
  node_links: Array<{ node_id: number; direct_url?: string; status: string; detail?: string }>;
};

type OpResult = { ok: boolean; charged_amount: number; refunded_amount: number; new_balance: number; user_id: number; detail?: string };

function bytesToGb(bytes: number) {
  return bytes / (1024 * 1024 * 1024);
}
function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

function statusBadge(status: string) {
  const s = (status || "").toLowerCase();
  if (s === "active") return { v: "success" as const, label: "Active" };
  if (s === "disabled") return { v: "muted" as const, label: "Disabled" };
  if (s === "expired") return { v: "danger" as const, label: "Expired" };
  return { v: "default" as const, label: status || "—" };
}

type NodeLite = { id: number; name: string; base_url: string };

function normalizeUrl(maybeUrl: string, baseUrl?: string) {
  const u = (maybeUrl || "").trim();
  if (!u) return u;
  if (/^https?:\/\//i.test(u)) return u;
  const b = (baseUrl || "").trim();
  if (!b) return u;
  const bb = b.replace(/\/+$/, "");
  const uu = u.startsWith("/") ? u : `/${u}`;
  return `${bb}${uu}`;
}

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const userId = Number(id);
  const r = useRouter();
  const { me } = useAuth();
  const { t } = useI18n();
  const { push } = useToast();
  const locked = (me?.balance ?? 1) <= 0;

  const [user, setUser] = React.useState<UserOut | null>(null);
  const [links, setLinks] = React.useState<LinksResp | null>(null);
  const [nodes, setNodes] = React.useState<NodeLite[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState<string | null>(null);

  const [busy, setBusy] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [confirmKind, setConfirmKind] = React.useState<"reset" | "revoke" | null>(null);

  const [extendDays, setExtendDays] = React.useState(30);
  const [addGb, setAddGb] = React.useState(10);
  const [decreaseGb, setDecreaseGb] = React.useState(5);

  async function refresh() {
    setErr(null);
    setLoading(true);
    try {
      // Load nodes meta for nicer labels + URL normalization.
      // Not critical; if it fails, the page still works.
      try {
        const nodesRes: any = me?.role === "admin" ? await apiFetch<any[]>("/api/v1/admin/nodes") : await apiFetch<any>("/api/v1/reseller/nodes");
        const arr = Array.isArray(nodesRes) ? nodesRes : (nodesRes?.items || []);
        setNodes(arr.map((n: any) => ({ id: n.id, name: n.name, base_url: n.base_url })));
      } catch {
        // ignore
      }

      const up = await apiFetch<UsersPage>("/api/v1/reseller/users");
      const u = up.items.find((x) => x.id === userId) || null;
      setUser(u);
      const lr = await apiFetch<LinksResp>(`/api/v1/reseller/users/${userId}/links?refresh=true`);
      setLinks(lr);
    } catch (e: any) {
      setErr(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }

  const nodeMap = React.useMemo(() => {
    const m = new Map<number, NodeLite>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  }, [nodes]);

  React.useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function op(path: string, body: any) {
    setBusy(true);
    try {
      const res = await apiFetch<OpResult>(path, { method: "POST", body: JSON.stringify(body) });
      push({ title: "OK", desc: `${t("users.balance")}: ${res.new_balance}`, type: "success" });
      await refresh();
    } catch (e: any) {
      push({ title: t("common.error"), desc: String(e.message || e), type: "error" });
    } finally {
      setBusy(false);
    }
  }

  function ask(kind: "reset" | "revoke") {
    setConfirmKind(kind);
    setConfirmOpen(true);
  }

  async function doConfirm() {
    setConfirmOpen(false);
    if (confirmKind === "reset") await op(`/api/v1/reseller/users/${userId}/reset-usage`, {});
    if (confirmKind === "revoke") await op(`/api/v1/reseller/users/${userId}/revoke`, {});
  }

  const sb = statusBadge(user?.status || "");
  const totalBytes = (user?.total_gb || 0) * 1024 * 1024 * 1024;
  const pct = totalBytes > 0 ? clamp01((user?.used_bytes || 0) / totalBytes) : 0;
  const percent = Math.round(pct * 100);
  const usedGb = bytesToGb(user?.used_bytes || 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => r.push("/app/users")}
            className="gap-2">
            <ArrowLeft size={16} /> {t("user.back")}
          </Button>
          <Button variant="outline" onClick={refresh} disabled={busy} className="gap-2">
            <RefreshCcw size={16} /> {t("user.refresh")}
          </Button>
          <Button variant="ghost" onClick={() => r.push("/app/users/new")}>{t("user.new")}</Button>
        </div>

        <div className="text-xs text-[hsl(var(--fg))]/70">
          {t("users.balance")}: <span className="font-semibold">{me?.balance ?? "—"}</span>
        </div>
      </div>

      {locked ? (
        <div className="text-xs rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))] p-3">
          {t("users.balanceZero")}
        </div>
      ) : null}
      {err ? <div className="text-sm text-red-500">{err}</div> : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs text-[hsl(var(--fg))]/70">{t("user.title")}</div>
                  <div className="mt-1 text-xl font-semibold truncate">{user ? user.label : `#${userId}`}</div>
                </div>
                <div className="flex items-center gap-2">
                  {loading ? <Skeleton className="h-6 w-20" /> : <Badge variant={sb.v}>{sb.label}</Badge>}
                  {!loading && user ? (
                    (user.status || "").toLowerCase() === "active" ? (
                      <Button variant="outline" disabled={locked || busy} onClick={() => op(`/api/v1/reseller/users/${userId}/set-status`, { status: "disabled" })}>
                        {t("user.disable")}
                      </Button>
                    ) : (
                      <Button disabled={locked || busy} onClick={() => op(`/api/v1/reseller/users/${userId}/set-status`, { status: "active" })}>
                        {t("user.enable")}
                      </Button>
                    )
                  ) : null}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {loading ? (
                <div className="space-y-3">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-8 w-full" />
                </div>
              ) : user ? (
                <>
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3">
                      <div className="text-xs text-[hsl(var(--fg))]/70">{t("user.total")}</div>
                      <div className="mt-1 text-base font-semibold">{user.total_gb} GB</div>
                    </div>
                    <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3">
                      <div className="text-xs text-[hsl(var(--fg))]/70">{t("user.used")}</div>
                      <div className="mt-1 text-base font-semibold">{usedGb.toFixed(1)} GB</div>
                    </div>
                    <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3">
                      <div className="text-xs text-[hsl(var(--fg))]/70">{t("user.expiresAt")}</div>
                      <div className="mt-1 text-sm font-semibold">{new Date(user.expire_at).toLocaleString()}</div>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs text-[hsl(var(--fg))]/70">
                      <div>{t("users.usage")}</div>
                      <div>
                        <span className="font-semibold">{usedGb.toFixed(1)}</span> / {user.total_gb} GB ({percent}%)
                      </div>
                    </div>
                    <Progress value={percent} />
                  </div>
                </>
              ) : (
                <div className="text-sm text-[hsl(var(--fg))]/70">{t("common.loading")}</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <div className="text-xl font-semibold">{t("user.links")}</div>
              </div>
              <div className="text-sm text-[hsl(var(--fg))]/70">{t("users.links")} — {t("user.links.master")} / {t("user.links.panel")}</div>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              {loading ? (
                <div className="space-y-3">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-24 w-full" />
                </div>
              ) : links ? (
                <>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 font-semibold">
                      {t("user.links.master")}
                    </div>
                    <div className="flex gap-2">
                      <Input value={links.master_link} readOnly />
                      <Button
                        type="button"
                        variant="outline"
                        className="gap-2"
                        onClick={() => {
                          copyText(links.master_link).then((ok) => {
                            push({ title: ok ? t("common.copied") : t("common.failed"), type: ok ? "success" : "error" });
                          });
                        }}
                      >
                        <Copy size={16} /> {t("common.copy")}
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="font-semibold">{t("user.links.panel")}</div>
                    <div className="space-y-2">
                      {links.node_links.map((n) => (
                        <div key={n.node_id} className="rounded-2xl border border-[hsl(var(--border))] p-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-xs text-[hsl(var(--fg))]/70">
                              {nodeMap.get(n.node_id)?.name ? `${nodeMap.get(n.node_id)!.name} (#${n.node_id})` : `Node #${n.node_id}`}
                            </div>
                            <Badge variant={n.status === "ok" ? "success" : n.status === "missing" ? "warning" : "danger"}>{n.status}</Badge>
                          </div>
                          {n.direct_url ? (
                            <div className="mt-2 flex flex-col gap-2">
                              <Input value={normalizeUrl(n.direct_url, nodeMap.get(n.node_id)?.base_url)} readOnly />
                              <div>
                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={() => {
                                    const u = normalizeUrl(n.direct_url!, nodeMap.get(n.node_id)?.base_url);
                                    copyText(u).then((ok) => {
                                      push({ title: ok ? t("common.copied") : t("common.failed"), type: ok ? "success" : "error" });
                                    });
                                  }}
                                >
                                  {t("common.copy")}
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <div className="mt-2 text-xs text-[hsl(var(--fg))]/70">{n.detail || t("users.noLink")}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-sm text-[hsl(var(--fg))]/70">{t("common.loading")}</div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <div className="text-xl font-semibold">{t("user.operations")}</div>
                <HelpTip text={t("user.help.revoke")} />
              </div>
              <div className="text-sm text-[hsl(var(--fg))]/70">{t("user.actions")}</div>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="rounded-2xl border border-[hsl(var(--border))] p-3 space-y-2">
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" disabled={locked || busy} onClick={() => ask("reset")}>{t("user.resetUsage")}</Button>
                  <Button variant="outline" disabled={locked || busy} onClick={() => ask("revoke")}>{t("user.revoke")}</Button>
                </div>
              </div>

              <div className="rounded-2xl border border-[hsl(var(--border))] p-3 space-y-2">
                <div className="font-medium">{t("user.extend")}</div>
                <div className="flex gap-2">
                  <Input type="number" value={extendDays} onChange={(e) => setExtendDays(Number(e.target.value))} />
                  <Button disabled={locked || busy} onClick={() => op(`/api/v1/reseller/users/${userId}/extend`, { days: extendDays })}>{t("user.extend")}</Button>
                </div>
              </div>

              <div className="rounded-2xl border border-[hsl(var(--border))] p-3 space-y-2">
                <div className="font-medium">{t("user.addTraffic")}</div>
                <div className="flex gap-2">
                  <Input type="number" value={addGb} onChange={(e) => setAddGb(Number(e.target.value))} />
                  <Button disabled={locked || busy} onClick={() => op(`/api/v1/reseller/users/${userId}/add-traffic`, { add_gb: addGb })}>{t("user.addTraffic")}</Button>
                </div>
              </div>

              <div className="rounded-2xl border border-[hsl(var(--border))] p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="font-medium">{t("user.refundDecrease")}</div>
                  <HelpTip text={t("user.help.refund")} />
                </div>
                <div className="flex gap-2">
                  <Input type="number" value={decreaseGb} onChange={(e) => setDecreaseGb(Number(e.target.value))} />
                  <Button variant="outline" disabled={locked || busy} onClick={() => op(`/api/v1/reseller/users/${userId}/refund`, { action: "decrease", decrease_gb: decreaseGb })}>
                    {t("user.refundDecrease")}
                  </Button>
                </div>
              </div>

              <div className="rounded-2xl border border-[hsl(var(--border))] p-3 space-y-2">
                <div className="font-medium">{t("user.deleteRefund")}</div>
                <div className="text-xs text-[hsl(var(--fg))]/70">{t("user.deleteRefundHint")}</div>
                <Button variant="outline" disabled={locked || busy} onClick={() => op(`/api/v1/reseller/users/${userId}/refund`, { action: "delete" })}>
                  {t("user.deleteRefund")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={confirmKind === "reset" ? t("user.confirmResetTitle") : t("user.confirmRevokeTitle")}
      >
        <div className="space-y-4">
          <div className="text-sm text-[hsl(var(--fg))]/80">
            {confirmKind === "reset" ? t("user.confirmResetBody") : t("user.confirmRevokeBody")}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>{t("common.cancel")}</Button>
            <Button disabled={busy} onClick={doConfirm}>{t("common.confirm")}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
