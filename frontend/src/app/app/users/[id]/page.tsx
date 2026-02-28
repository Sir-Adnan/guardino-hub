"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, CalendarDays, Copy, Download, Gauge, RefreshCcw, ShieldAlert, Sparkles } from "lucide-react";

import { useAuth } from "@/components/auth-context";
import { useI18n } from "@/components/i18n-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { JalaliDateTimePicker } from "@/components/ui/jalali-datetime-picker";
import { apiFetch } from "@/lib/api";
import { copyText } from "@/lib/copy";
import { fmtNumber } from "@/lib/format";
import { formatJalaliDateTime } from "@/lib/jalali";

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
type NodeLite = { id: number; name: string; base_url: string };
type OpMode = "extend" | "traffic_up" | "traffic_down" | "time_down" | "controls";
const AUTO_REFRESH_MS = 30_000;

function bytesToGb(bytes: number) {
  return bytes / (1024 * 1024 * 1024);
}

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

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

function panelLabel(panelType?: string) {
  const p = String(panelType || "").toLowerCase();
  if (p === "wg_dashboard") return "وایرگارد";
  return "لینک امن";
}

function statusMeta(raw: string) {
  const s = String(raw || "").toLowerCase();
  if (s === "active") return { variant: "success" as const, label: "فعال" };
  if (s === "disabled") return { variant: "warning" as const, label: "غیرفعال" };
  if (s === "deleted") return { variant: "danger" as const, label: "حذف‌شده" };
  return { variant: "muted" as const, label: raw || "نامشخص" };
}

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { me, refresh: refreshMe } = useAuth();
  const { t } = useI18n();
  const { push } = useToast();

  const parsedUserId = Number(id);
  const userId = Number.isFinite(parsedUserId) ? parsedUserId : 0;
  const hasValidUserId = Number.isInteger(parsedUserId) && parsedUserId > 0;
  const locked = (me?.balance ?? 1) <= 0;

  const [user, setUser] = React.useState<UserOut | null>(null);
  const [links, setLinks] = React.useState<LinksResp | null>(null);
  const [nodes, setNodes] = React.useState<NodeLite[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const [opMode, setOpMode] = React.useState<OpMode>("extend");
  const [extendDays, setExtendDays] = React.useState(30);
  const [decreaseDays, setDecreaseDays] = React.useState(7);
  const [addGb, setAddGb] = React.useState(10);
  const [decreaseGb, setDecreaseGb] = React.useState(5);
  const [targetDate, setTargetDate] = React.useState<Date | null>(null);

  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [confirmKind, setConfirmKind] = React.useState<"reset" | "revoke" | "delete" | null>(null);

  const nodeMap = React.useMemo(() => {
    const m = new Map<number, NodeLite>();
    nodes.forEach((n) => m.set(n.id, n));
    return m;
  }, [nodes]);

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
      try {
        const nodesRes: any = me?.role === "admin" ? await apiFetch<any[]>("/api/v1/admin/nodes") : await apiFetch<any>("/api/v1/reseller/nodes");
        const arr = Array.isArray(nodesRes) ? nodesRes : nodesRes?.items || [];
        setNodes(arr.map((n: any) => ({ id: n.id, name: n.name, base_url: n.base_url || "" })));
      } catch {
        // optional meta
      }

      const u = await apiFetch<UserOut>(`/api/v1/reseller/users/${userId}`);
      const lr = await apiFetch<LinksResp>(`/api/v1/reseller/users/${userId}/links?refresh=true`);
      setUser(u || null);
      setLinks(lr || null);
      if (u?.expire_at) {
        const exp = new Date(u.expire_at);
        setTargetDate(Number.isNaN(exp.getTime()) ? new Date() : exp);
      }
    } catch (e: any) {
      setErr(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, hasValidUserId]);

  React.useEffect(() => {
    if (!hasValidUserId) return;
    const timer = window.setInterval(() => {
      refresh().catch(() => undefined);
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, hasValidUserId]);

  async function runOp(path: string, body: any, successTitle: string) {
    setBusy(true);
    try {
      const res = await apiFetch<OpResult>(path, { method: "POST", body: JSON.stringify(body) });
      push({
        title: successTitle,
        desc: `${t("users.balance")}: ${fmtNumber(res.new_balance)}`,
        type: "success",
      });
      await refresh();
      await refreshMe().catch(() => undefined);
      return true;
    } catch (e: any) {
      push({ title: t("common.error"), desc: String(e.message || e), type: "error" });
      return false;
    } finally {
      setBusy(false);
    }
  }

  function ask(kind: "reset" | "revoke" | "delete") {
    setConfirmKind(kind);
    setConfirmOpen(true);
  }

  async function doConfirm() {
    setConfirmOpen(false);
    if (!confirmKind) return;
    if (confirmKind === "reset") await runOp(`/api/v1/reseller/users/${userId}/reset-usage`, {}, "ریست مصرف انجام شد");
    if (confirmKind === "revoke") await runOp(`/api/v1/reseller/users/${userId}/revoke`, {}, "ساب‌لینک‌ها بازسازی شد");
    if (confirmKind === "delete") await runOp(`/api/v1/reseller/users/${userId}/refund`, { action: "delete" }, "کاربر حذف و ریفاند انجام شد");
  }

  async function copyAllLinks() {
    if (!links) return;
    const direct = (links.node_links || [])
      .map((nl) => {
        const meta = nodeMap.get(nl.node_id);
        if (nl.config_download_url) return nl.config_download_url;
        if (nl.full_url) return nl.full_url;
        if (nl.direct_url) return normalizeUrl(nl.direct_url, meta?.base_url);
        return "";
      })
      .filter(Boolean);
    const text = [links.master_link, ...direct].filter(Boolean).join("\n");
    const ok = await copyText(text);
    push({ title: ok ? t("common.copied") : t("common.failed"), type: ok ? "success" : "error" });
  }

  function computeDaysDeltaFromTarget(currentExpireAt: string, target: Date | null) {
    if (!target || Number.isNaN(target.getTime())) return { ok: false as const };
    const current = new Date(currentExpireAt);
    if (Number.isNaN(current.getTime())) return { ok: false as const };
    const diffMs = target.getTime() - current.getTime();
    const diffDays = Math.ceil(Math.abs(diffMs) / (1000 * 60 * 60 * 24));
    return { ok: true as const, direction: diffMs >= 0 ? "up" : "down", diffDays };
  }

  const status = statusMeta(user?.status || "");
  const totalBytes = (user?.total_gb || 0) * 1024 * 1024 * 1024;
  const usedGb = bytesToGb(user?.used_bytes || 0);
  const usagePct = Math.round(clamp01(totalBytes > 0 ? (user?.used_bytes || 0) / totalBytes : 0) * 100);
  const expiryDate = user ? new Date(user.expire_at) : null;
  const now = new Date();
  const daysLeft = expiryDate ? Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : null;
  const isExpired = daysLeft !== null ? daysLeft < 0 : false;
  const isNearExpire = daysLeft !== null ? daysLeft >= 0 && daysLeft <= 3 : false;
  const isDisabled = (user?.status || "").toLowerCase() !== "active";
  const isExhausted = (user?.total_gb || 0) > 0 && usagePct >= 100;
  const blocked = isDisabled || isExpired || isExhausted;
  const warning = !blocked && (isNearExpire || usagePct >= 85);
  const bannerTone = blocked ? "border-red-300 bg-red-50 text-red-900" : warning ? "border-amber-300 bg-amber-50 text-amber-900" : "border-emerald-300 bg-emerald-50 text-emerald-900";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" className="gap-2" onClick={() => router.push("/app/users")}>
            <ArrowLeft size={16} /> {t("user.back")}
          </Button>
          <Button variant="outline" className="gap-2" onClick={refresh} disabled={busy}>
            <RefreshCcw size={16} /> {t("user.refresh")}
          </Button>
          <Button variant="ghost" onClick={() => router.push("/app/users/new")}>
            {t("user.new")}
          </Button>
        </div>
        <div className="text-xs text-[hsl(var(--fg))]/70">
          {t("users.balance")}: <span className="font-semibold">{fmtNumber(me?.balance ?? null)}</span>
        </div>
      </div>

      {locked ? (
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))] p-3 text-xs text-[hsl(var(--fg))]/80">
          {t("users.balanceZero")}
        </div>
      ) : null}
      {err ? <div className="text-sm text-red-600">{err}</div> : null}

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-8 w-60" />
              <Skeleton className="h-4 w-72" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-xs text-[hsl(var(--fg))]/70">جزئیات کاربر</div>
                  <div className="mt-1 text-2xl font-semibold break-all">{user ? user.label : `#${userId}`}</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={status.variant}>{status.label}</Badge>
                  {user ? (
                    (user.status || "").toLowerCase() === "active" ? (
                      <Button variant="outline" disabled={locked || busy} onClick={() => runOp(`/api/v1/reseller/users/${userId}/set-status`, { status: "disabled" }, "کاربر غیرفعال شد")}>
                        {t("user.disable")}
                      </Button>
                    ) : (
                      <Button disabled={locked || busy} onClick={() => runOp(`/api/v1/reseller/users/${userId}/set-status`, { status: "active" }, "کاربر فعال شد")}>
                        {t("user.enable")}
                      </Button>
                    )
                  ) : null}
                </div>
              </div>

              <div className={`rounded-2xl border px-4 py-3 ${bannerTone}`}>
                <div className="flex items-start gap-3">
                  <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
                  <div className="space-y-1 text-sm">
                    <div className="font-semibold">
                      {blocked ? "وضعیت سرویس نیاز به اقدام فوری دارد" : warning ? "وضعیت سرویس نزدیک به محدودیت است" : "سرویس کاربر در وضعیت پایدار قرار دارد"}
                    </div>
                    <div className="text-xs opacity-90">
                      {blocked
                        ? "اگر حجم تمام شده، زمان تمام شده یا وضعیت غیرفعال است، ابتدا تمدید/افزایش انجام دهید یا کاربر را فعال کنید."
                        : warning
                        ? "برای جلوگیری از قطعی سرویس، بهتر است پیش از اتمام، تمدید یا افزایش حجم انجام شود."
                        : "همه شاخص‌ها مناسب هستند. می‌توانید لینک‌های اشتراک را بدون محدودیت استفاده کنید."}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.45fr,.95fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="text-xl font-semibold">وضعیت اشتراک</div>
            </CardHeader>
            <CardContent className="space-y-4">
              {loading ? (
                <div className="space-y-3">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-14 w-full" />
                </div>
              ) : user ? (
                <>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3">
                      <div className="text-xs text-[hsl(var(--fg))]/70">حجم کل</div>
                      <div className="mt-1 text-lg font-semibold">{fmtNumber(user.total_gb)} گیگ</div>
                    </div>
                    <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3">
                      <div className="text-xs text-[hsl(var(--fg))]/70">مصرف‌شده</div>
                      <div className="mt-1 text-lg font-semibold">{new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(usedGb)} گیگ</div>
                    </div>
                    <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3">
                      <div className="text-xs text-[hsl(var(--fg))]/70">روز باقی‌مانده</div>
                      <div className="mt-1 text-lg font-semibold">{daysLeft == null ? "—" : fmtNumber(daysLeft)}</div>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs text-[hsl(var(--fg))]/70">
                      <span>درصد مصرف</span>
                      <span className="font-semibold">{usagePct}%</span>
                    </div>
                    <Progress value={usagePct} />
                  </div>
                  <div className="text-xs text-[hsl(var(--fg))]/70">
                    تاریخ انقضا: {formatJalaliDateTime(new Date(user.expire_at))}
                  </div>
                </>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xl font-semibold">لینک‌های اشتراک</div>
                <Button type="button" variant="outline" className="gap-2" disabled={!links} onClick={copyAllLinks}>
                  <Copy size={16} /> کپی همه لینک‌ها
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {loading ? (
                <div className="space-y-3">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-20 w-full" />
                </div>
              ) : links ? (
                <>
                  <div className="space-y-2">
                    <div className="text-xs text-[hsl(var(--fg))]/70">لینک اصلی اشتراک</div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Input value={links.master_link} readOnly />
                      <Button
                        type="button"
                        variant="outline"
                        className="sm:w-[170px]"
                        onClick={() => {
                          copyText(links.master_link).then((ok) => push({ title: ok ? t("common.copied") : t("common.failed"), type: ok ? "success" : "error" }));
                        }}
                      >
                        {t("common.copy")}
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="text-sm font-semibold">لینک‌های مستقیم</div>
                    {(links.node_links || []).map((n) => {
                      const meta = nodeMap.get(n.node_id);
                      const full = n.config_download_url
                        ? n.config_download_url
                        : n.full_url
                        ? n.full_url
                        : n.direct_url
                        ? normalizeUrl(n.direct_url, meta?.base_url)
                        : "";
                      const isWg = (n.panel_type || "").toLowerCase() === "wg_dashboard";
                      return (
                        <div key={n.node_id} className="rounded-2xl border border-[hsl(var(--border))] p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-xs text-[hsl(var(--fg))]/75">
                              {meta?.name || n.node_name || `Node #${n.node_id}`} (#{n.node_id})
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant="muted">{panelLabel(n.panel_type)}</Badge>
                              <Badge variant={n.status === "ok" ? "success" : n.status === "missing" ? "warning" : "danger"}>{n.status}</Badge>
                            </div>
                          </div>
                          {full ? (
                            <div className="mt-2 space-y-2">
                              <Input value={full} readOnly />
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="gap-2"
                                  onClick={() => {
                                    copyText(full).then((ok) => push({ title: ok ? t("common.copied") : t("common.failed"), type: ok ? "success" : "error" }));
                                  }}
                                >
                                  <Copy size={15} /> کپی
                                </Button>
                                {isWg ? (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="gap-2"
                                    onClick={() => window.open(full, "_blank", "noopener,noreferrer")}
                                  >
                                    <Download size={15} /> دانلود .conf
                                  </Button>
                                ) : null}
                              </div>
                            </div>
                          ) : (
                            <div className="mt-2 text-xs text-[hsl(var(--fg))]/70">{n.detail || "لینک در دسترس نیست."}</div>
                          )}
                        </div>
                      );
                    })}
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
                <div className="text-xl font-semibold">کنسول عملیات کاربر</div>
                <HelpTip text="ابزارهای افزایش/کاهش حجم و زمان به‌صورت ساده و مرحله‌ای." />
              </div>
              <div className="text-sm text-[hsl(var(--fg))]/70">برای سرعت بالاتر، ابتدا نوع عملیات را انتخاب کنید.</div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Button variant={opMode === "extend" ? "primary" : "outline"} className="gap-2" onClick={() => setOpMode("extend")} type="button">
                  <CalendarDays size={15} /> تمدید
                </Button>
                <Button variant={opMode === "traffic_up" ? "primary" : "outline"} className="gap-2" onClick={() => setOpMode("traffic_up")} type="button">
                  <Gauge size={15} /> افزایش حجم
                </Button>
                <Button variant={opMode === "traffic_down" ? "primary" : "outline"} className="gap-2" onClick={() => setOpMode("traffic_down")} type="button">
                  <Sparkles size={15} /> کاهش حجم
                </Button>
                <Button variant={opMode === "time_down" ? "primary" : "outline"} className="gap-2" onClick={() => setOpMode("time_down")} type="button">
                  <CalendarDays size={15} /> کاهش زمان
                </Button>
                <Button variant={opMode === "controls" ? "primary" : "outline"} className="gap-2" onClick={() => setOpMode("controls")} type="button">
                  <ShieldAlert size={15} /> کنترل سرویس
                </Button>
              </div>

              {opMode === "extend" ? (
                <div className="space-y-3 rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(155deg,hsl(var(--card))_0%,hsl(var(--muted)/0.28)_100%)] p-3 transition-all duration-200 hover:border-[hsl(var(--accent)/0.35)] hover:shadow-soft">
                  <div className="text-sm font-medium">تمدید مدت زمان کاربر</div>
                  <div className="flex flex-wrap gap-2">
                    {[7, 30, 90, 180, 365].map((d) => (
                      <Button key={d} type="button" size="sm" variant={extendDays === d ? "primary" : "outline"} onClick={() => setExtendDays(d)}>
                        {d} روز
                      </Button>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Input className="min-w-[130px] flex-1" type="number" min={1} value={extendDays} onChange={(e) => setExtendDays(Math.max(1, Number(e.target.value) || 1))} />
                    <JalaliDateTimePicker
                      mode="icon"
                      value={targetDate}
                      onChange={(d) => {
                        setTargetDate(d);
                        if (!user) return;
                        const delta = computeDaysDeltaFromTarget(user.expire_at, d);
                        if (delta.ok && delta.direction === "up" && delta.diffDays > 0) {
                          setExtendDays(Math.max(1, Math.min(3650, delta.diffDays)));
                        }
                      }}
                    />
                    <Button
                      disabled={locked || busy}
                      onClick={() => runOp(`/api/v1/reseller/users/${userId}/extend`, { days: extendDays }, "تمدید انجام شد")}
                    >
                      اجرا
                    </Button>
                  </div>
                  <div className="text-xs text-[hsl(var(--fg))]/75">
                    تاریخ پایان فعلی: <span className="font-semibold">{user ? formatJalaliDateTime(new Date(user.expire_at)) : "—"}</span>
                    {targetDate ? (
                      <span className="mr-2">
                        | تاریخ انتخابی: <span className="font-semibold">{formatJalaliDateTime(targetDate)}</span>
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {opMode === "traffic_up" ? (
                <div className="space-y-3 rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(155deg,hsl(var(--card))_0%,hsl(var(--muted)/0.24)_100%)] p-3 transition-all duration-200 hover:border-[hsl(var(--accent)/0.35)] hover:shadow-soft">
                  <div className="text-sm font-medium">افزایش حجم کاربر</div>
                  <div className="flex flex-wrap gap-2">
                    {[5, 10, 20, 50, 100].map((g) => (
                      <Button key={g} type="button" size="sm" variant={addGb === g ? "primary" : "outline"} onClick={() => setAddGb(g)}>
                        +{g} گیگ
                      </Button>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Input className="min-w-[130px] flex-1" type="number" min={1} value={addGb} onChange={(e) => setAddGb(Math.max(1, Number(e.target.value) || 1))} />
                    <Button
                      disabled={locked || busy}
                      onClick={() => runOp(`/api/v1/reseller/users/${userId}/add-traffic`, { add_gb: addGb }, "افزایش حجم انجام شد")}
                    >
                      اجرا
                    </Button>
                  </div>
                </div>
              ) : null}

              {opMode === "traffic_down" ? (
                <div className="space-y-3 rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(155deg,hsl(var(--card))_0%,hsl(var(--muted)/0.24)_100%)] p-3 transition-all duration-200 hover:border-[hsl(var(--accent)/0.35)] hover:shadow-soft">
                  <div className="text-sm font-medium">کاهش حجم (همراه ریفاند)</div>
                  <div className="flex flex-wrap gap-2">
                    {[1, 5, 10, 20, 50].map((g) => (
                      <Button key={g} type="button" size="sm" variant={decreaseGb === g ? "primary" : "outline"} onClick={() => setDecreaseGb(g)}>
                        -{g} گیگ
                      </Button>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Input className="min-w-[130px] flex-1" type="number" min={1} value={decreaseGb} onChange={(e) => setDecreaseGb(Math.max(1, Number(e.target.value) || 1))} />
                    <Button
                      variant="outline"
                      disabled={locked || busy}
                      onClick={() =>
                        runOp(`/api/v1/reseller/users/${userId}/refund`, { action: "decrease", decrease_gb: decreaseGb }, "کاهش حجم و ریفاند انجام شد")
                      }
                    >
                      اجرا
                    </Button>
                  </div>
                </div>
              ) : null}

              {opMode === "time_down" ? (
                <div className="space-y-3 rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(155deg,hsl(var(--card))_0%,hsl(var(--muted)/0.28)_100%)] p-3 transition-all duration-200 hover:border-[hsl(var(--accent)/0.35)] hover:shadow-soft">
                  <div className="text-sm font-medium">کاهش زمان (همراه ریفاند)</div>
                  <div className="flex flex-wrap gap-2">
                    {[1, 3, 7, 15, 30, 60].map((d) => (
                      <Button key={d} type="button" size="sm" variant={decreaseDays === d ? "primary" : "outline"} onClick={() => setDecreaseDays(d)}>
                        -{d} روز
                      </Button>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Input className="min-w-[130px] flex-1" type="number" min={1} value={decreaseDays} onChange={(e) => setDecreaseDays(Math.max(1, Number(e.target.value) || 1))} />
                    <JalaliDateTimePicker
                      mode="icon"
                      value={targetDate}
                      onChange={(d) => {
                        setTargetDate(d);
                        if (!user) return;
                        const delta = computeDaysDeltaFromTarget(user.expire_at, d);
                        if (delta.ok && delta.direction === "down" && delta.diffDays > 0) {
                          setDecreaseDays(Math.max(1, Math.min(3650, delta.diffDays)));
                        }
                      }}
                    />
                    <Button
                      variant="outline"
                      disabled={locked || busy}
                      onClick={() => runOp(`/api/v1/reseller/users/${userId}/decrease-time`, { days: decreaseDays }, "کاهش زمان انجام شد")}
                    >
                      اجرا
                    </Button>
                  </div>
                  <div className="text-xs text-[hsl(var(--fg))]/75">
                    تاریخ پایان فعلی: <span className="font-semibold">{user ? formatJalaliDateTime(new Date(user.expire_at)) : "—"}</span>
                    {targetDate ? (
                      <span className="mr-2">
                        | تاریخ انتخابی: <span className="font-semibold">{formatJalaliDateTime(targetDate)}</span>
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {opMode === "controls" ? (
                <div className="space-y-3 rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(155deg,hsl(var(--card))_0%,hsl(var(--muted)/0.3)_100%)] p-3 transition-all duration-200 hover:border-[hsl(var(--accent)/0.35)] hover:shadow-soft">
                  <div className="text-sm font-medium">عملیات کنترلی</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Button type="button" variant="outline" disabled={locked || busy} onClick={() => ask("reset")}>
                      ریست مصرف
                    </Button>
                    <Button type="button" variant="outline" disabled={locked || busy} onClick={() => ask("revoke")}>
                      بازسازی ساب‌لینک
                    </Button>
                  </div>
                  <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                    حذف کاربر همراه ریفاند فقط وقتی استفاده شود که از حذف مطمئن هستید.
                  </div>
                  <Button type="button" variant="outline" disabled={locked || busy} onClick={() => ask("delete")}>
                    حذف کاربر + ریفاند
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={
          confirmKind === "reset"
            ? "تایید ریست مصرف"
            : confirmKind === "revoke"
            ? "تایید بازسازی ساب‌لینک"
            : "تایید حذف کاربر"
        }
      >
        <div className="space-y-4">
          <div className="text-sm text-[hsl(var(--fg))]/80">
            {confirmKind === "reset"
              ? "مصرف کاربر روی همه پنل‌ها ریست می‌شود. ادامه می‌دهید؟"
              : confirmKind === "revoke"
              ? "ساب‌لینک‌های کاربر بازسازی می‌شود و ممکن است لینک‌ها تغییر کنند. ادامه می‌دهید؟"
              : "کاربر حذف می‌شود و عملیات ریفاند طبق سیاست سیستم انجام خواهد شد. ادامه می‌دهید؟"}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button disabled={busy} onClick={doConfirm}>
              {t("common.confirm")}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
