"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { copyText } from "@/lib/copy";
import { fmtNumber } from "@/lib/format";
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
import { ArrowLeft, Copy, Download, RefreshCcw } from "lucide-react";

type UserOut = { id: number; label: string; total_gb: number; used_bytes: number; expire_at: string; status: string };
type LinksResp = {
  user_id: number;
  master_link: string;
  node_links: Array<{
    node_id: number;
    node_name?: string;
    panel_type?: string;
    direct_url?: string;
    full_url?: string;
    config_download_url?: string;
    status: string;
    detail?: string;
  }>;
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
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) return u;
  const b = (baseUrl || "").trim();
  if (!b) return u;
  let origin = b;
  try {
    const parsed = new URL(b);
    origin = parsed.origin;
  } catch {
    const m = b.match(/^(https?:\/\/[^/]+)/i);
    if (m) origin = m[1];
  }
  const uu = u.startsWith("/") ? u : `/${u}`;
  return `${origin.replace(/\/+$/, "")}${uu}`;
}

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const parsedUserId = Number(id);
  const userId = Number.isFinite(parsedUserId) ? parsedUserId : 0;
  const hasValidUserId = Number.isInteger(parsedUserId) && parsedUserId > 0;
  const r = useRouter();
  const { me, refresh: refreshMe } = useAuth();
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
    if (!hasValidUserId) {
      setErr("شناسه کاربر نامعتبر است.");
      setUser(null);
      setLinks(null);
      setLoading(false);
      return;
    }
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

      const u = await apiFetch<UserOut>(`/api/v1/reseller/users/${userId}`);
      setUser(u || null);
      const lr = await apiFetch<LinksResp>(`/api/v1/reseller/users/${userId}/links?refresh=true`);
      setLinks(lr);
    } catch (e: any) {
      setErr(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }

  async function copyAll() {
    if (!links) return;
    const lines: string[] = [];
    if (links.master_link) lines.push(`MASTER: ${links.master_link}`);
    for (const nl of links.node_links || []) {
      const meta = nodeMap.get(nl.node_id);
      const title = meta?.name ? `${meta.name} (#${nl.node_id})` : `Node #${nl.node_id}`;
      const full = nl.config_download_url
        ? nl.config_download_url
        : nl.full_url
        ? nl.full_url
        : nl.direct_url
        ? normalizeUrl(nl.direct_url, meta?.base_url)
        : "";
      if (!full) continue;
      lines.push(`${title}: ${full}`);
    }
    const ok = await copyText(lines.join("\n"));
    push({ title: ok ? t("common.copied") : t("common.failed"), desc: ok ? t("user.links.copiedAll") : undefined, type: ok ? "success" : "error" });
  }

  const nodeMap = React.useMemo(() => {
    const m = new Map<number, NodeLite>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  }, [nodes]);

  React.useEffect(() => {
    if (!hasValidUserId) {
      setErr("شناسه کاربر نامعتبر است.");
      setLoading(false);
      return;
    }
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, hasValidUserId]);

  async function op(path: string, body: any) {
    setBusy(true);
    try {
      const res = await apiFetch<OpResult>(path, { method: "POST", body: JSON.stringify(body) });
      push({ title: "OK", desc: `${t("users.balance")}: ${fmtNumber(res.new_balance)}`, type: "success" });
      await refresh();
      await refreshMe().catch(() => undefined);
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
          {t("users.balance")}: <span className="font-semibold">{fmtNumber(me?.balance ?? null)}</span>
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
                  <div className="mt-1 text-xl font-semibold break-all leading-relaxed">{user ? user.label : `#${userId}`}</div>
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
                      <div className="mt-1 text-base font-semibold">{fmtNumber(user.total_gb)} GB</div>
                    </div>
                    <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3">
                      <div className="text-xs text-[hsl(var(--fg))]/70">{t("user.used")}</div>
                      <div className="mt-1 text-base font-semibold">{new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(usedGb)} GB</div>
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
                        <span className="font-semibold">{new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(usedGb)}</span> / {fmtNumber(user.total_gb)} GB ({percent}%)
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
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="text-xl font-semibold">{t("user.links")}</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" className="gap-2" disabled={!links} onClick={copyAll}>
                    <Copy size={16} /> {t("user.links.copyAll")}
                  </Button>
                </div>
              </div>
              <div className="text-sm text-[hsl(var(--fg))]/70">{t("users.links")} — {t("user.links.master")} / {t("user.links.panel")}</div>
              <div className="text-xs text-[hsl(var(--fg))]/60">پیشنهاد: برای مصرف روزمره، لینک مستقیم پنل را استفاده کنید.</div>
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
                    <div className="text-xs text-[hsl(var(--fg))]/70">{t("user.links.master")}</div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Input value={links.master_link} readOnly />
                      <Button
                        type="button"
                        variant="outline"
                        className="gap-2 sm:w-[170px]"
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
                      {links.node_links.map((n) => {
                        const meta = nodeMap.get(n.node_id);
                        const nodeTitle = (meta?.name || n.node_name) ? `${meta?.name || n.node_name} (#${n.node_id})` : `Node #${n.node_id}`;
                        const isWg = (n.panel_type || "").toLowerCase() === "wg_dashboard";
                        const full = n.config_download_url
                          ? n.config_download_url
                          : n.full_url
                          ? n.full_url
                          : n.direct_url
                          ? normalizeUrl(n.direct_url, meta?.base_url)
                          : "";
                        return (
                          <div key={n.node_id} className="rounded-2xl border border-[hsl(var(--border))] p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="text-xs text-[hsl(var(--fg))]/70">{nodeTitle}</div>
                              <Badge variant={n.status === "ok" ? "success" : n.status === "missing" ? "warning" : "danger"}>{n.status}</Badge>
                            </div>
                            {full ? (
                              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                                <Input value={full} readOnly />
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="gap-2 sm:w-[150px]"
                                  onClick={() => {
                                    copyText(full).then((ok) => {
                                      push({ title: ok ? t("common.copied") : t("common.failed"), type: ok ? "success" : "error" });
                                    });
                                  }}
                                >
                                  <Copy size={16} /> {t("common.copy")}
                                </Button>
                                {isWg ? (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="gap-2 sm:w-[170px]"
                                    onClick={() => {
                                      window.open(full, "_blank", "noopener,noreferrer");
                                    }}
                                  >
                                    <Download size={16} /> دانلود .conf
                                  </Button>
                                ) : null}
                              </div>
                            ) : (
                              <div className="mt-2 text-xs text-[hsl(var(--fg))]/70">{n.detail || t("users.noLink")}</div>
                            )}
                          </div>
                        );
                      })}
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
