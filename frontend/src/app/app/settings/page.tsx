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
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/components/auth-context";
import { CalendarDays, Palette, Shield, Sparkles } from "lucide-react";

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

const EMPTY_DEFAULTS: UserDefaults = {
  default_pricing_mode: "bundle",
  default_node_mode: "all",
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
  allow_user_delete: true,
  allow_reset_usage: true,
  restrict_edit_to_renewal_only: false,
  renewal_policy: "add_time_and_volume",
  min_days: 1,
  max_days: 3650,
  delete_refund_window_days: 10,
  delete_expired_used_gb_limit: 1,
  allowed_duration_presets: ["7d", "1m", "3m", "6m", "1y"],
  allowed_traffic_gb: [20, 30, 50, 70, 100, 150, 200],
};

function normalizePolicy(raw: Partial<ResellerUserPolicy> | null | undefined): ResellerUserPolicy {
  const p = { ...EMPTY_POLICY, ...(raw || {}) };
  return {
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
    allowed_duration_presets: Array.isArray(p.allowed_duration_presets) ? p.allowed_duration_presets : EMPTY_POLICY.allowed_duration_presets,
    allowed_traffic_gb: Array.isArray(p.allowed_traffic_gb) ? p.allowed_traffic_gb : EMPTY_POLICY.allowed_traffic_gb,
  };
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

  const [loadingDefaults, setLoadingDefaults] = React.useState(true);
  const [resellerDefaults, setResellerDefaults] = React.useState<UserDefaults>(EMPTY_DEFAULTS);
  const [globalDefaults, setGlobalDefaults] = React.useState<UserDefaults>(EMPTY_DEFAULTS);
  const [globalPolicy, setGlobalPolicy] = React.useState<ResellerUserPolicy>(EMPTY_POLICY);

  const [resellerNodes, setResellerNodes] = React.useState<NodeLite[]>([]);
  const [adminNodes, setAdminNodes] = React.useState<NodeLite[]>([]);
  const [resellerNodeQ, setResellerNodeQ] = React.useState("");
  const [globalNodeQ, setGlobalNodeQ] = React.useState("");

  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [pwdBusy, setPwdBusy] = React.useState(false);

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
        setGlobalPolicy(normalizePolicy(gp));
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
      push({ title: "خطا در دریافت تنظیمات", desc: String(e?.message || e), type: "error" });
    } finally {
      setLoadingDefaults(false);
    }
  }

  React.useEffect(() => {
    loadDefaults();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.role]);

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
      push({ title: "تنظیمات ذخیره شد", type: "success" });
    } catch (e: any) {
      push({ title: "خطا در ذخیره تنظیمات", desc: String(e?.message || e), type: "error" });
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
      push({ title: "پیش‌فرض سراسری ذخیره شد", type: "success" });
    } catch (e: any) {
      push({ title: "خطا در ذخیره پیش‌فرض سراسری", desc: String(e?.message || e), type: "error" });
    }
  }

  async function saveGlobalPolicy() {
    try {
      const saved = await apiFetch<ResellerUserPolicy>("/api/v1/admin/settings/user-policy", {
        method: "PUT",
        body: JSON.stringify(normalizePolicy(globalPolicy)),
      });
      setGlobalPolicy(normalizePolicy(saved));
      push({ title: "سیاست سراسری ذخیره شد", type: "success" });
    } catch (e: any) {
      push({ title: "خطا در ذخیره سیاست سراسری", desc: String(e?.message || e), type: "error" });
    }
  }

  async function changePassword() {
    if (!currentPassword || !newPassword || !confirmPassword) {
      push({ title: "همه فیلدهای رمز را کامل کنید", type: "warning" });
      return;
    }
    if (newPassword !== confirmPassword) {
      push({ title: "تکرار رمز جدید با رمز جدید یکسان نیست", type: "warning" });
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
      push({ title: "رمز عبور با موفقیت تغییر کرد", type: "success" });
    } catch (e: any) {
      push({ title: "خطا در تغییر رمز", desc: String(e?.message || e), type: "error" });
    } finally {
      setPwdBusy(false);
    }
  }

  const todayFa = React.useMemo(
    () =>
      new Date().toLocaleDateString("fa-IR-u-ca-persian", {
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
    []
  );
  const selectClass =
    "w-full rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(155deg,hsl(var(--surface-input-1))_0%,hsl(var(--surface-input-2))_55%,hsl(var(--surface-input-3))_100%)] px-3 py-2 text-sm outline-none transition-all duration-200 hover:border-[hsl(var(--accent)/0.32)] focus:border-[hsl(var(--accent)/0.45)] focus:ring-2 focus:ring-[hsl(var(--accent)/0.30)]";
  const choiceCardClass =
    "rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(150deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] px-3 py-2 text-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-[hsl(var(--accent)/0.35)]";
  const guideBoxClass =
    "max-w-full overflow-hidden break-words [overflow-wrap:anywhere] rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-3))]/60 p-3 text-xs leading-6 text-[hsl(var(--fg))]/75";

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(115deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] p-4 shadow-[0_14px_28px_-20px_hsl(var(--fg)/0.35)] sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] px-3 py-1 text-xs text-[hsl(var(--fg))]/75">
              <Shield size={13} />
              امنیت و ظاهر
            </div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight">تنظیمات پنل</h1>
            <p className="mt-1 text-sm text-[hsl(var(--fg))]/70">مدیریت ظاهر، پیش‌فرض‌های ساخت کاربر و امنیت حساب</p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(135deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] px-3 py-2 text-xs text-[hsl(var(--fg))]/75">
            <CalendarDays size={14} />
            <span>{todayFa}</span>
          </div>
        </div>
      </section>

      <Card className="overflow-hidden">
        <CardHeader>
          <div className="text-xl font-semibold">تنظیمات</div>
          <div className="text-sm text-[hsl(var(--fg))]/70">تنظیمات ظاهری، پیش‌فرض‌ها و امنیت حساب</div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-2 rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(145deg,hsl(var(--surface-page-glow-1)/0.20),hsl(var(--surface-card-1))_78%)] p-4 shadow-[0_10px_24px_-20px_hsl(var(--surface-page-glow-1)/0.75)]">
              <div className="text-sm font-medium flex items-center gap-2"><Sparkles size={15} /> حالت نمایش</div>
              <div className="flex flex-wrap gap-2">
                <Button variant={theme === "light" ? "primary" : "outline"} onClick={() => setTheme("light")}>روشن</Button>
                <Button variant={theme === "dark" ? "primary" : "outline"} onClick={() => setTheme("dark")}>تیره</Button>
                <Button variant={theme === "system" ? "primary" : "outline"} onClick={() => setTheme("system")}>سیستمی</Button>
              </div>
            </div>

            <div className="space-y-2 rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(145deg,hsl(var(--accent)/0.20),hsl(var(--surface-card-1))_78%)] p-4 shadow-[0_10px_24px_-20px_hsl(var(--accent)/0.72)]">
              <div className="text-sm font-medium flex items-center gap-2"><Palette size={15} /> رنگ اصلی</div>
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
              <div className="text-sm font-medium flex items-center gap-2"><Palette size={15} /> پریست رنگی</div>
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
              <div className="text-xs text-[hsl(var(--fg))]/70">
                preset تم، گرادیانت باکس‌ها و نور پس‌زمینه کل پنل را یک‌جا تغییر می‌دهد.
              </div>
            </div>
          </div>

          <Card className="overflow-hidden">
            <CardHeader>
              <div className="text-sm font-semibold">تغییر رمز عبور</div>
              <div className="text-xs text-[hsl(var(--fg))]/70">برای امنیت بیشتر، رمز جدید حداقل ۸ کاراکتر انتخاب کنید.</div>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-3 bg-[linear-gradient(145deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)]">
              <Input type="password" placeholder="رمز فعلی" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
              <Input type="password" placeholder="رمز جدید" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              <Input type="password" placeholder="تکرار رمز جدید" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
              <div className="md:col-span-3 flex gap-2">
                <Button type="button" onClick={changePassword} disabled={pwdBusy}>ذخیره رمز جدید</Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setCurrentPassword("");
                    setNewPassword("");
                    setConfirmPassword("");
                  }}
                >
                  پاک کردن
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader>
              <div className="text-sm font-semibold">پیش‌فرض ساخت کاربر (حساب شما)</div>
              <div className="text-xs text-[hsl(var(--fg))]/70">این تنظیمات فرم ساخت کاربر را برای شما آماده می‌کند.</div>
            </CardHeader>
            <CardContent className="space-y-4">
              {loadingDefaults ? <div className="text-xs text-[hsl(var(--fg))]/70">در حال بارگذاری...</div> : null}
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <div className="text-xs text-[hsl(var(--fg))]/70">مدل قیمت پیش‌فرض</div>
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
                  <div className="text-xs text-[hsl(var(--fg))]/70">حالت نود پیش‌فرض</div>
                  <select
                    className={selectClass}
                    value={resellerDefaults.default_node_mode}
                    onChange={(e) =>
                      setResellerDefaults((v) => ({ ...v, default_node_mode: e.target.value as UserDefaults["default_node_mode"] }))
                    }
                  >
                    <option value="all">همه نودها</option>
                    <option value="manual">انتخاب دستی</option>
                    <option value="group">گروهی (Tag)</option>
                  </select>
                </div>

                <div className="space-y-2 md:col-span-2 max-w-full overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] p-3 break-words [overflow-wrap:anywhere]">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-medium">ساب مرکزی Guardino</div>
                      <div className="text-xs leading-6 text-[hsl(var(--fg))]/70">اگر روشن باشد لینک تجمیعی Guardino کنار لینک‌های مستقیم کاربر نمایش داده می‌شود. اگر خاموش باشد فقط لینک‌های مستقیم پنل‌ها دیده می‌شوند.</div>
                    </div>
                    <Switch
                      checked={!!resellerDefaults.show_guardino_master_sub}
                      onCheckedChange={(v) => setResellerDefaults((x) => ({ ...x, show_guardino_master_sub: v }))}
                    />
                  </div>
                </div>

                {resellerDefaults.default_node_mode === "manual" ? (
                  <div className="space-y-2 md:col-span-2 rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(145deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] p-3">
                    <div className="text-xs text-[hsl(var(--fg))]/70">انتخاب نودهای پیش‌فرض (حالت دستی)</div>
                    <div className="flex flex-wrap gap-2">
                      <Input placeholder="جستجوی نود" value={resellerNodeQ} onChange={(e) => setResellerNodeQ(e.target.value)} />
                      <Button type="button" variant="outline" onClick={() => setResellerDefaults((v) => ({ ...v, default_node_ids: resellerNodes.map((n) => n.id) }))}>انتخاب همه</Button>
                      <Button type="button" variant="outline" onClick={() => setResellerDefaults((v) => ({ ...v, default_node_ids: [] }))}>پاک کردن</Button>
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
                    <div className="text-xs text-[hsl(var(--fg))]/70">Tag پیش‌فرض (فقط حالت گروهی)</div>
                    <select
                      className={selectClass}
                      value={resellerDefaults.default_node_group || ""}
                      onChange={(e) => setResellerDefaults((v) => ({ ...v, default_node_group: e.target.value }))}
                    >
                      <option value="">انتخاب کنید</option>
                      {resellerTagOptions.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                ) : null}

                <div className="space-y-2">
                  <div className="text-xs text-[hsl(var(--fg))]/70">پیشوند نام کاربری</div>
                  <Input value={resellerDefaults.label_prefix} onChange={(e) => setResellerDefaults((v) => ({ ...v, label_prefix: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <div className="text-xs text-[hsl(var(--fg))]/70">پسوند نام کاربری</div>
                  <Input value={resellerDefaults.label_suffix} onChange={(e) => setResellerDefaults((v) => ({ ...v, label_suffix: e.target.value }))} />
                </div>
                <div className="md:col-span-2 max-w-full overflow-hidden break-words text-xs leading-6 text-[hsl(var(--fg))]/65 [overflow-wrap:anywhere]">
                  همین مقدار هم در گاردینو و هم در پنل‌های مقصد به عنوان نام کاربری نهایی استفاده می‌شود.
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="button" onClick={saveResellerDefaults}>ذخیره</Button>
                <Button type="button" variant="outline" onClick={loadDefaults}>بارگذاری مجدد</Button>
              </div>
            </CardContent>
          </Card>

          {me?.role === "admin" ? (
            <>
            <Card className="overflow-hidden">
              <CardHeader>
                <div className="text-sm font-semibold">پیش‌فرض سراسری برای همه رسیلرها (ادمین)</div>
                <div className="text-xs text-[hsl(var(--fg))]/70">رسیلرهایی که تنظیم اختصاصی ندارند از این مقادیر استفاده می‌کنند.</div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <div className="text-xs text-[hsl(var(--fg))]/70">مدل قیمت پیش‌فرض</div>
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
                    <div className="text-xs text-[hsl(var(--fg))]/70">حالت نود پیش‌فرض</div>
                    <select
                      className={selectClass}
                      value={globalDefaults.default_node_mode}
                      onChange={(e) =>
                        setGlobalDefaults((v) => ({ ...v, default_node_mode: e.target.value as UserDefaults["default_node_mode"] }))
                      }
                    >
                      <option value="all">همه نودها</option>
                      <option value="manual">انتخاب دستی</option>
                      <option value="group">گروهی (Tag)</option>
                    </select>
                  </div>

                  <div className="space-y-2 md:col-span-2 max-w-full overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] p-3 break-words [overflow-wrap:anywhere]">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-xs font-medium">ساب مرکزی Guardino</div>
                        <div className="text-xs leading-6 text-[hsl(var(--fg))]/70">مقدار پیش‌فرض برای رسیلرهایی است که تنظیم اختصاصی ندارند. روشن بودن این گزینه فقط نمایش لینک مرکزی را فعال می‌کند؛ لینک‌های مستقیم همیشه جداگانه باقی می‌مانند.</div>
                      </div>
                      <Switch
                        checked={!!globalDefaults.show_guardino_master_sub}
                        onCheckedChange={(v) => setGlobalDefaults((x) => ({ ...x, show_guardino_master_sub: v }))}
                      />
                    </div>
                  </div>

                  {globalDefaults.default_node_mode === "manual" ? (
                    <div className="space-y-2 md:col-span-2 rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(145deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] p-3">
                      <div className="text-xs text-[hsl(var(--fg))]/70">انتخاب نودهای پیش‌فرض (سراسری)</div>
                      <div className="flex flex-wrap gap-2">
                        <Input placeholder="جستجوی نود" value={globalNodeQ} onChange={(e) => setGlobalNodeQ(e.target.value)} />
                        <Button type="button" variant="outline" onClick={() => setGlobalDefaults((v) => ({ ...v, default_node_ids: adminNodes.map((n) => n.id) }))}>انتخاب همه</Button>
                        <Button type="button" variant="outline" onClick={() => setGlobalDefaults((v) => ({ ...v, default_node_ids: [] }))}>پاک کردن</Button>
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
                      <div className="text-xs text-[hsl(var(--fg))]/70">Tag پیش‌فرض (سراسری)</div>
                      <select
                        className={selectClass}
                        value={globalDefaults.default_node_group || ""}
                        onChange={(e) => setGlobalDefaults((v) => ({ ...v, default_node_group: e.target.value }))}
                      >
                        <option value="">انتخاب کنید</option>
                        {globalTagOptions.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </div>
                  ) : null}

                  <div className="space-y-2">
                    <div className="text-xs text-[hsl(var(--fg))]/70">پیشوند نام کاربری</div>
                    <Input value={globalDefaults.label_prefix} onChange={(e) => setGlobalDefaults((v) => ({ ...v, label_prefix: e.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs text-[hsl(var(--fg))]/70">پسوند نام کاربری</div>
                    <Input value={globalDefaults.label_suffix} onChange={(e) => setGlobalDefaults((v) => ({ ...v, label_suffix: e.target.value }))} />
                  </div>
                  <div className="md:col-span-2 max-w-full overflow-hidden break-words text-xs leading-6 text-[hsl(var(--fg))]/65 [overflow-wrap:anywhere]">
                    بخش Label و Username یکی شده است؛ همین الگو برای نمایش گاردینو و ساخت کاربر در پاسارگارد/مرزبان استفاده می‌شود.
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button type="button" onClick={saveGlobalDefaults}>ذخیره سراسری</Button>
                  <Button type="button" variant="outline" onClick={loadDefaults}>بارگذاری مجدد</Button>
                </div>
              </CardContent>
            </Card>

            <Card className="overflow-hidden">
              <CardHeader>
                <div className="text-sm font-semibold">سیاست سراسری حذف و ریست کاربران</div>
                <div className="text-xs text-[hsl(var(--fg))]/70">این مقدار پایه برای رسیلرهایی استفاده می‌شود که سیاست اختصاصی ندارند.</div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className={guideBoxClass}>
                  این سیاست روی رسیلرهایی اعمال می‌شود که تنظیم اختصاصی ندارند. «مهلت حذف/ریفاند» تعداد روز مجاز از زمان ساخت کاربر است و عدد 0 یعنی محدودیت زمانی ندارد. «حداکثر مصرف» اگر 0 باشد نامحدود است؛ اگر مثلا 0.5 وارد شود، کاربری که بیشتر از حدود 500 مگابایت مصرف کرده باشد قابل حذف/ریفاند نیست. کاربری که زمانش تمام شده یا کل حجمش مصرف شده باشد هم قابل حذف نیست.
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="flex items-center justify-between rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] p-3">
                    <span className="text-sm">اجازه حذف و ریفاند کاربر</span>
                    <Switch checked={globalPolicy.allow_user_delete} onCheckedChange={(v) => setGlobalPolicy((x) => normalizePolicy({ ...x, allow_user_delete: v }))} />
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] p-3">
                    <span className="text-sm">اجازه ریست مصرف</span>
                    <Switch checked={globalPolicy.allow_reset_usage} onCheckedChange={(v) => setGlobalPolicy((x) => normalizePolicy({ ...x, allow_reset_usage: v }))} />
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs text-[hsl(var(--fg))]/70">مهلت حذف/ریفاند از زمان ساخت (روز، 0 یعنی نامحدود)</div>
                    <Input
                      type="number"
                      min={0}
                      value={globalPolicy.delete_refund_window_days}
                      onChange={(e) => setGlobalPolicy((x) => normalizePolicy({ ...x, delete_refund_window_days: Number(e.target.value) || 0 }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs text-[hsl(var(--fg))]/70">حداکثر مصرف مجاز برای حذف (GB)</div>
                    <Input
                      type="number"
                      min={0}
                      step="0.1"
                      value={globalPolicy.delete_expired_used_gb_limit}
                      onChange={(e) => setGlobalPolicy((x) => normalizePolicy({ ...x, delete_expired_used_gb_limit: Number(e.target.value) || 0 }))}
                    />
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] p-3 md:col-span-2">
                    <span className="text-sm">در ویرایش فقط تمدید بسته‌ای مجاز باشد</span>
                    <Switch checked={globalPolicy.restrict_edit_to_renewal_only} onCheckedChange={(v) => setGlobalPolicy((x) => normalizePolicy({ ...x, restrict_edit_to_renewal_only: v }))} />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <div className="text-xs text-[hsl(var(--fg))]/70">سیاست تمدید بسته‌ای</div>
                    <select
                      className={selectClass}
                      value={globalPolicy.renewal_policy}
                      onChange={(e) => setGlobalPolicy((x) => normalizePolicy({ ...x, renewal_policy: e.target.value as ResellerUserPolicy["renewal_policy"] }))}
                    >
                      <option value="reset_time_and_volume">ریست زمان و حجم</option>
                      <option value="add_time_and_volume">اضافه شدن زمان و حجم به دوره بعد</option>
                      <option value="reset_time_carry_volume">ریست زمان و اضافه شدن حجم باقی‌مانده قبلی</option>
                      <option value="reset_volume_carry_time">ریست حجم و اضافه شدن زمان باقی‌مانده قبلی</option>
                    </select>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button type="button" onClick={saveGlobalPolicy}>ذخیره سیاست سراسری</Button>
                  <Button type="button" variant="outline" onClick={loadDefaults}>بارگذاری مجدد</Button>
                </div>
              </CardContent>
            </Card>
            </>
          ) : null}

          <div className="pt-2">
            <Button variant="outline" onClick={onLogout}>خروج از حساب</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
