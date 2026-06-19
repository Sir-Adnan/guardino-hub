"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { accentOptions, presetOptions, setAccent, setThemePreset } from "@/components/theme-provider";
import { storage } from "@/lib/storage";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { HelpTip } from "@/components/ui/help-tip";
import { apiFetch } from "@/lib/api";
import { formatNumberWithDigits, localizeDigits } from "@/lib/format";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/components/auth-context";
import { copyText } from "@/lib/copy";
import { useI18n } from "@/components/i18n-context";
import { CalendarDays, Copy, Hash, KeyRound, Palette, Shield, ShieldCheck, Sparkles } from "lucide-react";

type UserDefaults = {
  default_pricing_mode: "bundle" | "per_node";
  default_node_mode: "all" | "manual" | "group";
  default_node_ids: number[];
  default_node_group: string;
  label_prefix: string;
  label_suffix: string;
  username_prefix: string;
  username_suffix: string;
  show_guardino_master_sub: boolean;
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

type UserDefaultsEnvelope = {
  global_defaults: UserDefaults;
  reseller_defaults: UserDefaults;
  effective: UserDefaults;
};

type NodeLite = {
  id: number;
  name: string;
  panel_type?: string;
  tags?: string[];
};

type TwoFactorStatus = {
  enabled: boolean;
  confirmed_at?: string | null;
  last_used_at?: string | null;
  recovery_codes_remaining: number;
};

type TwoFactorSetup = {
  secret: string;
  otpauth_uri: string;
  issuer: string;
  account_name: string;
  digits: number;
  period_seconds: number;
  algorithm: string;
};
type SettingsTabKey = "security" | "appearance" | "defaults" | "policy";

const EMPTY_DEFAULTS: UserDefaults = {
  default_pricing_mode: "per_node",
  default_node_mode: "manual",
  default_node_ids: [],
  default_node_group: "",
  label_prefix: "",
  label_suffix: "",
  username_prefix: "",
  username_suffix: "",
  show_guardino_master_sub: false,
};

const EMPTY_POLICY: ResellerUserPolicy = {
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
  allowed_traffic_gb: [20, 30, 50, 70, 100, 150, 200],
};
const DURATION_PRESET_OPTIONS = ["7d", "1m", "3m", "6m", "1y", "unlimited"];
const TRAFFIC_PRESET_OPTIONS = [20, 30, 50, 70, 100, 150, 200];

function durationPresetLabel(preset: string, lang: string): string {
  const en = lang === "en";
  if (preset === "7d") return en ? "7 days" : localizeDigits("7 روز");
  if (preset === "1m") return en ? "1 month" : localizeDigits("1 ماه");
  if (preset === "3m") return en ? "3 months" : localizeDigits("3 ماه");
  if (preset === "6m") return en ? "6 months" : localizeDigits("6 ماه");
  if (preset === "1y") return en ? "1 year" : localizeDigits("1 سال");
  return en ? "Unlimited" : "نامحدود";
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

function normalizePolicy(raw: Partial<ResellerUserPolicy> | null | undefined): ResellerUserPolicy {
  const p = { ...EMPTY_POLICY, ...(raw || {}) };
  const out: ResellerUserPolicy = {
    ...p,
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
        (Array.isArray(p.allowed_duration_presets) ? p.allowed_duration_presets : EMPTY_POLICY.allowed_duration_presets)
          .map((x) => String(x || "").trim().toLowerCase())
          .filter((x) => DURATION_PRESET_OPTIONS.includes(x))
      )
    ),
    allowed_traffic_gb: Array.from(
      new Set(
        (Array.isArray(p.allowed_traffic_gb) ? p.allowed_traffic_gb : EMPTY_POLICY.allowed_traffic_gb)
          .map((x) => Number(x))
          .filter((x) => Number.isFinite(x) && x > 0)
          .map((x) => Math.floor(x))
      )
    ).sort((a, b) => a - b),
  };
  if (out.max_days < out.min_days) out.max_days = out.min_days;
  if (!out.allow_no_expire) {
    out.allowed_duration_presets = out.allowed_duration_presets.filter((x) => x !== "unlimited");
  } else if (!out.allowed_duration_presets.includes("unlimited")) {
    out.allowed_duration_presets.push("unlimited");
  }
  if (!out.allowed_duration_presets.length) out.allowed_duration_presets = [...EMPTY_POLICY.allowed_duration_presets];
  if (!out.allowed_traffic_gb.length) out.allowed_traffic_gb = [...EMPTY_POLICY.allowed_traffic_gb];
  return out;
}

