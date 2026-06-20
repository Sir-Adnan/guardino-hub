"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Menu } from "@/components/ui/menu";
import { ConfirmModal } from "@/components/ui/confirm";
import { Modal } from "@/components/ui/modal";
import { Badge } from "@/components/ui/badge";
import { apiFetch, newRequestId } from "@/lib/api";
import { fmtNumber, formatNumberWithDigits } from "@/lib/format";
import { useToast } from "@/components/ui/toast";
import { HelpTip } from "@/components/ui/help-tip";
import { useI18n } from "@/components/i18n-context";
import { Pagination } from "@/components/ui/pagination";
import { Activity, ChevronDown, KeyRound, MoreHorizontal, Pencil, Trash2, Wallet, Power, Users } from "lucide-react";

type ResellerOut = {
  id: number;
  parent_id?: number | null;
  username: string;
  role?: string;
  status: string;
  balance: number;
  price_per_gb: number;
  bundle_price_per_gb?: number | null;
  price_per_day?: number | null;
  can_create_subreseller?: boolean;
  user_policy?: ResellerUserPolicy | null;
};
type ResellerList = { items: ResellerOut[]; total: number };

type DeleteUserAction = "keep" | "disable" | "transfer";
type DeleteResellerPreview = {
  reseller_id: number;
  username: string;
  role: string;
  status: string;
  balance: number;
  users_total: number;
  users_active: number;
  users_disabled: number;
  users_deleted: number;
  active_orders: number;
  ledger_entries: number;
  allocations_total: number;
  api_tokens_active: number;
  requires_confirm: boolean;
  warnings: string[];
};

type ResellerUserPolicy = {
  enabled: boolean;
  allow_custom_days: boolean;
  allow_custom_traffic: boolean;
  allow_no_expire: boolean;
  allow_user_delete: boolean;
  allow_reset_usage: boolean;
  restrict_edit_to_renewal_only: boolean;
  renewal_policy: "reset_time_and_volume" | "add_time_and_volume" | "reset_time_carry_volume" | "reset_volume_carry_time";
  min_days: number;
  max_days: number;
  delete_refund_window_days: number;
  delete_expired_used_gb_limit: number;
  allowed_duration_presets: string[];
  allowed_traffic_gb: number[];
};

type NodeOut = {
  id: number;
  name: string;
  panel_type: string;
  base_url: string;
  is_enabled: boolean;
};
type NodeList = { items: NodeOut[]; total: number };

type AllocationOut = {
  id: number;
  reseller_id: number;
  node_id: number;
  enabled: boolean;
  default_for_reseller: boolean;
  price_per_gb_override?: number | null;
  credential_mode?: "shared" | "dedicated";
  credentials?: Record<string, unknown>;
};

type CredentialAuthType = "password" | "token";
type CredentialDraft = {
  mode: "shared" | "dedicated";
  authType: CredentialAuthType;
  username: string;
  password: string;
  token: string;
  autoImport: boolean;
};

type InitialNodeDraft = {
  selected: boolean;
  defaultForReseller: boolean;
  priceOverride: number | "";
  credential: CredentialDraft;
};

type ResellerAllocationSummaryItem = {
  id: number;
  reseller_id: number;
  node_id: number;
  node_name: string;
  panel_type: string;
  node_is_enabled: boolean;
  enabled: boolean;
  default_for_reseller: boolean;
  price_per_gb_override?: number | null;
};

type ResellerAllocationSummary = {
  reseller_id: number;
  reseller_name: string;
  reseller_status: string;
  allocations: ResellerAllocationSummaryItem[];
  nodes: Array<{ id: number; name: string; panel_type: string; is_enabled: boolean }>;
  active_panels_count: number;
};
type ResellerAllocationSummaryList = { items: ResellerAllocationSummary[]; total: number };

const ADMIN_FETCH_LIMIT = 200;
const DURATION_PRESET_OPTIONS = ["7d", "1m", "3m", "6m", "1y", "unlimited"];
const TRAFFIC_PRESET_OPTIONS = [20, 30, 50, 70, 100, 150, 200];

function emptyCredentialDraft(mode: "shared" | "dedicated" = "shared"): CredentialDraft {
  return {
    mode,
    authType: "password",
    username: "",
    password: "",
    token: "",
    autoImport: true,
  };
}

function emptyInitialNodeDraft(): InitialNodeDraft {
  return {
    selected: false,
    defaultForReseller: false,
    priceOverride: "",
    credential: emptyCredentialDraft(),
  };
}

function isImportSupported(panelType: string) {
  return panelType === "pasarguard" || panelType === "marzban";
}

function defaultUserPolicy(): ResellerUserPolicy {
  return {
    enabled: false,
    allow_custom_days: true,
    allow_custom_traffic: true,
    allow_no_expire: false,
    allow_user_delete: false,
    allow_reset_usage: false,
    restrict_edit_to_renewal_only: false,
    renewal_policy: "add_time_and_volume",
    min_days: 1,
    max_days: 3650,
    delete_refund_window_days: 10,
    delete_expired_used_gb_limit: 1,
    allowed_duration_presets: ["7d", "1m", "3m", "6m", "1y"],
    allowed_traffic_gb: [...TRAFFIC_PRESET_OPTIONS],
  };
}

function toggleString(list: string[], value: string, checked: boolean): string[] {
  const s = new Set(list);
  if (checked) s.add(value);
  else s.delete(value);
  return Array.from(s);
}

function toggleNumber(list: number[], value: number, checked: boolean): number[] {
  const s = new Set(list);
  if (checked) s.add(value);
  else s.delete(value);
  return Array.from(s).sort((a, b) => a - b);
}

function normalizePolicy(p: ResellerUserPolicy): ResellerUserPolicy {
  const out: ResellerUserPolicy = {
    enabled: !!p.enabled,
    allow_custom_days: !!p.allow_custom_days,
    allow_custom_traffic: !!p.allow_custom_traffic,
    allow_no_expire: !!p.allow_no_expire,
    allow_user_delete: !!p.allow_user_delete,
    allow_reset_usage: !!p.allow_reset_usage,
    restrict_edit_to_renewal_only: !!p.restrict_edit_to_renewal_only,
    renewal_policy: ["reset_time_and_volume", "add_time_and_volume", "reset_time_carry_volume", "reset_volume_carry_time"].includes(String(p.renewal_policy))
      ? (p.renewal_policy as ResellerUserPolicy["renewal_policy"])
      : "add_time_and_volume",
    min_days: Math.max(1, Number(p.min_days) || 1),
    max_days: Math.max(1, Number(p.max_days) || 3650),
    delete_refund_window_days: Math.max(0, Math.min(36500, Number(p.delete_refund_window_days ?? 10) || 0)),
    delete_expired_used_gb_limit: Math.max(0, Number(p.delete_expired_used_gb_limit ?? 1) || 0),
    allowed_duration_presets: Array.from(
      new Set(
        (p.allowed_duration_presets || [])
          .map((x) => String(x || "").trim().toLowerCase())
          .filter((x) => DURATION_PRESET_OPTIONS.includes(x))
      )
    ),
    allowed_traffic_gb: Array.from(
      new Set((p.allowed_traffic_gb || []).map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0))
    )
      .map((x) => Math.floor(x))
      .sort((a, b) => a - b),
  };
  if (out.max_days < out.min_days) out.max_days = out.min_days;
  if (!out.allow_no_expire) {
    out.allowed_duration_presets = out.allowed_duration_presets.filter((x) => x !== "unlimited");
  } else if (!out.allowed_duration_presets.includes("unlimited")) {
    out.allowed_duration_presets.push("unlimited");
  }
  if (!out.allowed_duration_presets.length) out.allowed_duration_presets = ["7d", "1m", "3m", "6m", "1y"];
  if (!out.allowed_traffic_gb.length) out.allowed_traffic_gb = [...TRAFFIC_PRESET_OPTIONS];
  return out;
}

function parseTrafficInput(raw: string): number[] {
  return Array.from(
    new Set(
      raw
        .split(/[,\s]+/g)
        .map((x) => Number(x.trim()))
        .filter((x) => Number.isFinite(x) && x > 0)
        .map((x) => Math.floor(x))
    )
  ).sort((a, b) => a - b);
}

async function fetchAllResellersForAdmin(maxPages = 50): Promise<ResellerOut[]> {
  const all: ResellerOut[] = [];
  let offset = 0;
  let total = 0;
  for (let i = 0; i < maxPages; i++) {
    const res = await apiFetch<ResellerList>(`/api/v1/admin/resellers?offset=${offset}&limit=${ADMIN_FETCH_LIMIT}`);
    const chunk = res.items || [];
    all.push(...chunk);
    total = res.total || all.length;
    if (!chunk.length || all.length >= total) break;
    offset += chunk.length;
  }
  return all;
}

async function fetchAllNodesForAdmin(maxPages = 50): Promise<NodeOut[]> {
  const all: NodeOut[] = [];
  let offset = 0;
  let total = 0;
  for (let i = 0; i < maxPages; i++) {
    const res = await apiFetch<NodeList>(`/api/v1/admin/nodes?offset=${offset}&limit=${ADMIN_FETCH_LIMIT}`);
    const chunk = res.items || [];
    all.push(...chunk);
    total = res.total || all.length;
    if (!chunk.length || all.length >= total) break;
    offset += chunk.length;
  }
  return all;
}

