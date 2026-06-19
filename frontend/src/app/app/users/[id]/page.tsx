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

type UserOut = { id: number; label: string; total_gb: number; used_bytes: number; expire_at: string; status: string; create_status?: string | null };
type LinksResp = {
  user_id: number;
  master_link?: string | null;
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
type OpMode = "renewal" | "extend" | "traffic_up" | "traffic_down" | "time_down" | "controls";
type ResellerUserPolicy = {
  enabled: boolean;
  restrict_edit_to_renewal_only: boolean;
  renewal_policy: string;
  allowed_duration_presets: string[];
  allowed_traffic_gb: number[];
};
const AUTO_REFRESH_MS = 30_000;
const DURATION_PRESETS = [
  { key: "7d", label: "7 days", days: 7 },
  { key: "1m", label: "1 month", days: 31 },
  { key: "3m", label: "3 months", days: 90 },
  { key: "6m", label: "6 months", days: 180 },
  { key: "1y", label: "1 year", days: 365 },
];
const TRAFFIC_PRESETS = [20, 30, 50, 70, 100, 150, 200];

function bytesToGb(bytes: number) {
  return bytes / (1024 * 1024 * 1024);
}

function fmtTrafficBytes(bytes: number, lang: "fa" | "en") {
  const safe = Math.max(0, Number(bytes) || 0);
  if (safe > 0 && safe < 1024 * 1024 * 1024) {
    const mb = Math.max(1, Math.ceil(safe / (1024 * 1024)));
    return `${new Intl.NumberFormat(lang === "fa" ? "fa-IR" : "en-US", { maximumFractionDigits: 0 }).format(mb)} ${lang === "fa" ? "مگابایت" : "MB"}`;
  }
  return `${new Intl.NumberFormat(lang === "fa" ? "fa-IR" : "en-US", { maximumFractionDigits: 1 }).format(bytesToGb(safe))} ${lang === "fa" ? "گیگ" : "GB"}`;
}

function usagePercentLabel(percent: number, usedBytes: number, lang: "fa" | "en") {
  if (usedBytes > 0 && percent === 0) return lang === "fa" ? "<۱٪" : "<1%";
  return lang === "fa" ? `${percent}٪` : `${percent}%`;
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

function panelLabel(panelType: string | undefined, lang: "fa" | "en") {
  const p = String(panelType || "").toLowerCase();
  if (p === "wg_dashboard") return lang === "fa" ? "وایرگارد" : "WireGuard";
  return lang === "fa" ? "لینک امن" : "Secure link";
}

function statusMeta(raw: string, createStatus: string | null | undefined, lang: "fa" | "en") {
  const s = String(raw || "").toLowerCase();
  if (s === "active" && String(createStatus || "").toLowerCase() === "on_hold") {
    return {
      variant: "default" as const,
      label: lang === "fa" ? "در انتظار اتصال" : "On Hold",
      className: "border-violet-500/35 bg-violet-500/15 text-violet-700 dark:text-violet-300",
    };
  }
  if (s === "active") return { variant: "success" as const, label: lang === "fa" ? "فعال" : "Active", className: "" };
  if (s === "disabled") return { variant: "warning" as const, label: lang === "fa" ? "غیرفعال" : "Disabled", className: "" };
  if (s === "deleted") return { variant: "danger" as const, label: lang === "fa" ? "حذف‌شده" : "Deleted", className: "" };
  return { variant: "muted" as const, label: raw || (lang === "fa" ? "نامشخص" : "Unknown"), className: "" };
}

function durationPresetLabel(p: { key: string; label: string; days: number }, lang: "fa" | "en") {
  if (lang === "en") return p.label;
  if (p.key === "7d") return "۷ روز";
  if (p.key === "1m") return "۱ ماه";
  if (p.key === "3m") return "۳ ماه";
  if (p.key === "6m") return "۶ ماه";
  if (p.key === "1y") return "۱ سال";
  return `${fmtNumber(p.days)} روز`;
}

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { me, refresh: refreshMe } = useAuth();
  const { t, lang } = useI18n();
  const { push } = useToast();

  const parsedUserId = Number(id);
  const userId = Number.isFinite(parsedUserId) ? parsedUserId : 0;
  const hasValidUserId = Number.isInteger(parsedUserId) && parsedUserId > 0;
  const locked = (me?.balance ?? 1) <= 0;

  const copy = React.useMemo(
    () =>
      lang === "en"
        ? {
            invalidUserId: "Invalid user ID.",
            resetDone: "Usage reset completed",
            revokeDone: "Subscription links rebuilt",
            deleteDone: "User deleted and refund completed",
            noLinkToCopy: "No link available to copy",
            details: "User details",
            disabledDone: "User disabled",
            enabledDone: "User enabled",
            blockedTitle: "Service status needs immediate action",
            warningTitle: "Service status is close to a limit",
            stableTitle: "User service is stable",
            blockedBody: "If traffic is exhausted, time has ended, or the user is disabled, renew/add first or enable the user.",
            warningBody: "To avoid interruption, renew or add traffic before the service ends.",
            stableBody: "All indicators look good. Subscription links can be used without limitations.",
            subStatus: "Subscription Status",
            totalTraffic: "Total traffic",
            usedTraffic: "Used",
            remainingDays: "Remaining days",
            usagePercent: "Usage percent",
            expiryDate: "Expiry date",
            subscriptionLinks: "Subscription Links",
            copyAllLinks: "Copy all links",
            masterSub: "Main subscription link",
            directLinks: "Direct links",
            copy: "Copy",
            downloadConf: "Download .conf",
            unavailableLink: "Link is not available.",
            opConsole: "User Operations Console",
            opHelp: "Traffic and time increase/decrease tools in a simple step-by-step flow.",
            opSubtitle: "Select the operation type first for faster work.",
            renewalPackage: "Package renewal",
            extendTime: "Extend time",
            addTraffic: "Add traffic",
            decreaseTraffic: "Decrease traffic",
            decreaseTime: "Decrease time",
            controls: "Service control",
            renewalTitle: "Package renewal by super admin policy",
            gb: "GB",
            days: "days",
            renewalDays: "Renewal duration (days)",
            renewalGb: "Renewal traffic (GB)",
            run: "Run",
            extendTitle: "Extend user time",
            currentExpire: "Current expiry",
            selectedDate: "Selected date",
            addTrafficTitle: "Add user traffic",
            decreaseTrafficTitle: "Decrease traffic with refund",
            decreaseTimeTitle: "Decrease time with refund",
            controlsTitle: "Control operations",
            resetUsage: "Reset usage",
            rebuildSub: "Rebuild subscription link",
            deleteWarning: "Use delete with refund only when you are sure about deleting the user.",
            deleteRefund: "Delete user + refund",
            confirmResetTitle: "Confirm usage reset",
            confirmRevokeTitle: "Confirm subscription rebuild",
            confirmDeleteTitle: "Confirm user deletion",
            confirmResetBody: "Usage will be reset on all panels. Continue?",
            confirmRevokeBody: "User subscription links will be rebuilt and may change. Continue?",
            confirmDeleteBody: "The user will be deleted and refund will be processed by system policy. Continue?",
            balanceLabel: t("users.balance"),
          }
        : {
            invalidUserId: "شناسه کاربر نامعتبر است.",
            resetDone: "ریست مصرف انجام شد",
            revokeDone: "ساب‌لینک‌ها بازسازی شد",
            deleteDone: "کاربر حذف و ریفاند انجام شد",
            noLinkToCopy: "لینکی برای کپی وجود ندارد",
            details: "جزئیات کاربر",
            disabledDone: "کاربر غیرفعال شد",
            enabledDone: "کاربر فعال شد",
            blockedTitle: "وضعیت سرویس نیاز به اقدام فوری دارد",
            warningTitle: "وضعیت سرویس نزدیک به محدودیت است",
            stableTitle: "سرویس کاربر در وضعیت پایدار قرار دارد",
            blockedBody: "اگر حجم تمام شده، زمان تمام شده یا وضعیت غیرفعال است، ابتدا تمدید/افزایش انجام دهید یا کاربر را فعال کنید.",
            warningBody: "برای جلوگیری از قطعی سرویس، بهتر است پیش از اتمام، تمدید یا افزایش حجم انجام شود.",
            stableBody: "همه شاخص‌ها مناسب هستند. می‌توانید لینک‌های اشتراک را بدون محدودیت استفاده کنید.",
            subStatus: "وضعیت اشتراک",
            totalTraffic: "حجم کل",
            usedTraffic: "مصرف‌شده",
            remainingDays: "روز باقی‌مانده",
            usagePercent: "درصد مصرف",
            expiryDate: "تاریخ انقضا",
            subscriptionLinks: "لینک‌های اشتراک",
            copyAllLinks: "کپی همه لینک‌ها",
            masterSub: "لینک اصلی اشتراک",
            directLinks: "لینک‌های مستقیم",
            copy: "کپی",
            downloadConf: "دانلود .conf",
            unavailableLink: "لینک در دسترس نیست.",
            opConsole: "کنسول عملیات کاربر",
            opHelp: "ابزارهای افزایش/کاهش حجم و زمان به‌صورت ساده و مرحله‌ای.",
            opSubtitle: "برای سرعت بالاتر، ابتدا نوع عملیات را انتخاب کنید.",
            renewalPackage: "تمدید بسته‌ای",
            extendTime: "افزایش زمان",
            addTraffic: "افزایش حجم",
            decreaseTraffic: "کاهش حجم",
            decreaseTime: "کاهش زمان",
            controls: "کنترل سرویس",
            renewalTitle: "تمدید بسته‌ای طبق سیاست سوپرادمین",
            gb: "گیگ",
            days: "روز",
            renewalDays: "مدت تمدید (روز)",
            renewalGb: "حجم تمدید (گیگ)",
            run: "اجرا",
            extendTitle: "افزایش مدت زمان کاربر",
            currentExpire: "تاریخ پایان فعلی",
            selectedDate: "تاریخ انتخابی",
            addTrafficTitle: "افزایش حجم کاربر",
            decreaseTrafficTitle: "کاهش حجم (همراه ریفاند)",
            decreaseTimeTitle: "کاهش زمان (همراه ریفاند)",
            controlsTitle: "عملیات کنترلی",
            resetUsage: "ریست مصرف",
            rebuildSub: "بازسازی ساب‌لینک",
            deleteWarning: "حذف کاربر همراه ریفاند فقط وقتی استفاده شود که از حذف مطمئن هستید.",
            deleteRefund: "حذف کاربر + ریفاند",
            confirmResetTitle: "تایید ریست مصرف",
            confirmRevokeTitle: "تایید بازسازی ساب‌لینک",
            confirmDeleteTitle: "تایید حذف کاربر",
            confirmResetBody: "مصرف کاربر روی همه پنل‌ها ریست می‌شود. ادامه می‌دهید؟",
            confirmRevokeBody: "ساب‌لینک‌های کاربر بازسازی می‌شود و ممکن است لینک‌ها تغییر کنند. ادامه می‌دهید؟",
            confirmDeleteBody: "کاربر حذف می‌شود و عملیات ریفاند طبق سیاست سیستم انجام خواهد شد. ادامه می‌دهید؟",
            balanceLabel: t("users.balance"),
          },
    [lang, t]
  );

  const [user, setUser] = React.useState<UserOut | null>(null);
  const [links, setLinks] = React.useState<LinksResp | null>(null);
  const [userPolicy, setUserPolicy] = React.useState<ResellerUserPolicy | null>(null);
  const [nodes, setNodes] = React.useState<NodeLite[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const [opMode, setOpMode] = React.useState<OpMode>("renewal");
  const [extendDays, setExtendDays] = React.useState(31);
  const [decreaseDays, setDecreaseDays] = React.useState(7);
  const [addGb, setAddGb] = React.useState(10);
  const [decreaseGb, setDecreaseGb] = React.useState(5);
  const [renewDays, setRenewDays] = React.useState(31);
  const [renewGb, setRenewGb] = React.useState(30);
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
      setErr(copy.invalidUserId);
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
      const policy = await apiFetch<ResellerUserPolicy>("/api/v1/reseller/settings/user-policy");
      setUser(u || null);
      setLinks(lr || null);
      setUserPolicy(policy || null);
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

  const renewalOnly = !!(userPolicy?.enabled && userPolicy.restrict_edit_to_renewal_only);
  const renewalDurationPresets = React.useMemo(() => {
    const allowed = new Set((userPolicy?.allowed_duration_presets || []).map((x) => String(x).toLowerCase()));
    const filtered = DURATION_PRESETS.filter((p) => !allowed.size || allowed.has(p.key));
    return filtered.length ? filtered : DURATION_PRESETS;
  }, [userPolicy]);
  const renewalTrafficPresets = React.useMemo(() => {
    const allowed = (userPolicy?.allowed_traffic_gb || []).filter((x) => Number.isFinite(x) && x > 0);
    return allowed.length ? allowed : TRAFFIC_PRESETS;
  }, [userPolicy]);

  React.useEffect(() => {
    if (renewalOnly) setOpMode("renewal");
  }, [renewalOnly]);

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
    if (confirmKind === "reset") await runOp(`/api/v1/reseller/users/${userId}/reset-usage`, {}, copy.resetDone);
    if (confirmKind === "revoke") await runOp(`/api/v1/reseller/users/${userId}/revoke`, {}, copy.revokeDone);
    if (confirmKind === "delete") await runOp(`/api/v1/reseller/users/${userId}/refund`, { action: "delete" }, copy.deleteDone);
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
    if (!text) {
      push({ title: copy.noLinkToCopy, type: "warning" });
      return;
    }
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

  const status = statusMeta(user?.status || "", user?.create_status, lang);
  const totalBytes = (user?.total_gb || 0) * 1024 * 1024 * 1024;
  const usedBytes = Number(user?.used_bytes || 0);
  const usagePct = Math.round(clamp01(totalBytes > 0 ? usedBytes / totalBytes : 0) * 100);
  const visibleUsagePct = usedBytes > 0 ? Math.max(1, usagePct) : 0;
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
          <Button variant="ghost" onClick={() => router.push("/app/users/new")} disabled={locked}>
            {t("user.new")}
          </Button>
        </div>
        <div className="text-xs text-[hsl(var(--fg))]/70">
          {copy.balanceLabel}: <span className="font-semibold">{fmtNumber(me?.balance ?? null)}</span>
        </div>
      </div>

      {locked ? (
        <div className="max-w-full overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-3))] p-3 text-xs text-[hsl(var(--fg))]/80 break-words [overflow-wrap:anywhere]">
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
                  <div className="text-xs text-[hsl(var(--fg))]/70">{copy.details}</div>
                  <div className="mt-1 text-2xl font-semibold break-all">{user ? user.label : `#${userId}`}</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={status.variant} className={status.className}>{status.label}</Badge>
                  {user ? (
                    (user.status || "").toLowerCase() === "active" ? (
                      <Button variant="outline" disabled={locked || busy} onClick={() => runOp(`/api/v1/reseller/users/${userId}/set-status`, { status: "disabled" }, copy.disabledDone)}>
                        {t("user.disable")}
                      </Button>
                    ) : (
                      <Button disabled={locked || busy} onClick={() => runOp(`/api/v1/reseller/users/${userId}/set-status`, { status: "active" }, copy.enabledDone)}>
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
                      {blocked ? copy.blockedTitle : warning ? copy.warningTitle : copy.stableTitle}
                    </div>
                    <div className="text-xs opacity-90">
                      {blocked
                        ? copy.blockedBody
                        : warning
                        ? copy.warningBody
                        : copy.stableBody}
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
              <div className="text-xl font-semibold">{copy.subStatus}</div>
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
                    <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] p-3">
                      <div className="text-xs text-[hsl(var(--fg))]/70">{copy.totalTraffic}</div>
                      <div className="mt-1 text-lg font-semibold">{fmtNumber(user.total_gb)} {copy.gb}</div>
                    </div>
                    <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] p-3">
                      <div className="text-xs text-[hsl(var(--fg))]/70">{copy.usedTraffic}</div>
                      <div className="mt-1 text-lg font-semibold">{fmtTrafficBytes(usedBytes, lang)}</div>
                    </div>
                    <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] p-3">
                      <div className="text-xs text-[hsl(var(--fg))]/70">{copy.remainingDays}</div>
                      <div className="mt-1 text-lg font-semibold">{daysLeft == null ? "—" : fmtNumber(daysLeft)}</div>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs text-[hsl(var(--fg))]/70">
                      <span>{copy.usagePercent}</span>
                      <span className="font-semibold">{usagePercentLabel(usagePct, usedBytes, lang)}</span>
                    </div>
                    <Progress value={visibleUsagePct} />
                  </div>
                  <div className="text-xs text-[hsl(var(--fg))]/70">
                    {copy.expiryDate}: {formatJalaliDateTime(new Date(user.expire_at))}
                  </div>
                </>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xl font-semibold">{copy.subscriptionLinks}</div>
                <Button type="button" variant="outline" className="gap-2" disabled={!links} onClick={copyAllLinks}>
                  <Copy size={16} /> {copy.copyAllLinks}
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
                  {links.master_link ? (
                  <div className="space-y-2">
                    <div className="text-xs text-[hsl(var(--fg))]/70">{copy.masterSub}</div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Input value={links.master_link || ""} readOnly />
                      <Button
                        type="button"
                        variant="outline"
                        className="sm:w-[170px]"
                        onClick={() => {
                          copyText(links.master_link || "").then((ok) => push({ title: ok ? t("common.copied") : t("common.failed"), type: ok ? "success" : "error" }));
                        }}
                      >
                        {t("common.copy")}
                      </Button>
                    </div>
                  </div>
                  ) : null}

                  <div className="space-y-2">
                    <div className="text-sm font-semibold">{copy.directLinks}</div>
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
                              <Badge variant="muted">{panelLabel(n.panel_type, lang)}</Badge>
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
                                  <Copy size={15} /> {copy.copy}
                                </Button>
                                {isWg ? (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="gap-2"
                                    onClick={() => window.open(full, "_blank", "noopener,noreferrer")}
                                  >
                                    <Download size={15} /> {copy.downloadConf}
                                  </Button>
                                ) : null}
                              </div>
                            </div>
                          ) : (
                            <div className="mt-2 text-xs text-[hsl(var(--fg))]/70">{n.detail || copy.unavailableLink}</div>
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
                <div className="text-xl font-semibold">{copy.opConsole}</div>
                <HelpTip text={copy.opHelp} />
              </div>
              <div className="text-sm text-[hsl(var(--fg))]/70">{copy.opSubtitle}</div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {renewalOnly ? (
                  <Button variant="primary" className="gap-2 sm:col-span-3" onClick={() => setOpMode("renewal")} type="button">
                    <CalendarDays size={15} /> {copy.renewalPackage}
                  </Button>
                ) : (
                  <>
                    <Button variant={opMode === "renewal" ? "primary" : "outline"} className="gap-2" onClick={() => setOpMode("renewal")} type="button">
                      <CalendarDays size={15} /> {copy.renewalPackage}
                    </Button>
                    <Button variant={opMode === "extend" ? "primary" : "outline"} className="gap-2" onClick={() => setOpMode("extend")} type="button">
                      <CalendarDays size={15} /> {copy.extendTime}
                    </Button>
                    <Button variant={opMode === "traffic_up" ? "primary" : "outline"} className="gap-2" onClick={() => setOpMode("traffic_up")} type="button">
                      <Gauge size={15} /> {copy.addTraffic}
                    </Button>
                    <Button variant={opMode === "traffic_down" ? "primary" : "outline"} className="gap-2" onClick={() => setOpMode("traffic_down")} type="button">
                      <Sparkles size={15} /> {copy.decreaseTraffic}
                    </Button>
                    <Button variant={opMode === "time_down" ? "primary" : "outline"} className="gap-2" onClick={() => setOpMode("time_down")} type="button">
                      <CalendarDays size={15} /> {copy.decreaseTime}
                    </Button>
                    <Button variant={opMode === "controls" ? "primary" : "outline"} className="gap-2" onClick={() => setOpMode("controls")} type="button">
                      <ShieldAlert size={15} /> {copy.controls}
                    </Button>
                  </>
                )}
              </div>

              {opMode === "renewal" ? (
                <div className="space-y-3 rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(155deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3)/0.28)_100%)] p-3 transition-all duration-200 hover:border-[hsl(var(--accent)/0.35)] hover:shadow-soft">
                  <div className="text-sm font-medium">{copy.renewalTitle}</div>
                  <div className="flex flex-wrap gap-2">
                    {renewalDurationPresets.map((p) => (
                      <Button key={p.key} type="button" size="sm" variant={renewDays === p.days ? "primary" : "outline"} onClick={() => setRenewDays(p.days)}>
                        {durationPresetLabel(p, lang)}
                      </Button>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {renewalTrafficPresets.map((g) => (
                      <Button key={g} type="button" size="sm" variant={renewGb === g ? "primary" : "outline"} onClick={() => setRenewGb(g)}>
                        {g} {copy.gb}
                      </Button>
                    ))}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-[1fr,1fr,auto]">
                    <label className="space-y-1">
                      <span className="text-[11px] font-medium text-[hsl(var(--fg))]/65">{copy.renewalDays}</span>
                      <Input className="min-w-0" type="number" min={1} value={renewDays} disabled={renewalOnly} onChange={(e) => setRenewDays(Math.max(1, Number(e.target.value) || 1))} />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[11px] font-medium text-[hsl(var(--fg))]/65">{copy.renewalGb}</span>
                      <Input className="min-w-0" type="number" min={1} value={renewGb} disabled={renewalOnly} onChange={(e) => setRenewGb(Math.max(1, Number(e.target.value) || 1))} />
                    </label>
                    <Button
                      className="self-end"
                      disabled={locked || busy}
                      onClick={() => runOp(`/api/v1/reseller/users/${userId}/renew`, { days: renewDays, total_gb: renewGb, pricing_mode: "bundle" }, copy.renewalPackage)}
                    >
                      {copy.run}
                    </Button>
                  </div>
                </div>
              ) : null}

              {!renewalOnly && opMode === "extend" ? (
                <div className="space-y-3 rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(155deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3)/0.28)_100%)] p-3 transition-all duration-200 hover:border-[hsl(var(--accent)/0.35)] hover:shadow-soft">
                  <div className="text-sm font-medium">{copy.extendTitle}</div>
                  <div className="flex flex-wrap gap-2">
                    {[7, 31, 90, 180, 365].map((d) => (
                      <Button key={d} type="button" size="sm" variant={extendDays === d ? "primary" : "outline"} onClick={() => setExtendDays(d)}>
                        {d} {copy.days}
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
                      onClick={() => runOp(`/api/v1/reseller/users/${userId}/extend`, { days: extendDays }, copy.extendTime)}
                    >
                      {copy.run}
                    </Button>
                  </div>
                  <div className="text-xs text-[hsl(var(--fg))]/75">
                    {copy.currentExpire}: <span className="font-semibold">{user ? formatJalaliDateTime(new Date(user.expire_at)) : "—"}</span>
                    {targetDate ? (
                      <span className="mr-2">
                        | {copy.selectedDate}: <span className="font-semibold">{formatJalaliDateTime(targetDate)}</span>
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {!renewalOnly && opMode === "traffic_up" ? (
                <div className="space-y-3 rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(155deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3)/0.24)_100%)] p-3 transition-all duration-200 hover:border-[hsl(var(--accent)/0.35)] hover:shadow-soft">
                  <div className="text-sm font-medium">{copy.addTrafficTitle}</div>
                  <div className="flex flex-wrap gap-2">
                    {[5, 10, 20, 50, 100].map((g) => (
                      <Button key={g} type="button" size="sm" variant={addGb === g ? "primary" : "outline"} onClick={() => setAddGb(g)}>
                        +{g} {copy.gb}
                      </Button>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Input className="min-w-[130px] flex-1" type="number" min={1} value={addGb} onChange={(e) => setAddGb(Math.max(1, Number(e.target.value) || 1))} />
                    <Button
                      disabled={locked || busy}
                      onClick={() => runOp(`/api/v1/reseller/users/${userId}/add-traffic`, { add_gb: addGb }, copy.addTraffic)}
                    >
                      {copy.run}
                    </Button>
                  </div>
                </div>
              ) : null}

              {!renewalOnly && opMode === "traffic_down" ? (
                <div className="space-y-3 rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(155deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3)/0.24)_100%)] p-3 transition-all duration-200 hover:border-[hsl(var(--accent)/0.35)] hover:shadow-soft">
                  <div className="text-sm font-medium">{copy.decreaseTrafficTitle}</div>
                  <div className="flex flex-wrap gap-2">
                    {[1, 5, 10, 20, 50].map((g) => (
                      <Button key={g} type="button" size="sm" variant={decreaseGb === g ? "primary" : "outline"} onClick={() => setDecreaseGb(g)}>
                        -{g} {copy.gb}
                      </Button>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Input className="min-w-[130px] flex-1" type="number" min={1} value={decreaseGb} onChange={(e) => setDecreaseGb(Math.max(1, Number(e.target.value) || 1))} />
                    <Button
                      variant="outline"
                      disabled={locked || busy}
                      onClick={() =>
                        runOp(`/api/v1/reseller/users/${userId}/refund`, { action: "decrease", decrease_gb: decreaseGb }, copy.decreaseTraffic)
                      }
                    >
                      {copy.run}
                    </Button>
                  </div>
                </div>
              ) : null}

              {!renewalOnly && opMode === "time_down" ? (
                <div className="space-y-3 rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(155deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3)/0.28)_100%)] p-3 transition-all duration-200 hover:border-[hsl(var(--accent)/0.35)] hover:shadow-soft">
                  <div className="text-sm font-medium">{copy.decreaseTimeTitle}</div>
                  <div className="flex flex-wrap gap-2">
                    {[1, 3, 7, 15, 31, 60].map((d) => (
                      <Button key={d} type="button" size="sm" variant={decreaseDays === d ? "primary" : "outline"} onClick={() => setDecreaseDays(d)}>
                        -{d} {copy.days}
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
                      onClick={() => runOp(`/api/v1/reseller/users/${userId}/decrease-time`, { days: decreaseDays }, copy.decreaseTime)}
                    >
                      {copy.run}
                    </Button>
                  </div>
                  <div className="text-xs text-[hsl(var(--fg))]/75">
                    {copy.currentExpire}: <span className="font-semibold">{user ? formatJalaliDateTime(new Date(user.expire_at)) : "—"}</span>
                    {targetDate ? (
                      <span className="mr-2">
                        | {copy.selectedDate}: <span className="font-semibold">{formatJalaliDateTime(targetDate)}</span>
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {!renewalOnly && opMode === "controls" ? (
                <div className="space-y-3 rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(155deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3)/0.3)_100%)] p-3 transition-all duration-200 hover:border-[hsl(var(--accent)/0.35)] hover:shadow-soft">
                  <div className="text-sm font-medium">{copy.controlsTitle}</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Button type="button" variant="outline" disabled={locked || busy} onClick={() => ask("reset")}>
                      {copy.resetUsage}
                    </Button>
                    <Button type="button" variant="outline" disabled={busy} onClick={() => ask("revoke")}>
                      {copy.rebuildSub}
                    </Button>
                  </div>
                  <div className="max-w-full overflow-hidden rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800 break-words [overflow-wrap:anywhere]">
                    {copy.deleteWarning}
                  </div>
                  <Button type="button" variant="outline" disabled={busy} onClick={() => ask("delete")}>
                    {copy.deleteRefund}
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
            ? copy.confirmResetTitle
            : confirmKind === "revoke"
            ? copy.confirmRevokeTitle
            : copy.confirmDeleteTitle
        }
      >
        <div className="space-y-4">
          <div className="text-sm text-[hsl(var(--fg))]/80">
            {confirmKind === "reset"
              ? copy.confirmResetBody
              : confirmKind === "revoke"
              ? copy.confirmRevokeBody
              : copy.confirmDeleteBody}
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