function toggleId(list: number[], id: number, checked: boolean): number[] {
  const s = new Set(list);
  if (checked) s.add(id);
  else s.delete(id);
  return Array.from(s).sort((a, b) => a - b);
}

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [accent, setAccentState] = React.useState(storage.get("accent") || "blue");
  const [preset, setPresetState] = React.useState(storage.get("theme_preset") || "guardino");
  const r = useRouter();
  const { push } = useToast();
  const { me } = useAuth();
  const { lang, digitStyle, setDigitStyle } = useI18n();
  const isEn = lang === "en";
  const [activeTab, setActiveTab] = React.useState<SettingsTabKey>("security");
  const copy = React.useMemo(
    () =>
      isEn
        ? {
            toastLoadSettingsError: "Could not load settings",
            toastLoad2faError: "Could not load two-factor status",
            toastSettingsSaved: "Settings saved",
            toastSettingsSaveError: "Could not save settings",
            toastGlobalDefaultsSaved: "Global defaults saved",
            toastGlobalDefaultsSaveError: "Could not save global defaults",
            toastGlobalPolicySaved: "Global policy saved",
            toastGlobalPolicySaveError: "Could not save global policy",
            toastPasswordFields: "Complete all password fields",
            toastPasswordMismatch: "New password confirmation does not match",
            toastPasswordChanged: "Password changed successfully",
            toastPasswordError: "Could not change password",
            toastCurrentPasswordRequired: "Enter your current password",
            toast2faSecretCreated: "Two-factor key created",
            toast2faSecretCreatedDesc: `Add it to your authenticator app and confirm the ${formatNumberWithDigits(6)}-digit code.`,
            toast2faSetupError: "Could not start setup",
            toast2faCodeRequired: "Enter current password and Authenticator code",
            toast2faEnabled: "Two-factor authentication enabled",
            toast2faEnabledDesc: "Store the recovery codes somewhere safe now.",
            toast2faEnableError: "Activation failed",
            toast2faDisableRequired: "Enter current password and two-factor code",
            toast2faDisabled: "Two-factor authentication disabled",
            toast2faDisableError: "Deactivation failed",
            toastRecoveryCreated: "New recovery codes created",
            toastRecoveryCreatedDesc: "Previous codes are no longer valid.",
            toastRecoveryError: "Could not create recovery codes",
            toastSecretCopied: "Secret copied",
            toastUriCopied: "URI copied",
            toastRecoveryCopied: "Recovery codes copied",
            toastCopyFailed: "Copy failed",
            heroEyebrow: "Security and Appearance",
            heroTitle: "Panel Settings",
            heroSubtitle: "Manage appearance, user creation defaults and account security",
            tabSecurity: "Security",
            tabSecurityDesc: "2FA and password",
            tabAppearance: "Appearance",
            tabAppearanceDesc: "Theme and accent",
            tabDefaults: "Defaults",
            tabDefaultsDesc: "User creation and nodes",
            tabPolicy: "Policies",
            tabPolicyDesc: "Reseller rules",
            twoFactorTitle: "Account Two-Factor Authentication",
            twoFactorHelp:
              `Security guide: enter your current password first and generate a 2FA key. Add the secret to an Authenticator app and confirm the ${formatNumberWithDigits(6)}-digit code. After activation, the secret is encrypted in the database and recovery codes are stored only as hashes. Recovery codes are shown once; each code can be used one time.`,
            twoFactorSubtitle:
              "Enable a TOTP security layer for super-admin and reseller logins. It works with Google Authenticator, Microsoft Authenticator, 1Password and Bitwarden.",
            enabled: "Enabled",
            disabled: "Disabled",
            currentPasswordLabel: "Current account password",
            currentPasswordPlaceholder: "Required for security changes",
            authenticatorCodeLabel: "Authenticator code or backup code",
            setupKeyTitle: "Authenticator setup key",
            copySecret: "Copy secret",
            copyUri: "Copy URI",
            setupInstructions:
              `In your Authenticator app, choose manual setup or enter setup key, name the account Guardino Hub / {account}, select time based mode, and enter the secret above. Then paste the generated ${formatNumberWithDigits(6)}-digit code and confirm activation.`,
            recoveryCodesTitle: "One-time recovery codes",
            copyAll: "Copy all",
            secureRelogin: "Secure logout and login again",
            regenerateCodes: "Create new backup codes",
            disable2fa: "Disable 2FA",
            enable2fa: "Enable 2FA",
            cancelSetup: "Cancel setup",
            start2fa: "Create key and start setup",
            clearFields: "Clear fields",
            remainingCodes: "Recovery codes left",
            activatedAt: "Activated",
            lastUsedAt: "Last used",
            settingsTitle: "Settings",
            settingsSubtitle: "Appearance, defaults and account security",
            displayMode: "Display mode",
            light: "Light",
            dark: "Dark",
            system: "System",
            accentColor: "Accent color",
            colorPreset: "Color preset",
            presetHint: "The theme preset changes cards, gradients and the panel background glow together.",
            digitStyleTitle: "Number digits",
            digitStyleHint: "Choose whether panel numbers are rendered with English or Persian digits. This does not change the panel language.",
            digitLatin: "English digits",
            digitPersian: "Persian digits",
            passwordTitle: "Change password",
            passwordDesc: `For better security, choose a new password with at least ${formatNumberWithDigits(8)} characters.`,
            currentPassword: "Current password",
            newPassword: "New password",
            confirmPassword: "Repeat new password",
            saveNewPassword: "Save new password",
            clear: "Clear",
            userDefaultsTitle: "User creation defaults (your account)",
            userDefaultsDesc: "These settings prepare the user creation form for you.",
            loading: "Loading...",
            pricingModel: "Default pricing model",
            nodeMode: "Default node mode",
            allNodes: "All nodes",
            manual: "Manual selection",
            group: "Group (Tag)",
            masterSubTitle: "Guardino central subscription",
            masterSubHint:
              "When enabled, the Guardino combined subscription link is shown next to direct panel links. When disabled, only direct panel links are shown.",
            manualNodes: "Default nodes (manual mode)",
            searchNode: "Search nodes",
            selectAll: "Select all",
            defaultTag: "Default tag (group mode)",
            choose: "Choose",
            usernamePrefix: "Username prefix",
            usernameSuffix: "Username suffix",
            usernameHint: "The same value is used as the final username in Guardino and the destination panels.",
            save: "Save",
            reload: "Reload",
            globalDefaultsTitle: "Global defaults for all resellers (admin)",
            globalDefaultsDesc: "Resellers without custom settings use these values.",
            globalMasterSubHint:
              "This is the default for resellers without custom settings. Enabling it only shows the central link; direct links always remain separate.",
            globalManualNodes: "Default nodes (global)",
            globalDefaultTag: "Default tag (global)",
            globalUsernameHint:
              "Label and Username are unified; the same pattern is used for Guardino display and user creation in Pasarguard/Marzban.",
            saveGlobal: "Save global",
            creationPolicyTitle: "Global user creation policy for resellers",
            creationPolicyHelp:
              "Set approved duration and traffic packages here to make reseller creation faster. For example, enable only 50GB and 100GB so those values are preselected when applying panel defaults. This is the default creation rule for resellers without a custom policy; a reseller's custom policy always wins.",
            creationPolicyDesc: "These values are applied as defaults when enabling a reseller's custom policy.",
            creationPolicyEnabledTitle: "User creation policy enabled",
            creationPolicyEnabledDesc: "When enabled, resellers create users only within this duration and traffic policy.",
            durationPackages: "Allowed duration packages",
            trafficPackages: "Allowed traffic packages (GB)",
            trafficPlaceholder: "Example: 50, 100",
            dayControl: "Day and duration controls",
            allowManualDays: "Allow manual days",
            minDays: "Minimum days",
            maxDays: "Maximum days",
            extraCreation: "Additional creation settings",
            allowManualTraffic: "Allow manual traffic",
            allowUnlimitedPlan: "Allow unlimited plan",
            saveGlobalPolicy: "Save global policy",
            lifecyclePolicyTitle: "Global delete, reset, edit and renewal policy",
            lifecyclePolicyHelp:
              "This policy applies to resellers without custom settings. Delete/refund window is the allowed days after user creation; 0 means no time limit. Maximum usage of 0 means unlimited; for example 0.5 means a user who has used more than about 500 MB cannot be deleted/refunded. Users whose time or total traffic is exhausted cannot be deleted either.",
            lifecyclePolicyDesc: "This baseline is used for resellers without a custom policy.",
            allowUserDelete: "Allow user delete and refund",
            allowResetUsage: "Allow usage reset",
            refundWindow: "Delete/refund window from creation (days, 0 means unlimited)",
            maxDeleteUsage: "Maximum usage allowed for delete (GB)",
            renewalOnly: "Only package renewal is allowed while editing",
            packageRenewalPolicy: "Package renewal policy",
            resetTimeAndVolume: "Reset time and volume",
            addTimeAndVolume: "Add time and volume to the next period",
            resetTimeCarryVolume: "Reset time and carry previous remaining traffic",
            resetVolumeCarryTime: "Reset traffic and carry previous remaining time",
            logout: "Log out",
          }
        : {
            toastLoadSettingsError: "خطا در دریافت تنظیمات",
            toastLoad2faError: "خطا در دریافت وضعیت دومرحله‌ای",
            toastSettingsSaved: "تنظیمات ذخیره شد",
            toastSettingsSaveError: "خطا در ذخیره تنظیمات",
            toastGlobalDefaultsSaved: "پیش‌فرض سراسری ذخیره شد",
            toastGlobalDefaultsSaveError: "خطا در ذخیره پیش‌فرض سراسری",
            toastGlobalPolicySaved: "سیاست سراسری ذخیره شد",
            toastGlobalPolicySaveError: "خطا در ذخیره سیاست سراسری",
            toastPasswordFields: "همه فیلدهای رمز را کامل کنید",
            toastPasswordMismatch: "تکرار رمز جدید با رمز جدید یکسان نیست",
            toastPasswordChanged: "رمز عبور با موفقیت تغییر کرد",
            toastPasswordError: "خطا در تغییر رمز",
            toastCurrentPasswordRequired: "رمز فعلی را وارد کنید",
            toast2faSecretCreated: "کلید دومرحله‌ای ساخته شد",
            toast2faSecretCreatedDesc: `آن را در برنامه Authenticator وارد کنید و کد ${formatNumberWithDigits(6)} رقمی را تایید کنید.`,
            toast2faSetupError: "خطا در شروع راه‌اندازی",
            toast2faCodeRequired: "رمز فعلی و کد Authenticator را وارد کنید",
            toast2faEnabled: "تایید دومرحله‌ای فعال شد",
            toast2faEnabledDesc: "کدهای بازیابی را همین حالا در جای امن نگه دارید.",
            toast2faEnableError: "فعال‌سازی انجام نشد",
            toast2faDisableRequired: "رمز فعلی و کد دومرحله‌ای را وارد کنید",
            toast2faDisabled: "تایید دومرحله‌ای غیرفعال شد",
            toast2faDisableError: "غیرفعال‌سازی انجام نشد",
            toastRecoveryCreated: "کدهای بازیابی جدید ساخته شد",
            toastRecoveryCreatedDesc: "کدهای قبلی دیگر معتبر نیستند.",
            toastRecoveryError: "ساخت کدهای بازیابی انجام نشد",
            toastSecretCopied: "Secret کپی شد",
            toastUriCopied: "URI کپی شد",
            toastRecoveryCopied: "کدهای بازیابی کپی شد",
            toastCopyFailed: "کپی انجام نشد",
            heroEyebrow: "امنیت و ظاهر",
            heroTitle: "تنظیمات پنل",
            heroSubtitle: "مدیریت ظاهر، پیش‌فرض‌های ساخت کاربر و امنیت حساب",
            tabSecurity: "امنیت",
            tabSecurityDesc: "2FA و رمز عبور",
            tabAppearance: "ظاهر",
            tabAppearanceDesc: "تم و رنگ پنل",
            tabDefaults: "پیش‌فرض‌ها",
            tabDefaultsDesc: "ساخت کاربر و نودها",
            tabPolicy: "سیاست‌ها",
            tabPolicyDesc: "قوانین رسیلرها",
            twoFactorTitle: "تایید دومرحله‌ای حساب",
            twoFactorHelp:
              `راهنمای امنیتی: ابتدا رمز فعلی را وارد کنید و کلید 2FA بسازید. سپس secret را در برنامه Authenticator اضافه کنید و کد ${formatNumberWithDigits(6)} رقمی را تایید کنید. بعد از فعال‌سازی، secret به‌صورت رمزنگاری‌شده در دیتابیس ذخیره می‌شود و backup codeها فقط به شکل hash نگهداری می‌شوند. کدهای بازیابی فقط همین یک‌بار نمایش داده می‌شوند؛ هر کد فقط یک‌بار قابل استفاده است.`,
            twoFactorSubtitle:
              "برای ورود سوپرادمین و رسیلرها می‌توانید یک لایه امنیتی TOTP فعال کنید. این روش با Google Authenticator، Microsoft Authenticator، 1Password و Bitwarden سازگار است.",
            enabled: "فعال",
            disabled: "غیرفعال",
            currentPasswordLabel: "رمز فعلی حساب",
            currentPasswordPlaceholder: "برای تغییرات امنیتی لازم است",
            authenticatorCodeLabel: "کد Authenticator یا backup code",
            setupKeyTitle: "کلید راه‌اندازی Authenticator",
            copySecret: "کپی secret",
            copyUri: "کپی URI",
            setupInstructions:
              `در برنامه Authenticator گزینه manual setup یا enter setup key را بزنید؛ نام حساب را Guardino Hub / {account} بگذارید، نوع را Time based انتخاب کنید و secret بالا را وارد کنید. سپس کد ${formatNumberWithDigits(6)} رقمی تولیدشده را در فیلد کد وارد و فعال‌سازی را تایید کنید.`,
            recoveryCodesTitle: "کدهای بازیابی یک‌بارمصرف",
            copyAll: "کپی همه",
            secureRelogin: "خروج و ورود مجدد امن",
            regenerateCodes: "ساخت backup code جدید",
            disable2fa: "غیرفعال‌سازی 2FA",
            enable2fa: "فعال‌سازی 2FA",
            cancelSetup: "لغو راه‌اندازی",
            start2fa: "ساخت کلید و شروع راه‌اندازی",
            clearFields: "پاک کردن فیلدها",
            remainingCodes: "کدهای بازیابی باقی‌مانده",
            activatedAt: "فعال‌سازی",
            lastUsedAt: "آخرین استفاده",
            settingsTitle: "تنظیمات",
            settingsSubtitle: "تنظیمات ظاهری، پیش‌فرض‌ها و امنیت حساب",
            displayMode: "حالت نمایش",
            light: "روشن",
            dark: "تیره",
            system: "سیستمی",
            accentColor: "رنگ اصلی",
            colorPreset: "پریست رنگی",
            presetHint: "preset تم، گرادیانت باکس‌ها و نور پس‌زمینه کل پنل را یک‌جا تغییر می‌دهد.",
            digitStyleTitle: "نمایش اعداد",
            digitStyleHint: "انتخاب کنید عددهای پنل با رقم انگلیسی یا فارسی نمایش داده شوند؛ این گزینه زبان پنل را تغییر نمی‌دهد.",
            digitLatin: "اعداد انگلیسی",
            digitPersian: "اعداد فارسی",
            passwordTitle: "تغییر رمز عبور",
            passwordDesc: `برای امنیت بیشتر، رمز جدید حداقل ${formatNumberWithDigits(8)} کاراکتر انتخاب کنید.`,
            currentPassword: "رمز فعلی",
            newPassword: "رمز جدید",
            confirmPassword: "تکرار رمز جدید",
            saveNewPassword: "ذخیره رمز جدید",
            clear: "پاک کردن",
            userDefaultsTitle: "پیش‌فرض ساخت کاربر (حساب شما)",
            userDefaultsDesc: "این تنظیمات فرم ساخت کاربر را برای شما آماده می‌کند.",
            loading: "در حال بارگذاری...",
            pricingModel: "مدل قیمت پیش‌فرض",
            nodeMode: "حالت نود پیش‌فرض",
            allNodes: "همه نودها",
            manual: "انتخاب دستی",
            group: "گروهی (Tag)",
            masterSubTitle: "ساب مرکزی Guardino",
            masterSubHint:
              "اگر روشن باشد لینک تجمیعی Guardino کنار لینک‌های مستقیم کاربر نمایش داده می‌شود. اگر خاموش باشد فقط لینک‌های مستقیم پنل‌ها دیده می‌شوند.",
            manualNodes: "انتخاب نودهای پیش‌فرض (حالت دستی)",
            searchNode: "جستجوی نود",
            selectAll: "انتخاب همه",
            defaultTag: "Tag پیش‌فرض (فقط حالت گروهی)",
            choose: "انتخاب کنید",
            usernamePrefix: "پیشوند نام کاربری",
            usernameSuffix: "پسوند نام کاربری",
            usernameHint: "همین مقدار هم در گاردینو و هم در پنل‌های مقصد به عنوان نام کاربری نهایی استفاده می‌شود.",
            save: "ذخیره",
            reload: "بارگذاری مجدد",
            globalDefaultsTitle: "پیش‌فرض سراسری برای همه رسیلرها (ادمین)",
            globalDefaultsDesc: "رسیلرهایی که تنظیم اختصاصی ندارند از این مقادیر استفاده می‌کنند.",
            globalMasterSubHint:
              "مقدار پیش‌فرض برای رسیلرهایی است که تنظیم اختصاصی ندارند. روشن بودن این گزینه فقط نمایش لینک مرکزی را فعال می‌کند؛ لینک‌های مستقیم همیشه جداگانه باقی می‌مانند.",
            globalManualNodes: "انتخاب نودهای پیش‌فرض (سراسری)",
            globalDefaultTag: "Tag پیش‌فرض (سراسری)",
            globalUsernameHint:
              "بخش Label و Username یکی شده است؛ همین الگو برای نمایش گاردینو و ساخت کاربر در پاسارگارد/مرزبان استفاده می‌شود.",
            saveGlobal: "ذخیره سراسری",
            creationPolicyTitle: "سیاست سراسری ساخت کاربر برای رسیلرها",
            creationPolicyHelp:
              "اگر می‌خواهید ساخت رسیلر سریع‌تر باشد، بسته‌های زمانی و حجمی مورد تأیید پنل را اینجا مشخص کنید. مثلا فقط 50GB و 100GB را فعال کنید تا هنگام اعمال پیش‌فرض پنل، همان‌ها برای رسیلر تیک بخورند. این گزینه قانون پیش‌فرض ساخت کاربر برای رسیلرهایی است که سیاست اختصاصی ذخیره‌شده ندارند؛ سیاست اختصاصی هر رسیلر همیشه اولویت دارد.",
            creationPolicyDesc: "این مقدارها هنگام فعال‌کردن سیاست اختصاصی رسیلر به عنوان پیش‌فرض روی فرم ساخت/ویرایش رسیلر اعمال می‌شوند.",
            creationPolicyEnabledTitle: "فعال بودن سیاست ساخت کاربر",
            creationPolicyEnabledDesc: "روشن باشد، رسیلر فقط طبق محدودیت‌های روز/حجم همین بخش کاربر می‌سازد.",
            durationPackages: "بسته‌های زمانی مجاز",
            trafficPackages: "حجم‌های مجاز (GB)",
            trafficPlaceholder: "مثال: 50, 100",
            dayControl: "کنترل روز و مدت‌زمان",
            allowManualDays: "اجازه روز دستی",
            minDays: "حداقل روز",
            maxDays: "حداکثر روز",
            extraCreation: "تنظیمات تکمیلی ساخت",
            allowManualTraffic: "اجازه حجم دستی",
            allowUnlimitedPlan: "اجازه پلن نامحدود",
            saveGlobalPolicy: "ذخیره سیاست سراسری",
            lifecyclePolicyTitle: "سیاست سراسری حذف، ریست، ویرایش و تمدید کاربران",
            lifecyclePolicyHelp:
              "این سیاست روی رسیلرهایی اعمال می‌شود که تنظیم اختصاصی ندارند. «مهلت حذف/ریفاند» تعداد روز مجاز از زمان ساخت کاربر است و عدد 0 یعنی محدودیت زمانی ندارد. «حداکثر مصرف» اگر 0 باشد نامحدود است؛ اگر مثلا 0.5 وارد شود، کاربری که بیشتر از حدود 500 مگابایت مصرف کرده باشد قابل حذف/ریفاند نیست. کاربری که زمانش تمام شده یا کل حجمش مصرف شده باشد هم قابل حذف نیست.",
            lifecyclePolicyDesc: "این مقدار پایه برای رسیلرهایی استفاده می‌شود که سیاست اختصاصی ندارند.",
            allowUserDelete: "اجازه حذف و ریفاند کاربر",
            allowResetUsage: "اجازه ریست مصرف",
            refundWindow: "مهلت حذف/ریفاند از زمان ساخت (روز، 0 یعنی نامحدود)",
            maxDeleteUsage: "حداکثر مصرف مجاز برای حذف (GB)",
            renewalOnly: "در ویرایش فقط تمدید بسته‌ای مجاز باشد",
            packageRenewalPolicy: "سیاست تمدید بسته‌ای",
            resetTimeAndVolume: "ریست زمان و حجم",
            addTimeAndVolume: "اضافه شدن زمان و حجم به دوره بعد",
            resetTimeCarryVolume: "ریست زمان و اضافه شدن حجم باقی‌مانده قبلی",
            resetVolumeCarryTime: "ریست حجم و اضافه شدن زمان باقی‌مانده قبلی",
            logout: "خروج از حساب",
          },
    [isEn, digitStyle]
  );

  const [loadingDefaults, setLoadingDefaults] = React.useState(true);
  const [resellerDefaults, setResellerDefaults] = React.useState<UserDefaults>(EMPTY_DEFAULTS);
  const [globalDefaults, setGlobalDefaults] = React.useState<UserDefaults>(EMPTY_DEFAULTS);
  const [globalPolicy, setGlobalPolicy] = React.useState<ResellerUserPolicy>(EMPTY_POLICY);
  const [globalTrafficInput, setGlobalTrafficInput] = React.useState(EMPTY_POLICY.allowed_traffic_gb.join(", "));

  const [resellerNodes, setResellerNodes] = React.useState<NodeLite[]>([]);
  const [adminNodes, setAdminNodes] = React.useState<NodeLite[]>([]);
  const [resellerNodeQ, setResellerNodeQ] = React.useState("");
  const [globalNodeQ, setGlobalNodeQ] = React.useState("");

  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [pwdBusy, setPwdBusy] = React.useState(false);
  const [twoFactorStatus, setTwoFactorStatus] = React.useState<TwoFactorStatus | null>(null);
  const [twoFactorSetup, setTwoFactorSetup] = React.useState<TwoFactorSetup | null>(null);
  const [twoFactorPassword, setTwoFactorPassword] = React.useState("");
  const [twoFactorCode, setTwoFactorCode] = React.useState("");
  const [twoFactorBusy, setTwoFactorBusy] = React.useState(false);
  const [recoveryCodes, setRecoveryCodes] = React.useState<string[]>([]);

  function onLogout() {
    storage.del("token");
    r.push("/login");
  }

  const resellerFilteredNodes = React.useMemo(() => {
    const q = resellerNodeQ.trim().toLowerCase();
    if (!q) return resellerNodes;
    return resellerNodes.filter((n) => `${n.id} ${n.name} ${n.panel_type || ""}`.toLowerCase().includes(q));
  }, [resellerNodes, resellerNodeQ]);

  const globalFilteredNodes = React.useMemo(() => {
    const q = globalNodeQ.trim().toLowerCase();
    if (!q) return adminNodes;
    return adminNodes.filter((n) => `${n.id} ${n.name} ${n.panel_type || ""}`.toLowerCase().includes(q));
  }, [adminNodes, globalNodeQ]);

  const resellerTagOptions = React.useMemo(() => {
    const tags = new Set<string>();
    resellerNodes.forEach((n) => (n.tags || []).forEach((t) => tags.add(String(t))));
    return Array.from(tags).sort();
  }, [resellerNodes]);

  const globalTagOptions = React.useMemo(() => {
    const tags = new Set<string>();
    adminNodes.forEach((n) => (n.tags || []).forEach((t) => tags.add(String(t))));
    return Array.from(tags).sort();
  }, [adminNodes]);

  async function loadDefaults() {
    setLoadingDefaults(true);
    try {
      const [env, resellerNodeRes] = await Promise.all([
        apiFetch<UserDefaultsEnvelope>("/api/v1/reseller/settings/user-defaults"),
        apiFetch<any>("/api/v1/reseller/nodes"),
      ]);

      setResellerDefaults(env.effective || env.reseller_defaults || EMPTY_DEFAULTS);

      const resellerNodeItems = (resellerNodeRes?.items || resellerNodeRes || []).map((n: any) => ({
        id: n.id,
        name: n.name,
        panel_type: n.panel_type,
        tags: n.tags || [],
      }));
      setResellerNodes(resellerNodeItems);

      if (me?.role === "admin") {
        const [g, adminNodeRes, gp] = await Promise.all([
          apiFetch<UserDefaults>("/api/v1/admin/settings/user-defaults"),
          apiFetch<any>("/api/v1/admin/nodes?offset=0&limit=500"),
          apiFetch<ResellerUserPolicy>("/api/v1/admin/settings/user-policy"),
        ]);
        setGlobalDefaults(g || EMPTY_DEFAULTS);
        const normalizedPolicy = normalizePolicy(gp);
        setGlobalPolicy(normalizedPolicy);
        setGlobalTrafficInput(normalizedPolicy.allowed_traffic_gb.join(", "));
        setAdminNodes((adminNodeRes?.items || []).map((n: any) => ({
          id: n.id,
          name: n.name,
          panel_type: n.panel_type,
          tags: n.tags || [],
        })));
      } else {
        setGlobalDefaults(env.global_defaults || EMPTY_DEFAULTS);
        setAdminNodes(resellerNodeItems);
      }
    } catch (e: any) {
      push({ title: copy.toastLoadSettingsError, desc: String(e?.message || e), type: "error" });
    } finally {
      setLoadingDefaults(false);
    }
  }

  async function loadTwoFactorStatus() {
    try {
      const status = await apiFetch<TwoFactorStatus>("/api/v1/auth/2fa/status");
      setTwoFactorStatus(status);
    } catch (e: any) {
      push({ title: copy.toastLoad2faError, desc: String(e?.message || e), type: "error" });
    }
  }

  React.useEffect(() => {
    loadDefaults();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.role]);

  React.useEffect(() => {
    loadTwoFactorStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.reseller_id]);

  React.useEffect(() => {
    setGlobalTrafficInput((globalPolicy.allowed_traffic_gb || []).join(", "));
  }, [globalPolicy.allowed_traffic_gb]);

  async function saveResellerDefaults() {
    try {
      const payload: UserDefaults = {
        ...resellerDefaults,
        username_prefix: resellerDefaults.label_prefix,
        username_suffix: resellerDefaults.label_suffix,
        default_node_ids: (resellerDefaults.default_node_ids || []).filter((id) => resellerNodes.some((n) => n.id === id)),
      };
      const saved = await apiFetch<UserDefaults>("/api/v1/reseller/settings/user-defaults", {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      setResellerDefaults(saved);
      push({ title: copy.toastSettingsSaved, type: "success" });
    } catch (e: any) {
      push({ title: copy.toastSettingsSaveError, desc: String(e?.message || e), type: "error" });
    }
  }

  async function saveGlobalDefaults() {
    try {
      const payload: UserDefaults = {
        ...globalDefaults,
        username_prefix: globalDefaults.label_prefix,
        username_suffix: globalDefaults.label_suffix,
        default_node_ids: (globalDefaults.default_node_ids || []).filter((id) => adminNodes.some((n) => n.id === id)),
      };
      const saved = await apiFetch<UserDefaults>("/api/v1/admin/settings/user-defaults", {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      setGlobalDefaults(saved);
      push({ title: copy.toastGlobalDefaultsSaved, type: "success" });
    } catch (e: any) {
      push({ title: copy.toastGlobalDefaultsSaveError, desc: String(e?.message || e), type: "error" });
    }
  }

  async function saveGlobalPolicy() {
    try {
      const saved = await apiFetch<ResellerUserPolicy>("/api/v1/admin/settings/user-policy", {
        method: "PUT",
        body: JSON.stringify(normalizePolicy(globalPolicy)),
      });
      const normalized = normalizePolicy(saved);
      setGlobalPolicy(normalized);
      setGlobalTrafficInput(normalized.allowed_traffic_gb.join(", "));
      push({ title: copy.toastGlobalPolicySaved, type: "success" });
    } catch (e: any) {
      push({ title: copy.toastGlobalPolicySaveError, desc: String(e?.message || e), type: "error" });
    }
  }

  async function changePassword() {
    if (!currentPassword || !newPassword || !confirmPassword) {
      push({ title: copy.toastPasswordFields, type: "warning" });
      return;
    }
    if (newPassword !== confirmPassword) {
      push({ title: copy.toastPasswordMismatch, type: "warning" });
      return;
    }
    setPwdBusy(true);
    try {
      await apiFetch("/api/v1/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      push({ title: copy.toastPasswordChanged, type: "success" });
    } catch (e: any) {
      push({ title: copy.toastPasswordError, desc: String(e?.message || e), type: "error" });
    } finally {
      setPwdBusy(false);
    }
  }

  async function startTwoFactorSetup() {
    if (!twoFactorPassword) {
      push({ title: copy.toastCurrentPasswordRequired, type: "warning" });
      return;
    }
    setTwoFactorBusy(true);
    setRecoveryCodes([]);
    try {
      const setup = await apiFetch<TwoFactorSetup>("/api/v1/auth/2fa/setup", {
        method: "POST",
        body: JSON.stringify({ current_password: twoFactorPassword }),
      });
      setTwoFactorSetup(setup);
      push({ title: copy.toast2faSecretCreated, desc: copy.toast2faSecretCreatedDesc, type: "success" });
    } catch (e: any) {
      push({ title: copy.toast2faSetupError, desc: String(e?.message || e), type: "error" });
    } finally {
      setTwoFactorBusy(false);
    }
  }

  async function enableTwoFactor() {
    if (!twoFactorSetup) return;
    if (!twoFactorPassword || !twoFactorCode.trim()) {
      push({ title: copy.toast2faCodeRequired, type: "warning" });
      return;
    }
    setTwoFactorBusy(true);
    try {
      const res = await apiFetch<{ recovery_codes: string[] }>("/api/v1/auth/2fa/enable", {
        method: "POST",
        body: JSON.stringify({ current_password: twoFactorPassword, secret: twoFactorSetup.secret, code: twoFactorCode }),
      });
      setRecoveryCodes(res.recovery_codes || []);
      setTwoFactorSetup(null);
      setTwoFactorPassword("");
      setTwoFactorCode("");
      setTwoFactorStatus({
        enabled: true,
        confirmed_at: new Date().toISOString(),
        last_used_at: new Date().toISOString(),
        recovery_codes_remaining: res.recovery_codes?.length || 0,
      });
      push({ title: copy.toast2faEnabled, desc: copy.toast2faEnabledDesc, type: "success" });
    } catch (e: any) {
      push({ title: copy.toast2faEnableError, desc: String(e?.message || e), type: "error" });
    } finally {
      setTwoFactorBusy(false);
    }
  }

  async function disableTwoFactor() {
    if (!twoFactorPassword || !twoFactorCode.trim()) {
      push({ title: copy.toast2faDisableRequired, type: "warning" });
      return;
    }
    setTwoFactorBusy(true);
    try {
      await apiFetch("/api/v1/auth/2fa/disable", {
        method: "POST",
        body: JSON.stringify({ current_password: twoFactorPassword, code: twoFactorCode }),
      });
      setTwoFactorStatus({ enabled: false, recovery_codes_remaining: 0 });
      setTwoFactorPassword("");
      setTwoFactorCode("");
      setTwoFactorSetup(null);
      setRecoveryCodes([]);
      push({ title: copy.toast2faDisabled, type: "success" });
    } catch (e: any) {
      push({ title: copy.toast2faDisableError, desc: String(e?.message || e), type: "error" });
    } finally {
      setTwoFactorBusy(false);
    }
  }

  async function regenerateRecoveryCodes() {
    if (!twoFactorPassword || !twoFactorCode.trim()) {
      push({ title: copy.toast2faDisableRequired, type: "warning" });
      return;
    }
    setTwoFactorBusy(true);
    try {
      const res = await apiFetch<{ recovery_codes: string[] }>("/api/v1/auth/2fa/recovery-codes", {
        method: "POST",
        body: JSON.stringify({ current_password: twoFactorPassword, code: twoFactorCode }),
      });
      setRecoveryCodes(res.recovery_codes || []);
      setTwoFactorPassword("");
      setTwoFactorCode("");
      setTwoFactorStatus((current) => ({
        ...(current || { enabled: true }),
        enabled: true,
        recovery_codes_remaining: res.recovery_codes?.length || 0,
      }));
      push({ title: copy.toastRecoveryCreated, desc: copy.toastRecoveryCreatedDesc, type: "success" });
    } catch (e: any) {
      push({ title: copy.toastRecoveryError, desc: String(e?.message || e), type: "error" });
    } finally {
      setTwoFactorBusy(false);
    }
  }

  const todayLabel = React.useMemo(
    () =>
      localizeDigits(new Date().toLocaleDateString(isEn ? "en-US" : "fa-IR-u-ca-persian", {
        year: "numeric",
        month: "long",
        day: "numeric",
      }), digitStyle),
    [isEn, digitStyle]
  );
  const selectClass =
    "w-full rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(155deg,hsl(var(--surface-input-1))_0%,hsl(var(--surface-input-2))_55%,hsl(var(--surface-input-3))_100%)] px-3 py-2 text-sm outline-none transition-all duration-200 hover:border-[hsl(var(--accent)/0.32)] focus:border-[hsl(var(--accent)/0.45)] focus:ring-2 focus:ring-[hsl(var(--accent)/0.30)]";
  const choiceCardClass =
    "rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(150deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] px-3 py-2 text-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-[hsl(var(--accent)/0.35)]";
  const guideBoxClass =
    "max-w-full overflow-hidden break-words [overflow-wrap:anywhere] rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-3))]/60 p-3 text-xs leading-6 text-[hsl(var(--fg))]/75";
  const settingsTabs: Array<{ key: SettingsTabKey; label: string; desc: string; icon: React.ReactNode }> = [
    { key: "security" as const, label: copy.tabSecurity, desc: copy.tabSecurityDesc, icon: <ShieldCheck size={16} /> },
    { key: "appearance" as const, label: copy.tabAppearance, desc: copy.tabAppearanceDesc, icon: <Palette size={16} /> },
    { key: "defaults" as const, label: copy.tabDefaults, desc: copy.tabDefaultsDesc, icon: <Sparkles size={16} /> },
    { key: "policy" as const, label: copy.tabPolicy, desc: copy.tabPolicyDesc, icon: <KeyRound size={16} /> },
  ].filter((tab) => tab.key !== "policy" || me?.role === "admin");

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(115deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] p-4 shadow-[0_14px_28px_-20px_hsl(var(--fg)/0.35)] sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] px-3 py-1 text-xs text-[hsl(var(--fg))]/75">
              <Shield size={13} />
              {copy.heroEyebrow}
            </div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight">{copy.heroTitle}</h1>
            <p className="mt-1 text-sm text-[hsl(var(--fg))]/70">{copy.heroSubtitle}</p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(135deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] px-3 py-2 text-xs text-[hsl(var(--fg))]/75">
            <CalendarDays size={14} />
            <span>{todayLabel}</span>
          </div>
        </div>
      </section>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {settingsTabs.map((tab) => {
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={
                "flex items-center gap-3 rounded-xl border p-3 text-right transition-all duration-200 " +
                (active
                  ? "border-[hsl(var(--accent)/0.42)] bg-[hsl(var(--accent)/0.12)] text-[hsl(var(--fg))] shadow-[0_12px_28px_-22px_hsl(var(--accent)/0.9)]"
                  : "border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] text-[hsl(var(--fg))]/72 hover:border-[hsl(var(--accent)/0.30)] hover:bg-[hsl(var(--surface-card-3))]")
              }
            >
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--surface-card-3))] text-[hsl(var(--accent))]">
                {tab.icon}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-bold">{tab.label}</span>
                <span className="block truncate text-xs opacity-70">{tab.desc}</span>
              </span>
            </button>
          );
        })}
      </div>
      <style>{`
        .settings-tab-content:not([data-settings-tab="security"]) > .settings-logout {
          display: none;
        }
        .settings-tab-content[data-settings-tab="security"] > :nth-child(1),
        .settings-tab-content[data-settings-tab="security"] > :nth-child(3),
        .settings-tab-content[data-settings-tab="security"] > :nth-child(4),
        .settings-tab-content[data-settings-tab="security"] > :nth-child(5),
        .settings-tab-content[data-settings-tab="security"] > :nth-child(6) {
          display: none;
        }
        .settings-tab-content[data-settings-tab="appearance"] > :nth-child(n + 2) {
          display: none;
        }
        .settings-tab-content[data-settings-tab="defaults"] > :nth-child(1),
        .settings-tab-content[data-settings-tab="defaults"] > :nth-child(2),
        .settings-tab-content[data-settings-tab="defaults"] > :nth-child(5),
        .settings-tab-content[data-settings-tab="defaults"] > :nth-child(6) {
          display: none;
        }
        .settings-tab-content[data-settings-tab="policy"] > :nth-child(1),
        .settings-tab-content[data-settings-tab="policy"] > :nth-child(2),
        .settings-tab-content[data-settings-tab="policy"] > :nth-child(3),
        .settings-tab-content[data-settings-tab="policy"] > :nth-child(4) {
          display: none;
        }
      `}</style>

      <Card className={activeTab === "security" ? "overflow-hidden" : "hidden"}>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold">
                {twoFactorStatus?.enabled ? <ShieldCheck size={16} /> : <KeyRound size={16} />}
                {copy.twoFactorTitle}
                <HelpTip text={copy.twoFactorHelp} />
              </div>
              <div className="mt-1 text-xs leading-6 text-[hsl(var(--fg))]/70">{copy.twoFactorSubtitle}</div>
            </div>
            <div
              className={`rounded-full border px-3 py-1 text-xs ${
                twoFactorStatus?.enabled
                  ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : "border-amber-400/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
              }`}
            >
              {twoFactorStatus?.enabled ? copy.enabled : copy.disabled}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="hidden">{copy.twoFactorHelp}</div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <div className="text-xs text-[hsl(var(--fg))]/70">{copy.currentPasswordLabel}</div>
              <Input
                type="password"
                value={twoFactorPassword}
                onChange={(e) => setTwoFactorPassword(e.target.value)}
                autoComplete="current-password"
                placeholder={copy.currentPasswordPlaceholder}
              />
            </div>
            <div className="space-y-2">
              <div className="text-xs text-[hsl(var(--fg))]/70">{copy.authenticatorCodeLabel}</div>
              <Input
                value={twoFactorCode}
                onChange={(e) => setTwoFactorCode(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
              />
            </div>
          </div>

          {twoFactorSetup ? (
            <div className="space-y-3 rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(145deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] p-3">
              <div className="text-sm font-medium">{copy.setupKeyTitle}</div>
              <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                <div className="min-w-0 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] p-3 font-mono text-sm break-words [overflow-wrap:anywhere]">
                  {twoFactorSetup.secret}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={async () => {
                    const ok = await copyText(twoFactorSetup.secret);
                    push({ title: ok ? copy.toastSecretCopied : copy.toastCopyFailed, type: ok ? "success" : "error" });
                  }}
                >
                  <Copy size={15} className="ms-1" />
                  {copy.copySecret}
                </Button>
              </div>
              <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                <div className="min-w-0 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] p-3 text-xs break-words [overflow-wrap:anywhere] text-[hsl(var(--fg))]/75">
                  {twoFactorSetup.otpauth_uri}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={async () => {
                    const ok = await copyText(twoFactorSetup.otpauth_uri);
                    push({ title: ok ? copy.toastUriCopied : copy.toastCopyFailed, type: ok ? "success" : "error" });
                  }}
                >
                  <Copy size={15} className="ms-1" />
                  {copy.copyUri}
                </Button>
              </div>
              <div className="text-xs leading-6 text-[hsl(var(--fg))]/70">
                {copy.setupInstructions.replace("{account}", me?.username || "account")}
              </div>
            </div>
          ) : null}

          {recoveryCodes.length ? (
            <div className="space-y-3 rounded-xl border border-amber-400/35 bg-amber-500/10 p-3">
              <div className="text-sm font-semibold text-amber-800 dark:text-amber-200">{copy.recoveryCodesTitle}</div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                {recoveryCodes.map((code) => (
                  <div key={code} className="rounded-lg border border-amber-400/30 bg-[hsl(var(--surface-card-1))] px-2 py-2 text-center font-mono text-xs">
                    {code}
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={async () => {
                    const ok = await copyText(recoveryCodes.join("\n"));
                    push({ title: ok ? copy.toastRecoveryCopied : copy.toastCopyFailed, type: ok ? "success" : "error" });
                  }}
                >
                  <Copy size={15} className="ms-1" />
                  {copy.copyAll}
                </Button>
                <Button type="button" variant="outline" onClick={onLogout}>
                  {copy.secureRelogin}
                </Button>
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {twoFactorStatus?.enabled ? (
              <>
                <Button type="button" onClick={regenerateRecoveryCodes} disabled={twoFactorBusy}>
                  {copy.regenerateCodes}
                </Button>
                <Button type="button" variant="outline" onClick={disableTwoFactor} disabled={twoFactorBusy}>
                  {copy.disable2fa}
                </Button>
              </>
            ) : twoFactorSetup ? (
              <>
                <Button type="button" onClick={enableTwoFactor} disabled={twoFactorBusy}>
                  {copy.enable2fa}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setTwoFactorSetup(null);
                    setTwoFactorCode("");
                  }}
                  disabled={twoFactorBusy}
                >
                  {copy.cancelSetup}
                </Button>
              </>
            ) : (
              <Button type="button" onClick={startTwoFactorSetup} disabled={twoFactorBusy}>
                {copy.start2fa}
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setTwoFactorPassword("");
                setTwoFactorCode("");
              }}
              disabled={twoFactorBusy}
            >
              {copy.clearFields}
            </Button>
          </div>

          {twoFactorStatus?.enabled ? (
            <div className="grid gap-2 text-xs text-[hsl(var(--fg))]/65 sm:grid-cols-3">
              <div className="rounded-xl border border-[hsl(var(--border))] p-3">{copy.remainingCodes}: {twoFactorStatus.recovery_codes_remaining}</div>
              <div className="rounded-xl border border-[hsl(var(--border))] p-3">
                {copy.activatedAt}: {twoFactorStatus.confirmed_at ? localizeDigits(new Date(twoFactorStatus.confirmed_at).toLocaleString(isEn ? "en-US" : "fa-IR"), digitStyle) : "-"}
              </div>
              <div className="rounded-xl border border-[hsl(var(--border))] p-3">
                {copy.lastUsedAt}: {twoFactorStatus.last_used_at ? localizeDigits(new Date(twoFactorStatus.last_used_at).toLocaleString(isEn ? "en-US" : "fa-IR"), digitStyle) : "-"}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>
          <div className="text-xl font-semibold">{copy.settingsTitle}</div>
          <div className="text-sm text-[hsl(var(--fg))]/70">{copy.settingsSubtitle}</div>
        </CardHeader>
        <CardContent data-settings-tab={activeTab} className="settings-tab-content space-y-6">
          <div className={activeTab === "appearance" ? "grid gap-4 md:grid-cols-2 xl:grid-cols-4" : "hidden"}>
            <div className="space-y-2 rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(145deg,hsl(var(--surface-page-glow-1)/0.20),hsl(var(--surface-card-1))_78%)] p-4 shadow-[0_10px_24px_-20px_hsl(var(--surface-page-glow-1)/0.75)]">
              <div className="text-sm font-medium flex items-center gap-2"><Sparkles size={15} /> {copy.displayMode}</div>
              <div className="flex flex-wrap gap-2">
                <Button variant={theme === "light" ? "primary" : "outline"} onClick={() => setTheme("light")}>{copy.light}</Button>
                <Button variant={theme === "dark" ? "primary" : "outline"} onClick={() => setTheme("dark")}>{copy.dark}</Button>
                <Button variant={theme === "system" ? "primary" : "outline"} onClick={() => setTheme("system")}>{copy.system}</Button>
              </div>
            </div>

            <div className="space-y-2 rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(145deg,hsl(var(--accent)/0.20),hsl(var(--surface-card-1))_78%)] p-4 shadow-[0_10px_24px_-20px_hsl(var(--accent)/0.72)]">
              <div className="text-sm font-medium flex items-center gap-2"><Palette size={15} /> {copy.accentColor}</div>
              <div className="flex flex-wrap gap-2">
                {accentOptions.map((a) => (
                  <Button
                    key={a}
                    variant={accent === a ? "primary" : "outline"}
                    onClick={() => {
                      setAccentState(a);
                      setAccent(a);
                    }}
                  >
                    {a}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-2 rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(145deg,hsl(var(--surface-page-glow-2)/0.20),hsl(var(--surface-card-1))_78%)] p-4 shadow-[0_10px_24px_-20px_hsl(var(--surface-page-glow-2)/0.75)]">
              <div className="text-sm font-medium flex items-center gap-2"><Palette size={15} /> {copy.colorPreset}</div>
              <div className="flex flex-wrap gap-2">
                {presetOptions.map((p) => (
                  <Button
                    key={p.key}
                    variant={preset === p.key ? "primary" : "outline"}
                    onClick={() => {
                      setPresetState(p.key);
                      setThemePreset(p.key);
                    }}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
              <div className="text-xs text-[hsl(var(--fg))]/70">{copy.presetHint}</div>
            </div>

            <div className="space-y-3 rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(145deg,hsl(var(--surface-page-glow-1)/0.16),hsl(var(--surface-card-1))_78%)] p-4 shadow-[0_10px_24px_-20px_hsl(var(--surface-page-glow-1)/0.72)]">
              <div className="flex items-center gap-2 text-sm font-medium"><Hash size={15} /> {copy.digitStyleTitle}</div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Button
                  variant={digitStyle === "latin" ? "primary" : "outline"}
                  onClick={() => setDigitStyle("latin")}
                >
                  {copy.digitLatin}
                </Button>
                <Button
                  variant={digitStyle === "persian" ? "primary" : "outline"}
                  onClick={() => setDigitStyle("persian")}
                >
                  {copy.digitPersian}
                </Button>
              </div>
              <div className="text-xs leading-5 text-[hsl(var(--fg))]/70">{copy.digitStyleHint}</div>
            </div>
          </div>

          <Card className="overflow-hidden">
            <CardHeader>
              <div className="text-sm font-semibold">{copy.passwordTitle}</div>
              <div className="text-xs text-[hsl(var(--fg))]/70">{copy.passwordDesc}</div>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-3 bg-[linear-gradient(145deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)]">
              <Input type="password" placeholder={copy.currentPassword} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
              <Input type="password" placeholder={copy.newPassword} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              <Input type="password" placeholder={copy.confirmPassword} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
              <div className="md:col-span-3 flex gap-2">
                <Button type="button" onClick={changePassword} disabled={pwdBusy}>{copy.saveNewPassword}</Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setCurrentPassword("");
                    setNewPassword("");
                    setConfirmPassword("");
                  }}
                >
                  {copy.clear}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader>
              <div className="text-sm font-semibold">{copy.userDefaultsTitle}</div>
              <div className="text-xs text-[hsl(var(--fg))]/70">{copy.userDefaultsDesc}</div>
            </CardHeader>
            <CardContent className="space-y-4">
              {loadingDefaults ? <div className="text-xs text-[hsl(var(--fg))]/70">{copy.loading}</div> : null}
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <div className="text-xs text-[hsl(var(--fg))]/70">{copy.pricingModel}</div>
                  <select
                    className={selectClass}
                    value={resellerDefaults.default_pricing_mode}
                    onChange={(e) =>
                      setResellerDefaults((v) => ({ ...v, default_pricing_mode: e.target.value as UserDefaults["default_pricing_mode"] }))
                    }
                  >
                    <option value="bundle">Bundle</option>
                    <option value="per_node">Per Node</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <div className="text-xs text-[hsl(var(--fg))]/70">{copy.nodeMode}</div>
                  <select
                    className={selectClass}
                    value={resellerDefaults.default_node_mode}
                    onChange={(e) =>
                      setResellerDefaults((v) => ({ ...v, default_node_mode: e.target.value as UserDefaults["default_node_mode"] }))
                    }
                  >
                    <option value="all">{copy.allNodes}</option>
                    <option value="manual">{copy.manual}</option>
                    <option value="group">{copy.group}</option>
                  </select>
                </div>

                <div className="space-y-2 md:col-span-2 max-w-full overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] p-3 break-words [overflow-wrap:anywhere]">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-medium">{copy.masterSubTitle}</div>
                      <div className="text-xs leading-6 text-[hsl(var(--fg))]/70">{copy.masterSubHint}</div>
                    </div>
                    <Switch
                      checked={!!resellerDefaults.show_guardino_master_sub}
                      onCheckedChange={(v) => setResellerDefaults((x) => ({ ...x, show_guardino_master_sub: v }))}
                    />
                  </div>
                </div>

                {resellerDefaults.default_node_mode === "manual" ? (
                  <div className="space-y-2 md:col-span-2 rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(145deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] p-3">
                    <div className="text-xs text-[hsl(var(--fg))]/70">{copy.manualNodes}</div>
                    <div className="flex flex-wrap gap-2">
                      <Input placeholder={copy.searchNode} value={resellerNodeQ} onChange={(e) => setResellerNodeQ(e.target.value)} />
                      <Button type="button" variant="outline" onClick={() => setResellerDefaults((v) => ({ ...v, default_node_ids: resellerNodes.map((n) => n.id) }))}>{copy.selectAll}</Button>
                      <Button type="button" variant="outline" onClick={() => setResellerDefaults((v) => ({ ...v, default_node_ids: [] }))}>{copy.clear}</Button>
                    </div>
                    <div className="grid gap-2 md:grid-cols-2">
                      {resellerFilteredNodes.map((n) => (
                        <label key={n.id} className={`flex items-center gap-2 ${choiceCardClass}`}>
                          <input
                            type="checkbox"
                            checked={(resellerDefaults.default_node_ids || []).includes(n.id)}
                            onChange={(e) =>
                              setResellerDefaults((v) => ({
                                ...v,
                                default_node_ids: toggleId(v.default_node_ids || [], n.id, e.target.checked),
                              }))
                            }
                          />
                          <span className="truncate">{n.name} (#{n.id}) {n.panel_type ? `• ${n.panel_type}` : ""}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ) : null}

                {resellerDefaults.default_node_mode === "group" ? (
                  <div className="space-y-2 md:col-span-2">
                    <div className="text-xs text-[hsl(var(--fg))]/70">{copy.defaultTag}</div>
                    <select
                      className={selectClass}
                      value={resellerDefaults.default_node_group || ""}
                      onChange={(e) => setResellerDefaults((v) => ({ ...v, default_node_group: e.target.value }))}
                    >
                      <option value="">{copy.choose}</option>
                      {resellerTagOptions.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                ) : null}

                <div className="space-y-2">
                  <div className="text-xs text-[hsl(var(--fg))]/70">{copy.usernamePrefix}</div>
                  <Input value={resellerDefaults.label_prefix} onChange={(e) => setResellerDefaults((v) => ({ ...v, label_prefix: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <div className="text-xs text-[hsl(var(--fg))]/70">{copy.usernameSuffix}</div>
                  <Input value={resellerDefaults.label_suffix} onChange={(e) => setResellerDefaults((v) => ({ ...v, label_suffix: e.target.value }))} />
                </div>
                <div className="md:col-span-2 max-w-full overflow-hidden break-words text-xs leading-6 text-[hsl(var(--fg))]/65 [overflow-wrap:anywhere]">
                  {copy.usernameHint}
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="button" onClick={saveResellerDefaults}>{copy.save}</Button>
                <Button type="button" variant="outline" onClick={loadDefaults}>{copy.reload}</Button>
              </div>
            </CardContent>
          </Card>

          {me?.role === "admin" ? (
            <>
            <Card className="overflow-hidden">
              <CardHeader>
                <div className="text-sm font-semibold">{copy.globalDefaultsTitle}</div>
                <div className="text-xs text-[hsl(var(--fg))]/70">{copy.globalDefaultsDesc}</div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <div className="text-xs text-[hsl(var(--fg))]/70">{copy.pricingModel}</div>
                    <select
                      className={selectClass}
                      value={globalDefaults.default_pricing_mode}
                      onChange={(e) =>
                        setGlobalDefaults((v) => ({ ...v, default_pricing_mode: e.target.value as UserDefaults["default_pricing_mode"] }))
                      }
                    >
                      <option value="bundle">Bundle</option>
                      <option value="per_node">Per Node</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs text-[hsl(var(--fg))]/70">{copy.nodeMode}</div>
                    <select
                      className={selectClass}
                      value={globalDefaults.default_node_mode}
                      onChange={(e) =>
                        setGlobalDefaults((v) => ({ ...v, default_node_mode: e.target.value as UserDefaults["default_node_mode"] }))
                      }
                    >
                      <option value="all">{copy.allNodes}</option>
                      <option value="manual">{copy.manual}</option>
                      <option value="group">{copy.group}</option>
                    </select>
                  </div>

                  <div className="space-y-2 md:col-span-2 max-w-full overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] p-3 break-words [overflow-wrap:anywhere]">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-xs font-medium">{copy.masterSubTitle}</div>
                        <div className="text-xs leading-6 text-[hsl(var(--fg))]/70">{copy.globalMasterSubHint}</div>
                      </div>
                      <Switch
                        checked={!!globalDefaults.show_guardino_master_sub}
                        onCheckedChange={(v) => setGlobalDefaults((x) => ({ ...x, show_guardino_master_sub: v }))}
                      />
                    </div>
                  </div>

                  {globalDefaults.default_node_mode === "manual" ? (
                    <div className="space-y-2 md:col-span-2 rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(145deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] p-3">
                      <div className="text-xs text-[hsl(var(--fg))]/70">{copy.globalManualNodes}</div>
                      <div className="flex flex-wrap gap-2">
                        <Input placeholder={copy.searchNode} value={globalNodeQ} onChange={(e) => setGlobalNodeQ(e.target.value)} />
                        <Button type="button" variant="outline" onClick={() => setGlobalDefaults((v) => ({ ...v, default_node_ids: adminNodes.map((n) => n.id) }))}>{copy.selectAll}</Button>
                        <Button type="button" variant="outline" onClick={() => setGlobalDefaults((v) => ({ ...v, default_node_ids: [] }))}>{copy.clear}</Button>
                      </div>
                      <div className="grid gap-2 md:grid-cols-2">
                        {globalFilteredNodes.map((n) => (
                          <label key={n.id} className={`flex items-center gap-2 ${choiceCardClass}`}>
                            <input
                              type="checkbox"
                              checked={(globalDefaults.default_node_ids || []).includes(n.id)}
                              onChange={(e) =>
                                setGlobalDefaults((v) => ({
                                  ...v,
                                  default_node_ids: toggleId(v.default_node_ids || [], n.id, e.target.checked),
                                }))
                              }
                            />
                            <span className="truncate">{n.name} (#{n.id}) {n.panel_type ? `• ${n.panel_type}` : ""}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {globalDefaults.default_node_mode === "group" ? (
                    <div className="space-y-2 md:col-span-2">
                      <div className="text-xs text-[hsl(var(--fg))]/70">{copy.globalDefaultTag}</div>
                      <select
                        className={selectClass}
                        value={globalDefaults.default_node_group || ""}
                        onChange={(e) => setGlobalDefaults((v) => ({ ...v, default_node_group: e.target.value }))}
                      >
                        <option value="">{copy.choose}</option>
                        {globalTagOptions.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </div>
                  ) : null}

                  <div className="space-y-2">
                    <div className="text-xs text-[hsl(var(--fg))]/70">{copy.usernamePrefix}</div>
                    <Input value={globalDefaults.label_prefix} onChange={(e) => setGlobalDefaults((v) => ({ ...v, label_prefix: e.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs text-[hsl(var(--fg))]/70">{copy.usernameSuffix}</div>
                    <Input value={globalDefaults.label_suffix} onChange={(e) => setGlobalDefaults((v) => ({ ...v, label_suffix: e.target.value }))} />
                  </div>
                  <div className="md:col-span-2 max-w-full overflow-hidden break-words text-xs leading-6 text-[hsl(var(--fg))]/65 [overflow-wrap:anywhere]">
                    {copy.globalUsernameHint}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button type="button" onClick={saveGlobalDefaults}>{copy.saveGlobal}</Button>
                  <Button type="button" variant="outline" onClick={loadDefaults}>{copy.reload}</Button>
                </div>
              </CardContent>
            </Card>

            <Card className="overflow-hidden">
              <CardHeader>
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <span>{copy.creationPolicyTitle}</span>
                  <HelpTip text={copy.creationPolicyHelp} />
                </div>
                <div className="text-xs text-[hsl(var(--fg))]/70">{copy.creationPolicyDesc}</div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="hidden">{copy.creationPolicyHelp}</div>

                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] p-3">
                  <div>
                    <div className="text-sm font-medium">{copy.creationPolicyEnabledTitle}</div>
                    <div className="text-xs leading-6 text-[hsl(var(--fg))]/65">{copy.creationPolicyEnabledDesc}</div>
                  </div>
                  <Switch checked={globalPolicy.enabled} onCheckedChange={(v) => setGlobalPolicy((x) => normalizePolicy({ ...x, enabled: v }))} />
                </div>
                <div className="hidden">{copy.creationPolicyHelp}</div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="space-y-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] p-3">
                    <div className="text-xs font-medium text-[hsl(var(--fg))]/80">{copy.durationPackages}</div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {DURATION_PRESET_OPTIONS.map((preset) => {
                        const disabled = preset === "unlimited" && !globalPolicy.allow_no_expire;
                        return (
                          <label key={preset} className={`flex items-center gap-2 ${choiceCardClass} ${disabled ? "opacity-55" : ""}`}>
                            <input
                              type="checkbox"
                              checked={(globalPolicy.allowed_duration_presets || []).includes(preset)}
                              disabled={disabled}
                              onChange={(e) =>
                                setGlobalPolicy((x) =>
                                  normalizePolicy({
                                    ...x,
                                    allowed_duration_presets: toggleString(x.allowed_duration_presets || [], preset, e.target.checked),
                                  })
                                )
                              }
                            />
                            <span>{durationPresetLabel(preset, lang)}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  <div className="space-y-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] p-3">
                    <div className="text-xs font-medium text-[hsl(var(--fg))]/80">{copy.trafficPackages}</div>
                    <div className="flex flex-wrap gap-2">
                      {TRAFFIC_PRESET_OPTIONS.map((gb) => (
                        <label key={gb} className={`flex items-center gap-2 ${choiceCardClass}`}>
                          <input
                            type="checkbox"
                            checked={(globalPolicy.allowed_traffic_gb || []).includes(gb)}
                            onChange={(e) =>
                              setGlobalPolicy((x) =>
                                normalizePolicy({
                                  ...x,
                                  allowed_traffic_gb: toggleNumber(x.allowed_traffic_gb || [], gb, e.target.checked),
                                })
                              )
                            }
                          />
                          <span>{gb}GB</span>
                        </label>
                      ))}
                    </div>
                    <Input
                      value={globalTrafficInput}
                      onChange={(e) => setGlobalTrafficInput(e.target.value)}
                      onBlur={() => {
                        const parsed = parseTrafficInput(globalTrafficInput);
                        if (parsed.length) {
                          setGlobalPolicy((x) => normalizePolicy({ ...x, allowed_traffic_gb: parsed }));
                        } else {
                          setGlobalTrafficInput((globalPolicy.allowed_traffic_gb || []).join(", "));
                        }
                      }}
                      placeholder={copy.trafficPlaceholder}
                    />
                  </div>

                  <div className="space-y-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] p-3">
                    <div className="text-xs font-medium text-[hsl(var(--fg))]/80">{copy.dayControl}</div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm">{copy.allowManualDays}</span>
                      <Switch checked={globalPolicy.allow_custom_days} onCheckedChange={(v) => setGlobalPolicy((x) => normalizePolicy({ ...x, allow_custom_days: v }))} />
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Input
                        type="number"
                        min={1}
                        value={globalPolicy.min_days}
                        onChange={(e) => setGlobalPolicy((x) => normalizePolicy({ ...x, min_days: Number(e.target.value) || 1 }))}
                        placeholder={copy.minDays}
                      />
                      <Input
                        type="number"
                        min={1}
                        value={globalPolicy.max_days}
                        onChange={(e) => setGlobalPolicy((x) => normalizePolicy({ ...x, max_days: Number(e.target.value) || x.min_days || 1 }))}
                        placeholder={copy.maxDays}
                      />
                    </div>
                  </div>

                  <div className="space-y-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] p-3">
                    <div className="text-xs font-medium text-[hsl(var(--fg))]/80">{copy.extraCreation}</div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm">{copy.allowManualTraffic}</span>
                      <Switch checked={globalPolicy.allow_custom_traffic} onCheckedChange={(v) => setGlobalPolicy((x) => normalizePolicy({ ...x, allow_custom_traffic: v }))} />
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm">{copy.allowUnlimitedPlan}</span>
                      <Switch checked={globalPolicy.allow_no_expire} onCheckedChange={(v) => setGlobalPolicy((x) => normalizePolicy({ ...x, allow_no_expire: v }))} />
                    </div>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button type="button" onClick={saveGlobalPolicy}>{copy.saveGlobalPolicy}</Button>
                  <Button type="button" variant="outline" onClick={loadDefaults}>{copy.reload}</Button>
                </div>
              </CardContent>
            </Card>

            <Card className="overflow-hidden">
              <CardHeader>
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <span>{copy.lifecyclePolicyTitle}</span>
                  <HelpTip text={copy.lifecyclePolicyHelp} />
                </div>
                <div className="text-xs text-[hsl(var(--fg))]/70">{copy.lifecyclePolicyDesc}</div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="hidden">{copy.lifecyclePolicyHelp}</div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="flex items-center justify-between rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] p-3">
                    <span className="text-sm">{copy.allowUserDelete}</span>
                    <Switch checked={globalPolicy.allow_user_delete} onCheckedChange={(v) => setGlobalPolicy((x) => normalizePolicy({ ...x, allow_user_delete: v }))} />
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] p-3">
                    <span className="text-sm">{copy.allowResetUsage}</span>
                    <Switch checked={globalPolicy.allow_reset_usage} onCheckedChange={(v) => setGlobalPolicy((x) => normalizePolicy({ ...x, allow_reset_usage: v }))} />
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs text-[hsl(var(--fg))]/70">{copy.refundWindow}</div>
                    <Input
                      type="number"
                      min={0}
                      value={globalPolicy.delete_refund_window_days}
                      onChange={(e) => setGlobalPolicy((x) => normalizePolicy({ ...x, delete_refund_window_days: Number(e.target.value) || 0 }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs text-[hsl(var(--fg))]/70">{copy.maxDeleteUsage}</div>
                    <Input
                      type="number"
                      min={0}
                      step="0.1"
                      value={globalPolicy.delete_expired_used_gb_limit}
                      onChange={(e) => setGlobalPolicy((x) => normalizePolicy({ ...x, delete_expired_used_gb_limit: Number(e.target.value) || 0 }))}
                    />
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] p-3 md:col-span-2">
                    <span className="text-sm">{copy.renewalOnly}</span>
                    <Switch checked={globalPolicy.restrict_edit_to_renewal_only} onCheckedChange={(v) => setGlobalPolicy((x) => normalizePolicy({ ...x, restrict_edit_to_renewal_only: v }))} />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <div className="text-xs text-[hsl(var(--fg))]/70">{copy.packageRenewalPolicy}</div>
                    <select
                      className={selectClass}
                      value={globalPolicy.renewal_policy}
                      onChange={(e) => setGlobalPolicy((x) => normalizePolicy({ ...x, renewal_policy: e.target.value as ResellerUserPolicy["renewal_policy"] }))}
                    >
                      <option value="reset_time_and_volume">{copy.resetTimeAndVolume}</option>
                      <option value="add_time_and_volume">{copy.addTimeAndVolume}</option>
                      <option value="reset_time_carry_volume">{copy.resetTimeCarryVolume}</option>
                      <option value="reset_volume_carry_time">{copy.resetVolumeCarryTime}</option>
                    </select>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button type="button" onClick={saveGlobalPolicy}>{copy.saveGlobalPolicy}</Button>
                  <Button type="button" variant="outline" onClick={loadDefaults}>{copy.reload}</Button>
                </div>
              </CardContent>
            </Card>
            </>
          ) : null}

          <div className="settings-logout pt-2">
            <Button variant="outline" onClick={onLogout}>{copy.logout}</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