function statusBadgeVariant(s: string): "success" | "danger" | "muted" | "warning" {
  if (s === "active") return "success";
  if (s === "disabled") return "danger";
  if (s === "deleted") return "muted";
  return "warning";
}

function hasLifecyclePolicies(policy: ResellerUserPolicy): boolean {
  return (
    !!policy.allow_user_delete ||
    !!policy.allow_reset_usage ||
    !!policy.restrict_edit_to_renewal_only ||
    policy.renewal_policy !== "add_time_and_volume"
  );
}

function pickLifecyclePolicies(policy: ResellerUserPolicy) {
  return {
    allow_user_delete: !!policy.allow_user_delete,
    allow_reset_usage: !!policy.allow_reset_usage,
    restrict_edit_to_renewal_only: !!policy.restrict_edit_to_renewal_only,
    renewal_policy: policy.renewal_policy,
    delete_refund_window_days: policy.delete_refund_window_days,
    delete_expired_used_gb_limit: policy.delete_expired_used_gb_limit,
  };
}

function allocationSummaryVariant(a: ResellerAllocationSummaryItem): "default" | "success" | "warning" | "danger" | "muted" {
  if (!a.node_is_enabled) return "danger";
  if (!a.enabled) return "muted";
  if (a.default_for_reseller) return "success";
  return "default";
}

function durationPresetLabel(preset: string, lang: string): string {
  const en = lang === "en";
  if (preset === "7d") return en ? "7 days" : `${formatNumberWithDigits(7)} روز`;
  if (preset === "1m") return en ? "1 month" : `${formatNumberWithDigits(1)} ماه`;
  if (preset === "3m") return en ? "3 months" : `${formatNumberWithDigits(3)} ماه`;
  if (preset === "6m") return en ? "6 months" : `${formatNumberWithDigits(6)} ماه`;
  if (preset === "1y") return en ? "1 year" : `${formatNumberWithDigits(1)} سال`;
  return en ? "Unlimited" : "نامحدود";
}

function policySummary(policy: ResellerUserPolicy | null | undefined, lang: string): string {
  const en = lang === "en";
  if (!policy) return en ? "Global policy" : "سیاست سراسری";
  if (!policy.enabled) return en ? "Custom: no creation limits" : "اختصاصی: بدون محدودیت ساخت";
  const p = normalizePolicy(policy);
  const daysMode = p.allow_custom_days ? (en ? "Manual days: on" : "روز دستی: روشن") : (en ? "Manual days: off" : "روز دستی: خاموش");
  const trafficMode = p.allow_custom_traffic ? (en ? "Manual traffic: on" : "حجم دستی: روشن") : `${en ? "Traffic" : "حجم‌ها"}: ${p.allowed_traffic_gb.join(", ")}`;
  return `${daysMode} | ${trafficMode} | ${en ? "Day range" : "بازه روز"}: ${p.min_days}-${p.max_days}`;
}

function resellerDeleteWarningText(warning: string, lang: string): string {
  const table: Record<string, { fa: string; en: string }> = {
    "Reseller has non-zero balance.": { fa: "این رسیلر موجودی غیرصفر دارد.", en: "This reseller has a non-zero balance." },
    "Reseller has active users.": { fa: "این رسیلر کاربر فعال دارد.", en: "This reseller has active users." },
    "Reseller has users in Guardino.": { fa: "برای این رسیلر کاربر در گاردینو ثبت شده است.", en: "This reseller has users registered in Guardino." },
    "Reseller has financial history; it will be preserved.": { fa: "این رسیلر سابقه مالی دارد و این سابقه حفظ می‌شود.", en: "This reseller has financial history and it will be preserved." },
  };
  const translated = table[warning];
  if (translated) return lang === "en" ? translated.en : translated.fa;
  return warning;
}

export default function AdminResellersPage() {
  const { push } = useToast();
  const { t, lang } = useI18n();
  const router = useRouter();
  const isEn = lang === "en";
  const copy = React.useMemo(
    () =>
      isEn
        ? {
            eyebrow: "Reseller Operations",
            quickManage: "Quick reseller management",
            pageResellers: "Resellers on this page",
            active: "Active",
            disabled: "Disabled",
            pageBalance: "Total balance on page",
            customPolicies: "Custom reseller policies",
            customPoliciesHint: "When off, global super-admin settings apply. When on, this box overrides the global policies.",
            custom: "Custom",
            global: "Global",
            noCustomPolicy: "No custom policy is saved for this reseller; delete/refund, reset usage, edit/renewal and creation limits are read from global settings.",
            creditGuide: "Use Increase to add balance and Decrease to subtract it. Always enter a positive amount; Guardino applies the sign and prevents negative reseller balance.",
            creditIncrease: "Increase",
            creditDecrease: "Decrease",
            applyDecrease: "Apply decrease",
            deleteTitle: "Delete reseller",
            deleteWarning: "Deleting a reseller only hides and disables the account in the admin panel. Financial history, orders and reports are preserved.",
            balance: "Balance",
            activeUsers: "Active users",
            totalUsers: "Total users",
            ledger: "Ledger",
            deleteUserBehavior: "User behavior after deleting this reseller",
            keepUsers: "Keep users assigned to this reseller in the database and do not change their status.",
            disableUsers: "Disable this reseller's active users in Guardino.",
            transferUsers: "Transfer non-deleted active and disabled users to another reseller.",
            pickTransfer: "Select destination reseller",
            transferTargetRequired: "Select a destination reseller to transfer users.",
            balanceDecreased: "Balance decreased",
            panelDefaultsApplied: "Based on panel defaults",
            applyPanelDefaults: "Apply panel defaults",
            userPolicyTitle: "User creation policy for this reseller",
            userPolicyDesc: "When enabled, this reseller can use only the specified duration and traffic packages.",
            policyGuide:
              "This is the reseller's custom policy and it overrides the global policy. Duration and traffic limits are checked while creating users. If package-only renewal is enabled, editing stays limited to package renewals. In delete policy, 0 for usage means unlimited and 0.5 means about 500 MB. Users whose time or total traffic is exhausted cannot be deleted, and usage below 1 GB is not deducted from the wallet during user deletion.",
            durationPackages: "Allowed duration packages",
            trafficPackages: "Allowed traffic packages (GB)",
            trafficPlaceholder: "Example: 20, 30, 50, 100",
            dayControl: "Day and duration controls",
            allowManualDays: "Allow manual days",
            minDays: "Minimum days",
            maxDays: "Maximum days",
            extraSettings: "Additional settings",
            allowManualTraffic: "Allow manual traffic",
            allowUnlimitedPlan: "Allow unlimited plan",
            noCreationLimit: "When disabled, no duration or traffic limit is applied.",
            lifecycleTitle: "Delete, reset, edit and renewal policies",
            lifecycleDesc: "This section is off by default. If the global panel settings are enabled, applying panel defaults or enabling this checkbox will copy those values into the form.",
            enableLifecycle: "Enable delete, reset, edit and renewal policies",
            enableLifecycleDesc: "When off, these permissions are not saved as enabled for this reseller. When on, each permission can be configured separately.",
            lifecycleDisabledHint: "Delete/refund, reset usage, edit restrictions and custom renewal policy are saved as off for this reseller unless you apply global defaults or enable this section manually.",
            allowDeleteRefund: "Allow user delete and refund",
            allowDeleteRefundDesc: "When enabled, the reseller can delete a user and receive the refundable amount within the time and usage limits.",
            refundWindowShort: "Delete/refund window (days)",
            allowedDaysPlaceholder: "Allowed days",
            usageLimitShort: "Allowed usage limit (GB)",
            usageLimitPlaceholder: "Usage limit GB",
            zeroUnlimited: "0 for window or usage limit means no limit for that part.",
            allowResetUsage: "Allow usage reset",
            allowResetUsageDesc: "When off, the reseller cannot reset a user's usage even if they can view the user or manage links.",
            renewalOnly: "Edit only through package renewal",
            renewalOnlyDesc: "When enabled, separate traffic/time increase or decrease is blocked and the reseller only renews by package.",
            customRenewalPolicy: "Custom renewal policy",
            customRenewalPolicyDesc: "When enabled, the time and traffic merge behavior is set for this reseller.",
            resetTimeAndVolume: "Reset time and volume",
            addTimeAndVolume: "Add time and volume to the next period",
            resetTimeCarryVolume: "Reset time and carry previous remaining traffic",
            resetVolumeCarryTime: "Reset traffic and carry previous remaining time",
            resellerAllocations: "This reseller's allocations",
            resellerAllocationsDesc: "Summary of nodes and connected panel status for this reseller. Full management is available from the allocations page.",
            manageAllocations: "Manage allocations",
            assignedNodes: "Assigned nodes",
            activeAllocations: "Active allocations",
            activePanels: "Active panels",
            noAllocations: "No allocations",
            tableUserPolicy: "User creation policy",
          }
        : {
            eyebrow: "عملیات رسیلرها",
            quickManage: "مدیریت سریع نماینده‌ها",
            pageResellers: "نماینده‌های صفحه",
            active: "فعال",
            disabled: "غیرفعال",
            pageBalance: "موجودی کل (صفحه)",
            customPolicies: "سیاست‌های اختصاصی رسیلر",
            customPoliciesHint: "خاموش باشد، تنظیمات سراسری سوپرادمین اعمال می‌شود. روشن باشد، تنظیمات همین باکس روی سیاست‌های کلی اولویت دارد.",
            custom: "اختصاصی",
            global: "سراسری",
            noCustomPolicy: "برای این رسیلر تنظیم اختصاصی ذخیره نمی‌شود و سیاست حذف/ریفاند، ریست مصرف، ویرایش/تمدید و محدودیت ساخت از بخش تنظیمات سراسری سوپرادمین خوانده می‌شود.",
            creditGuide: "برای افزایش موجودی حالت «افزایش» و برای کم کردن موجودی حالت «کاهش» را انتخاب کنید. مبلغ را همیشه مثبت وارد کنید؛ سیستم خودش علامت را اعمال می‌کند و اجازه منفی شدن موجودی رسیلر را نمی‌دهد.",
            creditIncrease: "افزایش",
            creditDecrease: "کاهش",
            applyDecrease: "اعمال کاهش",
            deleteTitle: "حذف رسیلر",
            deleteWarning: "حذف رسیلر فقط حساب او را از پنل مدیریت مخفی و غیرفعال می‌کند؛ سابقه مالی، سفارش‌ها و گزارش‌ها حذف نمی‌شوند.",
            balance: "موجودی",
            activeUsers: "کاربران فعال",
            totalUsers: "کل کاربران",
            ledger: "دفترکل",
            deleteUserBehavior: "رفتار کاربران این رسیلر بعد از حذف",
            keepUsers: "کاربران در دیتابیس برای همین رسیلر باقی بمانند و وضعیتشان تغییر نکند.",
            disableUsers: "کاربران فعال این رسیلر در گاردینو غیرفعال شوند.",
            transferUsers: "کاربران فعال و غیرفعال حذف‌نشده به رسیلر دیگری منتقل شوند.",
            pickTransfer: "انتخاب رسیلر مقصد",
            transferTargetRequired: "برای انتقال کاربران، رسیلر مقصد را انتخاب کنید.",
            balanceDecreased: "موجودی کم شد",
            panelDefaultsApplied: "بر اساس تنظیمات پیش‌فرض پنل",
            applyPanelDefaults: "اعمال تنظیمات پیش‌فرض پنل",
            userPolicyTitle: "سیاست ساخت کاربر برای رسیلر",
            userPolicyDesc: "با فعال‌سازی این بخش، رسیلر فقط از بسته‌های زمانی/حجمی مشخص‌شده می‌تواند استفاده کند.",
            policyGuide:
              "این بخش سیاست اختصاصی همین رسیلر است و روی سیاست سراسری اولویت دارد. محدودیت روز/حجم هنگام ساخت کنترل می‌شود و اگر گزینه «فقط تمدید بسته‌ای» روشن باشد، در ویرایش فقط تمدید طبق پکیج‌های آماده مجاز می‌ماند. در سیاست حذف، عدد 0 برای حد مصرف یعنی نامحدود؛ عدد 0.5 یعنی حدود 500 مگابایت. کاربری که زمانش تمام شده یا کل حجمش مصرف شده باشد قابل حذف نیست، و در حذف کاربر، مصرف زیر 1 گیگ از کیف پول کم نمی‌شود.",
            durationPackages: "بسته‌های زمانی مجاز",
            trafficPackages: "حجم‌های مجاز (GB)",
            trafficPlaceholder: "مثال: 20, 30, 50, 100",
            dayControl: "کنترل روز و مدت‌زمان",
            allowManualDays: "اجازه روز دستی",
            minDays: "حداقل روز",
            maxDays: "حداکثر روز",
            extraSettings: "تنظیمات تکمیلی",
            allowManualTraffic: "اجازه حجم دستی",
            allowUnlimitedPlan: "اجازه پلن نامحدود",
            noCreationLimit: "در حالت غیرفعال، محدودیتی برای روز/حجم اعمال نمی‌شود.",
            lifecycleTitle: "سیاست‌های حذف، ریست، ویرایش و تمدید",
            lifecycleDesc: "این بخش به صورت پیش‌فرض خاموش است. اگر در تنظیمات سراسری پنل فعال شده باشد، با روشن کردن سیاست اختصاصی یا این checkbox همان مقدارها روی فرم می‌نشیند.",
            enableLifecycle: "فعال‌سازی سیاست‌های حذف، ریست، ویرایش و تمدید",
            enableLifecycleDesc: "خاموش باشد، این مجوزها برای این رسیلر فعال ذخیره نمی‌شوند. روشن باشد، می‌توانی هر گزینه را جدا تنظیم کنی.",
            lifecycleDisabledHint: "حذف/ریفاند، ریست مصرف، محدودیت ویرایش و سیاست تمدید اختصاصی برای این رسیلر خاموش ذخیره می‌شوند؛ مگر اینکه پیش‌فرض سراسری را اعمال یا این بخش را دستی روشن کنی.",
            allowDeleteRefund: "اجازه حذف و ریفاند کاربر",
            allowDeleteRefundDesc: "اگر روشن باشد رسیلر می‌تواند طبق مهلت و سقف مصرف، کاربر را حذف و مبلغ قابل برگشت را دریافت کند.",
            refundWindowShort: "مهلت حذف/ریفاند (روز)",
            allowedDaysPlaceholder: "روز مجاز",
            usageLimitShort: "حد مصرف مجاز (GB)",
            usageLimitPlaceholder: "حد مصرف GB",
            zeroUnlimited: "عدد 0 برای مهلت یا حد مصرف یعنی بدون محدودیت آن بخش.",
            allowResetUsage: "اجازه ریست مصرف",
            allowResetUsageDesc: "اگر خاموش باشد رسیلر نمی‌تواند مصرف کاربر را صفر کند، حتی اگر کاربر را ببیند یا لینک‌ها را مدیریت کند.",
            renewalOnly: "ویرایش فقط از مسیر تمدید بسته‌ای",
            renewalOnlyDesc: "اگر روشن باشد افزایش/کاهش حجم یا زمان جداگانه بسته می‌شود و رسیلر فقط تمدید پکیجی انجام می‌دهد.",
            customRenewalPolicy: "سیاست تمدید اختصاصی",
            customRenewalPolicyDesc: "اگر روشن باشد نحوه ترکیب زمان و حجم در تمدید برای همین رسیلر مشخص می‌شود.",
            resetTimeAndVolume: "ریست زمان و حجم",
            addTimeAndVolume: "اضافه شدن زمان و حجم به دوره بعد",
            resetTimeCarryVolume: "ریست زمان و اضافه شدن حجم باقی‌مانده قبلی",
            resetVolumeCarryTime: "ریست حجم و اضافه شدن زمان باقی‌مانده قبلی",
            resellerAllocations: "تخصیص‌های این رسیلر",
            resellerAllocationsDesc: "خلاصه نودها و وضعیت پنل‌های متصل به این رسیلر. مدیریت کامل از صفحه تخصیص‌ها انجام می‌شود.",
            manageAllocations: "مدیریت تخصیص‌ها",
            assignedNodes: "نودهای اختصاص‌داده‌شده",
            activeAllocations: "تخصیص فعال",
            activePanels: "پنل‌های فعال",
            noAllocations: "بدون تخصیص",
            tableUserPolicy: "سیاست ساخت کاربر",
          },
    [isEn]
  );

  const [items, setItems] = React.useState<ResellerOut[]>([]);
  const [creditOptions, setCreditOptions] = React.useState<ResellerOut[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(50);
  const [q, setQ] = React.useState("");

  const [editingId, setEditingId] = React.useState<number | null>(null);
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [parentId, setParentId] = React.useState<number | "">("");
  const [priceGb, setPriceGb] = React.useState<number>(0);
  const [bundleGb, setBundleGb] = React.useState<number>(0);
  const [priceDay, setPriceDay] = React.useState<number>(0);
  const [canCreateSub, setCanCreateSub] = React.useState(true);
  const [nodes, setNodes] = React.useState<NodeOut[]>([]);
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const [initialNodeDrafts, setInitialNodeDrafts] = React.useState<Record<number, InitialNodeDraft>>({});
  const [useCustomPolicy, setUseCustomPolicy] = React.useState(false);
  const [globalPolicy, setGlobalPolicy] = React.useState<ResellerUserPolicy>(defaultUserPolicy());
  const [userPolicy, setUserPolicy] = React.useState<ResellerUserPolicy>(defaultUserPolicy());
  const [trafficInput, setTrafficInput] = React.useState(TRAFFIC_PRESET_OPTIONS.join(", "));
  const [policyDefaultApplied, setPolicyDefaultApplied] = React.useState(false);
  const [policyTouched, setPolicyTouched] = React.useState(false);
  const [lifecyclePolicyEnabled, setLifecyclePolicyEnabled] = React.useState(false);
  const [lifecyclePolicyTouched, setLifecyclePolicyTouched] = React.useState(false);

  const [creditId, setCreditId] = React.useState<number | "">("");
  const [creditQuery, setCreditQuery] = React.useState("");
  const [creditAmount, setCreditAmount] = React.useState<number>(10000);
  const [creditMode, setCreditMode] = React.useState<"credit" | "debit">("credit");
  const [creditBusy, setCreditBusy] = React.useState(false);

  const [confirmDelete, setConfirmDelete] = React.useState<ResellerOut | null>(null);
  const [deletePreview, setDeletePreview] = React.useState<DeleteResellerPreview | null>(null);
  const [deleteUserAction, setDeleteUserAction] = React.useState<DeleteUserAction>("keep");
  const [deleteTransferId, setDeleteTransferId] = React.useState<number | "">("");
  const [confirmToggleStatus, setConfirmToggleStatus] = React.useState<{ r: ResellerOut; to: "active" | "disabled" } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [editingAllocationSummary, setEditingAllocationSummary] = React.useState<ResellerAllocationSummary | null>(null);

  function applyGlobalPolicyDefaults() {
    const p = normalizePolicy(globalPolicy || defaultUserPolicy());
    setUserPolicy(p);
    setTrafficInput((p.allowed_traffic_gb || []).join(", "));
    setLifecyclePolicyEnabled(hasLifecyclePolicies(p));
    setLifecyclePolicyTouched(false);
    setPolicyDefaultApplied(true);
    setPolicyTouched(false);
  }

  function updateUserPolicy(next: ResellerUserPolicy | ((current: ResellerUserPolicy) => ResellerUserPolicy)) {
    setUserPolicy((current) => {
      const value = typeof next === "function" ? next(current) : next;
      return normalizePolicy(value);
    });
    setPolicyTouched(true);
    setPolicyDefaultApplied(false);
  }

  function updateLifecyclePolicy(next: ResellerUserPolicy | ((current: ResellerUserPolicy) => ResellerUserPolicy)) {
    setUserPolicy((current) => {
      const value = normalizePolicy(typeof next === "function" ? next(current) : next);
      return value;
    });
    setLifecyclePolicyEnabled(true);
    setLifecyclePolicyTouched(true);
    setPolicyTouched(true);
    setPolicyDefaultApplied(false);
  }

  function handleLifecyclePolicyToggle(checked: boolean) {
    setLifecyclePolicyEnabled(checked);
    if (checked) {
      if (!lifecyclePolicyTouched) {
        const p = normalizePolicy({ ...userPolicy, ...pickLifecyclePolicies(globalPolicy) });
        setUserPolicy(p);
        setPolicyDefaultApplied(true);
      }
      return;
    }
    setUserPolicy((current) =>
      normalizePolicy({
        ...current,
        allow_user_delete: false,
        allow_reset_usage: false,
        restrict_edit_to_renewal_only: false,
        renewal_policy: "add_time_and_volume",
      })
    );
    setLifecyclePolicyTouched(true);
    setPolicyTouched(true);
    setPolicyDefaultApplied(false);
  }

  function handleCustomPolicyToggle(checked: boolean) {
    setUseCustomPolicy(checked);
    if (checked && !policyTouched) {
      applyGlobalPolicyDefaults();
    }
    if (!checked) {
      setPolicyDefaultApplied(false);
      setLifecyclePolicyEnabled(false);
      setLifecyclePolicyTouched(false);
    }
  }

  function resetForm() {
    setEditingId(null);
    setUsername("");
    setPassword("");
    setParentId("");
    setPriceGb(0);
    setBundleGb(0);
    setPriceDay(0);
    setCanCreateSub(true);
    setAdvancedOpen(false);
    setInitialNodeDrafts((prev) => {
      const next: Record<number, InitialNodeDraft> = {};
      nodes.forEach((n) => {
        next[n.id] = { ...(prev[n.id] || emptyInitialNodeDraft()), selected: false, defaultForReseller: false, priceOverride: "", credential: emptyCredentialDraft() };
      });
      return next;
    });
    setUseCustomPolicy(false);
    const p = defaultUserPolicy();
    setUserPolicy(p);
    setTrafficInput(p.allowed_traffic_gb.join(", "));
    setPolicyDefaultApplied(false);
    setPolicyTouched(false);
    setLifecyclePolicyEnabled(false);
    setLifecyclePolicyTouched(false);
    setEditingAllocationSummary(null);
  }

  async function load(nextPage: number = page, nextPageSize: number = pageSize) {
    try {
      const offset = (nextPage - 1) * nextPageSize;
      const res = await apiFetch<ResellerList>(`/api/v1/admin/resellers?offset=${offset}&limit=${nextPageSize}`);
      setItems(res.items || []);
      setTotal(res.total || 0);
      const safeTotal = res.total || 0;
      if ((res.items || []).length === 0 && safeTotal > 0 && offset >= safeTotal) {
        const lastPage = Math.max(1, Math.ceil(safeTotal / nextPageSize));
        if (lastPage !== nextPage) setPage(lastPage);
      }
    } catch (e: any) {
      push({ title: t("common.error"), desc: String(e.message || e), type: "error" });
    }
  }

  async function loadCreditOptions() {
    try {
      const all = await fetchAllResellersForAdmin();
      setCreditOptions(all.filter((x) => x.status !== "deleted"));
    } catch (e: any) {
      push({ title: t("common.error"), desc: String(e.message || e), type: "error" });
    }
  }

  async function loadGlobalPolicy() {
    try {
      const p = await apiFetch<ResellerUserPolicy>("/api/v1/admin/settings/user-policy");
      setGlobalPolicy(normalizePolicy(p));
    } catch (e: any) {
      push({ title: t("common.error"), desc: String(e.message || e), type: "error" });
    }
  }

  async function loadNodesForCreate() {
    try {
      const all = await fetchAllNodesForAdmin();
      setNodes(all);
      setInitialNodeDrafts((prev) => {
        const next: Record<number, InitialNodeDraft> = {};
        all.forEach((n) => {
          next[n.id] = prev[n.id] || emptyInitialNodeDraft();
        });
        return next;
      });
    } catch (e: any) {
      push({ title: t("common.error"), desc: String(e.message || e), type: "error" });
    }
  }

  async function loadAllocationSummary(resellerId: number) {
    try {
      const params = new URLSearchParams({ offset: "0", limit: "1000", q: String(resellerId) });
      const res = await apiFetch<ResellerAllocationSummaryList>(`/api/v1/admin/resellers/allocations/grouped?${params.toString()}`);
      setEditingAllocationSummary((res.items || []).find((x) => x.reseller_id === resellerId) || null);
    } catch {
      setEditingAllocationSummary(null);
    }
  }


  function updateInitialNodeDraft(nodeId: number, patch: Partial<InitialNodeDraft>) {
    setInitialNodeDrafts((prev) => ({
      ...prev,
      [nodeId]: {
        ...(prev[nodeId] || emptyInitialNodeDraft()),
        ...patch,
      },
    }));
  }

  function updateInitialNodeCredential(nodeId: number, patch: Partial<CredentialDraft>) {
    setInitialNodeDrafts((prev) => {
      const current = prev[nodeId] || emptyInitialNodeDraft();
      return {
        ...prev,
        [nodeId]: {
          ...current,
          credential: {
            ...current.credential,
            ...patch,
          },
        },
      };
    });
  }

  function credentialsFromDraft(draft: CredentialDraft): Record<string, unknown> | null {
    if (draft.mode === "shared") return {};
    if (draft.authType === "token") {
      const token = draft.token.trim();
      if (!token) {
        push({ title: t("common.error"), desc: t("adminAllocations.errCredentials"), type: "error" });
        return null;
      }
      return { token };
    }
    const username = draft.username.trim();
    const password = draft.password;
    if (!username || !password) {
      push({ title: t("common.error"), desc: t("adminAllocations.errCredentials"), type: "error" });
      return null;
    }
    return { username, password };
  }

  function selectedInitialNodeRows() {
    return nodes
      .map((node) => ({ node, draft: initialNodeDrafts[node.id] || emptyInitialNodeDraft() }))
      .filter(({ draft }) => draft.selected);
  }

  async function createSelectedAllocationsForReseller(resellerId: number) {
    const selected = selectedInitialNodeRows();
    if (!selected.length) return;
    const hasDefault = selected.some(({ draft }) => draft.defaultForReseller);

    for (const row of selected) {
      const credentials = credentialsFromDraft(row.draft.credential);
      if (!credentials) throw new Error(t("adminAllocations.errCredentials"));
      const created = await apiFetch<AllocationOut>("/api/v1/admin/allocations", {
        method: "POST",
        body: JSON.stringify({
          reseller_id: resellerId,
          node_id: row.node.id,
          enabled: true,
          default_for_reseller: row.draft.defaultForReseller || (!hasDefault && selected[0].node.id === row.node.id),
          price_per_gb_override: row.draft.priceOverride === "" ? null : Number(row.draft.priceOverride),
          credential_mode: row.draft.credential.mode,
          credentials: row.draft.credential.mode === "dedicated" ? credentials : {},
        }),
      });

      if (row.draft.credential.mode === "dedicated" && row.draft.credential.autoImport && isImportSupported(row.node.panel_type)) {
        try {
          await apiFetch(`/api/v1/admin/allocations/${created.id}/import-users`, {
            method: "POST",
            body: JSON.stringify({ dry_run: false, limit: 500, offset: 0, skip_existing: true }),
          });
        } catch (e: any) {
          push({ title: t("common.warn"), desc: `${row.node.name}: ${String(e.message || e)}`, type: "warning" });
        }
      }
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
            user_policy: useCustomPolicy ? normalizePolicy(userPolicy) : null,
          }),
        });
        push({ title: t("adminResellers.created"), desc: `ID: ${res.id}`, type: "success" });
        const selectedAllocations = selectedInitialNodeRows();
        if (selectedAllocations.length) {
          try {
            await createSelectedAllocationsForReseller(res.id);
            push({ title: t("adminResellers.assignedSelectedNodes"), desc: t("adminResellers.assignedSelectedNodesDesc"), type: "success" });
          } catch {
            push({ title: t("common.warn"), desc: t("adminResellers.selectedAllocationsWarn"), type: "warning" });
          }
        }
        resetForm();
        setQ("");
        if (page !== 1) setPage(1);
        await Promise.all([load(1, pageSize), loadCreditOptions()]);
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
            user_policy: useCustomPolicy ? normalizePolicy(userPolicy) : null,
          }),
        });
        push({ title: t("adminResellers.saved"), desc: `ID: ${res.id}`, type: "success" });
        await Promise.all([load(page, pageSize), loadCreditOptions()]);
        resetForm();
      }
    } catch (e: any) {
      push({ title: t("common.error"), desc: String(e.message || e), type: "error" });
    }
  }

  async function startEdit(x: ResellerOut) {
    try {
      const detail = await apiFetch<ResellerOut>(`/api/v1/admin/resellers/${x.id}`);
      setEditingId(detail.id);
      setUsername(detail.username);
      setPassword("");
      setParentId(detail.parent_id ?? "");
      setPriceGb(detail.price_per_gb ?? 0);
      setBundleGb((detail.bundle_price_per_gb ?? 0) as number);
      setPriceDay((detail.price_per_day ?? 0) as number);
      setCanCreateSub(detail.can_create_subreseller ?? true);
      setUseCustomPolicy(!!detail.user_policy);
      const p = normalizePolicy(detail.user_policy || defaultUserPolicy());
      setUserPolicy(p);
      setTrafficInput((p.allowed_traffic_gb || []).join(", "));
      setLifecyclePolicyEnabled(hasLifecyclePolicies(p));
      setLifecyclePolicyTouched(false);
      setPolicyDefaultApplied(false);
      setPolicyTouched(!!detail.user_policy);
      await loadAllocationSummary(detail.id);
    } catch (e: any) {
      push({ title: t("common.error"), desc: String(e.message || e), type: "error" });
    }
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
      await Promise.all([load(page, pageSize), loadCreditOptions()]);
    } catch (e: any) {
      push({ title: t("common.error"), desc: String(e.message || e), type: "error" });
    }
  }

  async function openDeleteReseller(x: ResellerOut) {
    setConfirmDelete(x);
    setDeletePreview(null);
    setDeleteUserAction("keep");
    setDeleteTransferId("");
    try {
      const preview = await apiFetch<DeleteResellerPreview>(`/api/v1/admin/resellers/${x.id}/delete-preview`);
      setDeletePreview(preview);
    } catch (e: any) {
      push({ title: t("common.error"), desc: String(e.message || e), type: "error" });
    }
  }

  async function del(x: ResellerOut) {
    try {
      if (deleteUserAction === "transfer" && deleteTransferId === "") {
        throw new Error(copy.transferTargetRequired);
      }
      await apiFetch<ResellerOut>(`/api/v1/admin/resellers/${x.id}`, {
        method: "DELETE",
        body: JSON.stringify({
          confirm: true,
          user_action: deleteUserAction,
          transfer_to_reseller_id: deleteUserAction === "transfer" ? Number(deleteTransferId) : null,
        }),
      });
      push({ title: t("adminResellers.deleted"), desc: x.username, type: "success" });
      await Promise.all([load(page, pageSize), loadCreditOptions()]);
    } catch (e: any) {
      push({ title: t("common.error"), desc: String(e.message || e), type: "error" });
    }
  }

  async function credit() {
    if (creditBusy) return; // prevent double-submit / double-charge
    setCreditBusy(true);
    try {
      if (creditId === "") throw new Error(t("adminResellers.errCreditId"));
      const rawAmount = Math.abs(Number(creditAmount) || 0);
      if (rawAmount <= 0) throw new Error("Amount must be greater than zero");
      const signedAmount = creditMode === "debit" ? -rawAmount : rawAmount;
      const res = await apiFetch<any>(`/api/v1/admin/resellers/${Number(creditId)}/credit`, {
        method: "POST",
        body: JSON.stringify({
          amount: signedAmount,
          reason: creditMode === "debit" ? "manual_debit" : "manual_credit",
          request_id: newRequestId(),
        }),
      });
      push({ title: creditMode === "debit" ? copy.balanceDecreased : t("adminResellers.credited"), desc: `balance=${fmtNumber(res.balance)}`, type: "success" });
      await Promise.all([load(page, pageSize), loadCreditOptions()]);
    } catch (e: any) {
      push({ title: t("common.error"), desc: String(e.message || e), type: "error" });
    } finally {
      setCreditBusy(false);
    }
  }

  const filtered = items.filter((x) => {
    const s = `${x.id} ${x.username} ${x.role || ""} ${x.status} ${x.balance}`.toLowerCase();
    return s.includes(q.toLowerCase());
  });

  React.useEffect(() => {
    load(page, pageSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize]);

  React.useEffect(() => {
    loadCreditOptions();
    loadGlobalPolicy();
    loadNodesForCreate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (!useCustomPolicy || !policyDefaultApplied || policyTouched) return;
    const p = normalizePolicy(globalPolicy);
    setUserPolicy(p);
    setTrafficInput((p.allowed_traffic_gb || []).join(", "));
    setLifecyclePolicyEnabled(hasLifecyclePolicies(p));
    setLifecyclePolicyTouched(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalPolicy]);

  React.useEffect(() => {
    setTrafficInput((userPolicy.allowed_traffic_gb || []).join(", "));
  }, [userPolicy.allowed_traffic_gb]);
  const selectClass =
    "h-10 w-full rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(155deg,hsl(var(--surface-input-1))_0%,hsl(var(--surface-input-2))_58%,hsl(var(--surface-input-3))_100%)] px-3 text-sm outline-none transition-all duration-200 hover:border-[hsl(var(--accent)/0.35)] focus:ring-2 focus:ring-[hsl(var(--accent)/0.35)]";
  const guideBoxClass =
    "max-w-full overflow-hidden break-words [overflow-wrap:anywhere] rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-3))]/60 p-3 text-xs leading-6 text-[hsl(var(--fg))]/75";
  const metricCardClass =
    "rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(155deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] p-3 shadow-[0_10px_22px_-20px_hsl(var(--fg)/0.6)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[hsl(var(--accent)/0.35)]";
  const policyCheckCardClass =
    "rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-2))] p-3 transition-all duration-200 hover:border-[hsl(var(--accent)/0.35)]";
  const policyCheckLabelClass = "flex items-start gap-2 text-sm font-medium text-[hsl(var(--fg))]/90";
  const policyDescClass = "mt-1 text-xs leading-6 text-[hsl(var(--fg))]/65";
  const customRenewalPolicyEnabled = userPolicy.renewal_policy !== "add_time_and_volume";
  const stats = React.useMemo(() => {
    const active = items.filter((x) => x.status === "active").length;
    const disabled = items.filter((x) => x.status === "disabled").length;
    const totalBalance = items.reduce((acc, x) => acc + Number(x.balance || 0), 0);
    return {
      count: items.length,
      active,
      disabled,
      totalBalance,
    };
  }, [items]);
  const editingAllocations = editingAllocationSummary?.allocations || [];
  const editingActiveAllocationCount = editingAllocations.filter((a) => a.enabled && a.node_is_enabled).length;
  const initialSelectedCount = nodes.reduce((sum, node) => sum + (initialNodeDrafts[node.id]?.selected ? 1 : 0), 0);

  function renderInitialCredentialEditor(node: NodeOut, draft: InitialNodeDraft) {
    const credential = draft.credential;
    if (credential.mode === "shared") {
      return (
        <div className={guideBoxClass}>
          {t("adminAllocations.sharedHint")}
        </div>
      );
    }
    return (
      <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-2))] p-3">
        <div className="grid gap-2 md:grid-cols-[170px_minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-1">
            <div className="text-xs text-[hsl(var(--fg))]/65">{t("adminAllocations.authMethod")}</div>
            <select className={selectClass} value={credential.authType} onChange={(e) => updateInitialNodeCredential(node.id, { authType: e.target.value as CredentialAuthType })}>
              <option value="password">{t("adminAllocations.authPassword")}</option>
              <option value="token">{t("adminAllocations.authToken")}</option>
            </select>
          </div>
          {credential.authType === "password" ? (
            <>
              <div className="space-y-1">
                <div className="text-xs text-[hsl(var(--fg))]/65">{t("common.username")}</div>
                <Input value={credential.username} onChange={(e) => updateInitialNodeCredential(node.id, { username: e.target.value })} autoComplete="off" />
              </div>
              <div className="space-y-1">
                <div className="text-xs text-[hsl(var(--fg))]/65">{t("common.password")}</div>
                <PasswordInput value={credential.password} onChange={(e) => updateInitialNodeCredential(node.id, { password: e.target.value })} autoComplete="new-password" />
              </div>
            </>
          ) : (
            <div className="space-y-1 md:col-span-2">
              <div className="text-xs text-[hsl(var(--fg))]/65">{t("common.token")}</div>
              <PasswordInput value={credential.token} onChange={(e) => updateInitialNodeCredential(node.id, { token: e.target.value })} autoComplete="off" />
            </div>
          )}
        </div>
        {isImportSupported(node.panel_type) ? (
          <label className="mt-3 flex items-start gap-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] px-3 py-2 text-xs leading-5 text-[hsl(var(--fg))]/75">
            <Switch checked={credential.autoImport} onCheckedChange={(v) => updateInitialNodeCredential(node.id, { autoImport: v })} />
            <span>{t("adminAllocations.autoImportHint")}</span>
          </label>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(112deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] p-4 shadow-[0_15px_28px_-20px_hsl(var(--fg)/0.35)] sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] px-3 py-1 text-xs text-[hsl(var(--fg))]/75">
              <Users size={13} />
              {copy.eyebrow}
            </div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight">{t("adminResellers.title")}</h1>
            <p className="mt-1 text-sm text-[hsl(var(--fg))]/70">{t("adminResellers.subtitle")}</p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(130deg,hsl(var(--accent)/0.16),hsl(var(--surface-card-1)))] px-3 py-2 text-xs font-medium text-[hsl(var(--fg))]/80">
            <Activity size={14} />
            {copy.quickManage}
          </div>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className={metricCardClass}>
          <div className="text-xs text-[hsl(var(--fg))]/70">{copy.pageResellers}</div>
          <div className="mt-1 text-lg font-semibold">{fmtNumber(stats.count)}</div>
        </div>
        <div className={metricCardClass}>
          <div className="text-xs text-[hsl(var(--fg))]/70">{copy.active}</div>
          <div className="mt-1 text-lg font-semibold text-emerald-600">{fmtNumber(stats.active)}</div>
        </div>
        <div className={metricCardClass}>
          <div className="text-xs text-[hsl(var(--fg))]/70">{copy.disabled}</div>
          <div className="mt-1 text-lg font-semibold text-amber-600">{fmtNumber(stats.disabled)}</div>
        </div>
        <div className={metricCardClass}>
          <div className="text-xs text-[hsl(var(--fg))]/70">{copy.pageBalance}</div>
          <div className="mt-1 text-lg font-semibold">{fmtNumber(stats.totalBalance)}</div>
        </div>
      </div>

      <Card className="overflow-hidden">
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
              <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} placeholder={editingId == null ? "******" : "(optional)"} />
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
	              <div className="flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(145deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] px-3 py-2">
	                <Switch checked={canCreateSub} onCheckedChange={setCanCreateSub} />
	                <span className="text-sm text-[hsl(var(--fg))]/75">{canCreateSub ? t("common.yes") : t("common.no")}</span>
	              </div>
	            </div>

            {editingId == null ? (
              <div className="space-y-3 rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(155deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] p-4 md:col-span-2">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 text-start"
                  onClick={() => setAdvancedOpen((v) => !v)}
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <KeyRound size={16} />
                      {t("adminResellers.initialAllocations")}
                    </span>
                    <span className="mt-1 block text-xs leading-6 text-[hsl(var(--fg))]/70">
                      {t("adminResellers.initialAllocationsHint")}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <Badge variant={initialSelectedCount ? "success" : "muted"}>
                      {fmtNumber(initialSelectedCount)}
                    </Badge>
                    <ChevronDown size={16} className={`transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
                  </span>
                </button>

                {advancedOpen ? (
                  <div className="space-y-3 border-t border-[hsl(var(--border))] pt-3">
                    {!nodes.length ? (
                      <div className={guideBoxClass}>{t("adminResellers.noNodes")}</div>
                    ) : null}
                    {nodes.map((node) => {
                      const draft = initialNodeDrafts[node.id] || emptyInitialNodeDraft();
                      return (
                        <div key={node.id} className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] p-3">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <label className="flex min-w-0 items-start gap-3">
                              <Switch
                                checked={draft.selected}
                                onCheckedChange={(v) => updateInitialNodeDraft(node.id, { selected: v })}
                                disabled={!node.is_enabled}
                              />
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-medium">{node.name}</span>
                                <span className="mt-1 block text-xs text-[hsl(var(--fg))]/60">
                                  {node.panel_type} · #{node.id}
                                </span>
                              </span>
                            </label>
                            <Badge variant={node.is_enabled ? "default" : "danger"}>
                              {node.is_enabled ? t("adminAllocations.enabled") : t("common.disable")}
                            </Badge>
                          </div>

                          {draft.selected ? (
                            <div className="mt-3 space-y-3 border-t border-[hsl(var(--border))] pt-3">
                              <div className="grid gap-2 md:grid-cols-[140px_minmax(0,1fr)_220px] md:items-end">
                                <label className="flex h-10 items-center gap-2 rounded-xl border border-[hsl(var(--border))] px-3 text-xs">
                                  <Switch checked={draft.defaultForReseller} onCheckedChange={(v) => updateInitialNodeDraft(node.id, { defaultForReseller: v })} />
                                  {t("adminAllocations.default")}
                                </label>
                                <div className="space-y-1">
                                  <div className="text-xs text-[hsl(var(--fg))]/65">{t("adminAllocations.priceOverride")}</div>
                                  <Input
                                    type="number"
                                    value={draft.priceOverride}
                                    onChange={(e) => updateInitialNodeDraft(node.id, { priceOverride: e.target.value === "" ? "" : Number(e.target.value) })}
                                  />
                                </div>
                                <div className="space-y-1">
                                  <div className="text-xs text-[hsl(var(--fg))]/65">{t("adminAllocations.credentialsTitle")}</div>
                                  <select
                                    className={selectClass}
                                    value={draft.credential.mode}
                                    onChange={(e) => updateInitialNodeCredential(node.id, { mode: e.target.value as "shared" | "dedicated" })}
                                  >
                                    <option value="shared">{t("adminAllocations.credentialsShared")}</option>
                                    <option value="dedicated">{t("adminAllocations.credentialsDedicated")}</option>
                                  </select>
                                </div>
                              </div>
                              {renderInitialCredentialEditor(node, draft)}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}

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

	            <div className="space-y-3 md:col-span-2 rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(155deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{copy.customPolicies}</div>
                  <div className="text-xs leading-6 text-[hsl(var(--fg))]/70">
                    {copy.customPoliciesHint}
                  </div>
                </div>
                <div className="flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] px-3 py-2">
                  <Switch checked={useCustomPolicy} onCheckedChange={handleCustomPolicyToggle} />
                  <span className="text-xs text-[hsl(var(--fg))]/75">{useCustomPolicy ? copy.custom : copy.global}</span>
                </div>
              </div>
              {!useCustomPolicy ? (
                <div className={guideBoxClass}>
                  {copy.noCustomPolicy}
                </div>
              ) : null}
              <div className={useCustomPolicy ? "space-y-3" : "hidden"}>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-sm font-medium">{copy.customPolicies}</div>
                  {policyDefaultApplied ? <Badge variant="success">{copy.panelDefaultsApplied}</Badge> : null}
                </div>
                <Button type="button" size="sm" variant="outline" onClick={applyGlobalPolicyDefaults}>
                  {copy.applyPanelDefaults}
                </Button>
              </div>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium">{copy.userPolicyTitle}</div>
                  <div className="text-xs text-[hsl(var(--fg))]/70">{copy.userPolicyDesc}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={userPolicy.enabled}
                    onCheckedChange={(v) => updateUserPolicy((x) => ({ ...x, enabled: v }))}
                  />
                  <span className="text-xs text-[hsl(var(--fg))]/75">{userPolicy.enabled ? copy.active : copy.disabled}</span>
                </div>
              </div>

              <div className={guideBoxClass}>
                {copy.policyGuide}
              </div>

              {userPolicy.enabled ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <div className="text-xs text-[hsl(var(--fg))]/70">{copy.durationPackages}</div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {DURATION_PRESET_OPTIONS.map((preset) => {
                        const checked = (userPolicy.allowed_duration_presets || []).includes(preset);
                        const disabled = preset === "unlimited" && !userPolicy.allow_no_expire;
                        const label = durationPresetLabel(preset, lang);
                        return (
	                          <label key={preset} className="flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] px-3 py-2 text-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-[hsl(var(--accent)/0.35)]">
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={disabled}
                              onChange={(e) =>
                                updateUserPolicy((v) => ({
                                    ...v,
                                    allowed_duration_presets: toggleString(v.allowed_duration_presets || [], preset, e.target.checked),
                                  }))
                              }
                            />
                            <span>{label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs text-[hsl(var(--fg))]/70">{copy.trafficPackages}</div>
                    <div className="flex flex-wrap gap-2">
                      {TRAFFIC_PRESET_OPTIONS.map((g) => (
	                        <label key={g} className="flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] px-3 py-2 text-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-[hsl(var(--accent)/0.35)]">
                          <input
                            type="checkbox"
                            checked={(userPolicy.allowed_traffic_gb || []).includes(g)}
                            onChange={(e) =>
                              updateUserPolicy((v) => ({
                                  ...v,
                                  allowed_traffic_gb: toggleNumber(v.allowed_traffic_gb || [], g, e.target.checked),
                                }))
                            }
                          />
                          <span>{g}GB</span>
                        </label>
                      ))}
                    </div>
                    <Input
                      value={trafficInput}
                      onChange={(e) => setTrafficInput(e.target.value)}
                      placeholder={copy.trafficPlaceholder}
                      onBlur={() => {
                        const parsed = parseTrafficInput(trafficInput);
                        if (parsed.length) {
                          updateUserPolicy((v) => ({ ...v, allowed_traffic_gb: parsed }));
                        }
                      }}
                    />
                  </div>

	                  <div className="space-y-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] p-3">
                    <div className="text-xs text-[hsl(var(--fg))]/70">{copy.dayControl}</div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs">{copy.allowManualDays}</span>
                      <Switch
                        checked={userPolicy.allow_custom_days}
                        onCheckedChange={(v) => updateUserPolicy((x) => ({ ...x, allow_custom_days: v }))}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        type="number"
                        value={userPolicy.min_days}
                        onChange={(e) => updateUserPolicy((v) => ({ ...v, min_days: Number(e.target.value) || 1 }))}
                        placeholder={copy.minDays}
                      />
                      <Input
                        type="number"
                        value={userPolicy.max_days}
                        onChange={(e) => updateUserPolicy((v) => ({ ...v, max_days: Number(e.target.value) || v.min_days || 1 }))}
                        placeholder={copy.maxDays}
                      />
                    </div>
                  </div>

	                  <div className="space-y-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] p-3">
                    <div className="text-xs text-[hsl(var(--fg))]/70">{copy.extraSettings}</div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs">{copy.allowManualTraffic}</span>
                      <Switch
                        checked={userPolicy.allow_custom_traffic}
                        onCheckedChange={(v) => updateUserPolicy((x) => ({ ...x, allow_custom_traffic: v }))}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs">{copy.allowUnlimitedPlan}</span>
                      <Switch
                        checked={userPolicy.allow_no_expire}
                        onCheckedChange={(v) => updateUserPolicy((x) => ({ ...x, allow_no_expire: v }))}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-[hsl(var(--fg))]/70">{copy.noCreationLimit}</div>
              )}
              <div className="space-y-3 max-w-full overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] p-3 break-words [overflow-wrap:anywhere]">
                <div>
                  <div className="text-xs font-medium text-[hsl(var(--fg))]/80">{copy.lifecycleTitle}</div>
                  <div className="text-xs leading-6 text-[hsl(var(--fg))]/65">{copy.lifecycleDesc}</div>
                </div>
                <label className="flex items-start gap-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-2))] p-3">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={lifecyclePolicyEnabled}
                    onChange={(e) => handleLifecyclePolicyToggle(e.target.checked)}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{copy.enableLifecycle}</span>
                    <span className="mt-1 block text-xs leading-6 text-[hsl(var(--fg))]/65">{copy.enableLifecycleDesc}</span>
                  </span>
                </label>
                {!lifecyclePolicyEnabled ? (
                  <div className={guideBoxClass}>
                    {copy.lifecycleDisabledHint}
                  </div>
                ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  <div className={policyCheckCardClass}>
                    <label className={policyCheckLabelClass}>
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={userPolicy.allow_user_delete}
                        onChange={(e) => updateLifecyclePolicy((x) => ({ ...x, allow_user_delete: e.target.checked }))}
                      />
                      <span>{copy.allowDeleteRefund}</span>
                    </label>
                    <div className={policyDescClass}>{copy.allowDeleteRefundDesc}</div>
                    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div className="space-y-1">
                        <div className="text-[11px] text-[hsl(var(--fg))]/60">{copy.refundWindowShort}</div>
                        <Input
                          type="number"
                          min={0}
                          value={userPolicy.delete_refund_window_days}
                          onChange={(e) => updateLifecyclePolicy((x) => ({ ...x, delete_refund_window_days: Number(e.target.value) || 0 }))}
                          placeholder={copy.allowedDaysPlaceholder}
                          disabled={!userPolicy.allow_user_delete}
                        />
                      </div>
                      <div className="space-y-1">
                        <div className="text-[11px] text-[hsl(var(--fg))]/60">{copy.usageLimitShort}</div>
                        <Input
                          type="number"
                          min={0}
                          step="0.1"
                          value={userPolicy.delete_expired_used_gb_limit}
                          onChange={(e) => updateLifecyclePolicy((x) => ({ ...x, delete_expired_used_gb_limit: Number(e.target.value) || 0 }))}
                          placeholder={copy.usageLimitPlaceholder}
                          disabled={!userPolicy.allow_user_delete}
                        />
                      </div>
                    </div>
                    <div className={policyDescClass}>{copy.zeroUnlimited}</div>
                  </div>

                  <div className={policyCheckCardClass}>
                    <label className={policyCheckLabelClass}>
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={userPolicy.allow_reset_usage}
                        onChange={(e) => updateLifecyclePolicy((x) => ({ ...x, allow_reset_usage: e.target.checked }))}
                      />
                      <span>{copy.allowResetUsage}</span>
                    </label>
                    <div className={policyDescClass}>{copy.allowResetUsageDesc}</div>
                  </div>

                  <div className={policyCheckCardClass}>
                    <label className={policyCheckLabelClass}>
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={userPolicy.restrict_edit_to_renewal_only}
                        onChange={(e) => updateLifecyclePolicy((x) => ({ ...x, restrict_edit_to_renewal_only: e.target.checked }))}
                      />
                      <span>{copy.renewalOnly}</span>
                    </label>
                    <div className={policyDescClass}>{copy.renewalOnlyDesc}</div>
                  </div>

                  <div className={policyCheckCardClass}>
                    <label className={policyCheckLabelClass}>
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={customRenewalPolicyEnabled}
                        onChange={(e) =>
                          updateLifecyclePolicy((x) => ({
                            ...x,
                            renewal_policy: e.target.checked
                              ? globalPolicy.renewal_policy !== "add_time_and_volume"
                                ? globalPolicy.renewal_policy
                                : "reset_time_and_volume"
                              : "add_time_and_volume",
                          }))
                        }
                      />
                      <span>{copy.customRenewalPolicy}</span>
                    </label>
                    <div className={policyDescClass}>{copy.customRenewalPolicyDesc}</div>
                    <select
                      className={`${selectClass} mt-3 disabled:opacity-60`}
                      value={userPolicy.renewal_policy}
                      disabled={!customRenewalPolicyEnabled}
                      onChange={(e) => updateLifecyclePolicy((x) => ({ ...x, renewal_policy: e.target.value as ResellerUserPolicy["renewal_policy"] }))}
                    >
                      <option value="reset_time_and_volume">{copy.resetTimeAndVolume}</option>
                      <option value="add_time_and_volume">{copy.addTimeAndVolume}</option>
                      <option value="reset_time_carry_volume">{copy.resetTimeCarryVolume}</option>
                      <option value="reset_volume_carry_time">{copy.resetVolumeCarryTime}</option>
                    </select>
                  </div>
                </div>
                )}
              </div>
              </div>
            </div>

            {editingId != null ? (
              <div className="space-y-3 rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(155deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] p-4 md:col-span-2">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{copy.resellerAllocations}</div>
                    <div className="text-xs leading-6 text-[hsl(var(--fg))]/70">{copy.resellerAllocationsDesc}</div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => router.push(`/app/admin/allocations?resellerId=${editingId}`)}
                  >
                    {copy.manageAllocations}
                  </Button>
                </div>

                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] p-3">
                    <div className="text-xs text-[hsl(var(--fg))]/60">{copy.assignedNodes}</div>
                    <div className="mt-1 text-sm font-semibold">{fmtNumber(editingAllocations.length)}</div>
                  </div>
                  <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] p-3">
                    <div className="text-xs text-[hsl(var(--fg))]/60">{copy.activeAllocations}</div>
                    <div className="mt-1 text-sm font-semibold text-emerald-600">{fmtNumber(editingActiveAllocationCount)}</div>
                  </div>
                  <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] p-3">
                    <div className="text-xs text-[hsl(var(--fg))]/60">{copy.activePanels}</div>
                    <div className="mt-1 text-sm font-semibold">{fmtNumber(editingAllocationSummary?.active_panels_count ?? 0)}</div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {editingAllocations.slice(0, 8).map((a) => (
                    <Badge key={a.id} variant={allocationSummaryVariant(a)}>
                      {a.node_name} · {a.panel_type}
                    </Badge>
                  ))}
                  {editingAllocations.length > 8 ? <Badge variant="muted">+{fmtNumber(editingAllocations.length - 8)}</Badge> : null}
                  {!editingAllocations.length ? <Badge variant="muted">{copy.noAllocations}</Badge> : null}
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={createOrSave}>
              {editingId == null ? t("adminResellers.create") : t("adminResellers.save")}
            </Button>
            <Button type="button" variant="outline" onClick={() => load(page, pageSize)}>
              {t("common.reload")}
            </Button>
            {editingId != null ? (
              <Button type="button" variant="outline" onClick={resetForm}>
                {t("common.cancel")}
              </Button>
            ) : null}
          </div>

	          <Card className="overflow-hidden">
	            <CardHeader>
	              <div className="text-sm font-medium">{t("adminResellers.creditTitle")}</div>
	              <div className="text-xs text-[hsl(var(--fg))]/70">{t("adminResellers.creditSubtitle")}</div>
	            </CardHeader>
            <CardContent className="grid gap-2 md:grid-cols-4">
  <div className={guideBoxClass + " md:col-span-4"}>
    {copy.creditGuide}
  </div>
  <div className="md:col-span-2 grid gap-2 sm:grid-cols-2">
    <Input
      placeholder={t("common.search")}
      value={creditQuery}
      onChange={(e) => setCreditQuery(e.target.value)}
    />
	    <select
	      className={selectClass}
	      value={creditId}
	      onChange={(e) => setCreditId(e.target.value === "" ? "" : Number(e.target.value))}
	    >
      <option value="">{t("adminResellers.selectReseller")}</option>
      {creditOptions
        .filter((r) => `${r.id} ${r.username} ${r.role || ""}`.toLowerCase().includes(creditQuery.toLowerCase()))
        .slice(0, 200)
        .map((r) => (
          <option key={r.id} value={r.id}>
        {r.username} (#{r.id}) [{r.role || "reseller"}] — {fmtNumber(r.balance)}
          </option>
        ))}
    </select>
  </div>
  <Input
    placeholder={t("adminResellers.amount")}
    type="number"
    min={0}
    value={creditAmount}
    onChange={(e) => setCreditAmount(Math.abs(Number(e.target.value) || 0))}
  />
  <div className="grid gap-2 sm:grid-cols-2">
    <Button type="button" variant={creditMode === "credit" ? "primary" : "outline"} onClick={() => setCreditMode("credit")}>
      {copy.creditIncrease}
    </Button>
    <Button type="button" variant={creditMode === "debit" ? "primary" : "outline"} onClick={() => setCreditMode("debit")}>
      {copy.creditDecrease}
    </Button>
  </div>
  <Button type="button" variant="outline" onClick={credit} disabled={creditBusy || !(Number(creditAmount) > 0) || creditId === ""}>
    {creditMode === "debit" ? copy.applyDecrease : t("adminResellers.credit")}
  </Button>
</CardContent>
          </Card>

	          <div className="rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(130deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] p-2">
	            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("common.search")} />
	          </div>

	          <div className="overflow-x-auto rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))]">
	            <table className="w-full text-sm">
	              <thead className="text-[hsl(var(--fg))]/70">
	                <tr className="border-b border-[hsl(var(--border))] bg-[linear-gradient(130deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)]">
                  <th className="text-[start] py-2">ID</th>
                  <th className="text-[start] py-2">{t("adminResellers.username")}</th>
                  <th className="text-[start] py-2">{t("adminResellers.status")}</th>
                  <th className="text-[start] py-2">{t("adminResellers.balance")}</th>
                  <th className="text-[start] py-2">{t("adminResellers.pricePerGb")}</th>
                  <th className="text-[start] py-2">{t("adminResellers.bundlePerGb")}</th>
                  <th className="text-[start] py-2">{t("adminResellers.pricePerDay")}</th>
                  <th className="text-[start] py-2">{copy.tableUserPolicy}</th>
                  <th className="text-[end] py-2">{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((x) => (
	                  <tr key={x.id} className="border-b border-[hsl(var(--border))] transition-colors hover:bg-[hsl(var(--accent)/0.06)]">
                    <td className="py-2">{x.id}</td>
                    <td className="py-2">
                      <div className="font-medium">{x.username}</div>
                      <div className="text-xs text-[hsl(var(--fg))]/60">role: {x.role || "reseller"}</div>
                      {x.parent_id ? <div className="text-xs text-[hsl(var(--fg))]/60">parent: #{x.parent_id}</div> : null}
                    </td>
                    <td className="py-2">
                      <div className="flex items-center gap-3">
                        <Badge variant={statusBadgeVariant(x.status)}>{x.status}</Badge>
                        <Switch
                          checked={x.status === "active"}
                          onCheckedChange={() => toggleStatus(x, x.status === "active" ? "disabled" : "active")}
                          disabled={x.status === "deleted"}
                        />
                      </div>
                    </td>
                    <td className="py-2">{fmtNumber(x.balance)}</td>
                    <td className="py-2">{fmtNumber(x.price_per_gb)}</td>
                    <td className="py-2">{fmtNumber(x.bundle_price_per_gb ?? 0)}</td>
                    <td className="py-2">{fmtNumber(x.price_per_day ?? 0)}</td>
                    <td className="py-2 max-w-[360px]">
                      <div className="truncate text-xs text-[hsl(var(--fg))]/80" title={policySummary(x.user_policy, lang)}>
                        {policySummary(x.user_policy, lang)}
                      </div>
                    </td>
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
                          { label: t("common.delete"), icon: <Trash2 size={16} />, onClick: () => openDeleteReseller(x), danger: true },
                        ]}
                      />
                    </td>
                  </tr>
                ))}

                {!filtered.length ? (
                  <tr>
                    <td className="py-3 text-[hsl(var(--fg))]/70" colSpan={9}>
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
      <Modal
        open={!!confirmDelete}
        onClose={() => {
          if (busy) return;
          setConfirmDelete(null);
          setDeletePreview(null);
        }}
        title={copy.deleteTitle}
        className="!max-w-2xl"
      >
        {confirmDelete ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-red-400/35 bg-red-500/10 p-3 text-sm leading-6 text-red-700 dark:text-red-300">
              {copy.deleteWarning}
            </div>

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <div className={metricCardClass}>
                <div className="text-xs text-[hsl(var(--fg))]/60">{copy.balance}</div>
                <div className="mt-1 font-semibold">{fmtNumber(deletePreview?.balance ?? confirmDelete.balance)}</div>
              </div>
              <div className={metricCardClass}>
                <div className="text-xs text-[hsl(var(--fg))]/60">{copy.activeUsers}</div>
                <div className="mt-1 font-semibold">{fmtNumber(deletePreview?.users_active ?? 0)}</div>
              </div>
              <div className={metricCardClass}>
                <div className="text-xs text-[hsl(var(--fg))]/60">{copy.totalUsers}</div>
                <div className="mt-1 font-semibold">{fmtNumber(deletePreview?.users_total ?? 0)}</div>
              </div>
              <div className={metricCardClass}>
                <div className="text-xs text-[hsl(var(--fg))]/60">{copy.ledger}</div>
                <div className="mt-1 font-semibold">{fmtNumber(deletePreview?.ledger_entries ?? 0)}</div>
              </div>
            </div>

            {deletePreview?.warnings?.length ? (
              <div className="rounded-xl border border-amber-400/35 bg-amber-500/10 p-3 text-xs leading-6 text-amber-700 dark:text-amber-300">
                {deletePreview.warnings.map((warning) => (
                  <div key={warning}>- {resellerDeleteWarningText(warning, lang)}</div>
                ))}
              </div>
            ) : null}

            <div className="space-y-2">
              <div className="text-sm font-medium">{copy.deleteUserBehavior}</div>
              <div className="grid gap-2">
                <label className="flex items-start gap-2 rounded-xl border border-[hsl(var(--border))] p-3 text-sm">
                  <input type="radio" className="mt-1" checked={deleteUserAction === "keep"} onChange={() => setDeleteUserAction("keep")} />
                  <span>{copy.keepUsers}</span>
                </label>
                <label className="flex items-start gap-2 rounded-xl border border-[hsl(var(--border))] p-3 text-sm">
                  <input type="radio" className="mt-1" checked={deleteUserAction === "disable"} onChange={() => setDeleteUserAction("disable")} />
                  <span>{copy.disableUsers}</span>
                </label>
                <label className="flex items-start gap-2 rounded-xl border border-[hsl(var(--border))] p-3 text-sm">
                  <input type="radio" className="mt-1" checked={deleteUserAction === "transfer"} onChange={() => setDeleteUserAction("transfer")} />
                  <span>{copy.transferUsers}</span>
                </label>
              </div>
              {deleteUserAction === "transfer" ? (
                <select className={selectClass} value={deleteTransferId} onChange={(e) => setDeleteTransferId(e.target.value === "" ? "" : Number(e.target.value))}>
                  <option value="">{copy.pickTransfer}</option>
                  {creditOptions
                    .filter((r) => r.id !== confirmDelete.id && r.status !== "deleted")
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.username} (#{r.id})
                      </option>
                    ))}
                </select>
              ) : null}
            </div>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setConfirmDelete(null);
                  setDeletePreview(null);
                }}
                disabled={busy}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                className="bg-red-600 text-white hover:opacity-90"
                disabled={busy || !deletePreview || (deleteUserAction === "transfer" && deleteTransferId === "")}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await del(confirmDelete);
                  } finally {
                    setBusy(false);
                    setConfirmDelete(null);
                    setDeletePreview(null);
                  }
                }}
              >
                {busy ? "..." : t("common.delete")}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
