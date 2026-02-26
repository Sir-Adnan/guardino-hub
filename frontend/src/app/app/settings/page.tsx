"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { accentOptions, setAccent } from "@/components/theme-provider";
import { storage } from "@/lib/storage";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/components/auth-context";

type UserDefaults = {
  default_pricing_mode: "bundle" | "per_node";
  default_node_mode: "all" | "manual" | "group";
  default_node_ids: number[];
  default_node_group: string;
  label_prefix: string;
  label_suffix: string;
  username_prefix: string;
  username_suffix: string;
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
};

function toggleId(list: number[], id: number, checked: boolean): number[] {
  const s = new Set(list);
  if (checked) s.add(id);
  else s.delete(id);
  return Array.from(s).sort((a, b) => a - b);
}

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [accent, setAccentState] = React.useState(storage.get("accent") || "blue");
  const r = useRouter();
  const { push } = useToast();
  const { me } = useAuth();

  const [loadingDefaults, setLoadingDefaults] = React.useState(true);
  const [resellerDefaults, setResellerDefaults] = React.useState<UserDefaults>(EMPTY_DEFAULTS);
  const [globalDefaults, setGlobalDefaults] = React.useState<UserDefaults>(EMPTY_DEFAULTS);

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

      setResellerDefaults(env.reseller_defaults || EMPTY_DEFAULTS);

      const resellerNodeItems = (resellerNodeRes?.items || resellerNodeRes || []).map((n: any) => ({
        id: n.id,
        name: n.name,
        panel_type: n.panel_type,
        tags: n.tags || [],
      }));
      setResellerNodes(resellerNodeItems);

      if (me?.role === "admin") {
        const [g, adminNodeRes] = await Promise.all([
          apiFetch<UserDefaults>("/api/v1/admin/settings/user-defaults"),
          apiFetch<any>("/api/v1/admin/nodes?offset=0&limit=500"),
        ]);
        setGlobalDefaults(g || EMPTY_DEFAULTS);
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

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="text-xl font-semibold">Settings</div>
          <div className="text-sm text-[hsl(var(--fg))]/70">تنظیمات ظاهری، پیش‌فرض‌ها و امنیت حساب</div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <div className="text-sm font-medium">Theme</div>
            <div className="flex flex-wrap gap-2">
              <Button variant={theme === "light" ? "primary" : "outline"} onClick={() => setTheme("light")}>Light</Button>
              <Button variant={theme === "dark" ? "primary" : "outline"} onClick={() => setTheme("dark")}>Dark</Button>
              <Button variant={theme === "system" ? "primary" : "outline"} onClick={() => setTheme("system")}>System</Button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium">Accent</div>
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

          <Card>
            <CardHeader>
              <div className="text-sm font-semibold">تغییر رمز عبور</div>
              <div className="text-xs text-[hsl(var(--fg))]/70">برای امنیت بیشتر، رمز جدید حداقل ۸ کاراکتر انتخاب کنید.</div>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-3">
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

          <Card>
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
                    className="w-full rounded-xl border border-[hsl(var(--border))] bg-transparent px-3 py-2 text-sm"
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
                    className="w-full rounded-xl border border-[hsl(var(--border))] bg-transparent px-3 py-2 text-sm"
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

                {resellerDefaults.default_node_mode === "manual" ? (
                  <div className="space-y-2 md:col-span-2 rounded-xl border border-[hsl(var(--border))] p-3">
                    <div className="text-xs text-[hsl(var(--fg))]/70">انتخاب نودهای پیش‌فرض (حالت دستی)</div>
                    <div className="flex flex-wrap gap-2">
                      <Input placeholder="جستجوی نود" value={resellerNodeQ} onChange={(e) => setResellerNodeQ(e.target.value)} />
                      <Button type="button" variant="outline" onClick={() => setResellerDefaults((v) => ({ ...v, default_node_ids: resellerNodes.map((n) => n.id) }))}>انتخاب همه</Button>
                      <Button type="button" variant="outline" onClick={() => setResellerDefaults((v) => ({ ...v, default_node_ids: [] }))}>پاک کردن</Button>
                    </div>
                    <div className="grid gap-2 md:grid-cols-2">
                      {resellerFilteredNodes.map((n) => (
                        <label key={n.id} className="flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] px-3 py-2 text-sm">
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
                      className="w-full rounded-xl border border-[hsl(var(--border))] bg-transparent px-3 py-2 text-sm"
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
                  <div className="text-xs text-[hsl(var(--fg))]/70">پیشوند Label</div>
                  <Input value={resellerDefaults.label_prefix} onChange={(e) => setResellerDefaults((v) => ({ ...v, label_prefix: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <div className="text-xs text-[hsl(var(--fg))]/70">پسوند Label</div>
                  <Input value={resellerDefaults.label_suffix} onChange={(e) => setResellerDefaults((v) => ({ ...v, label_suffix: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <div className="text-xs text-[hsl(var(--fg))]/70">پیشوند Username</div>
                  <Input value={resellerDefaults.username_prefix} onChange={(e) => setResellerDefaults((v) => ({ ...v, username_prefix: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <div className="text-xs text-[hsl(var(--fg))]/70">پسوند Username</div>
                  <Input value={resellerDefaults.username_suffix} onChange={(e) => setResellerDefaults((v) => ({ ...v, username_suffix: e.target.value }))} />
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="button" onClick={saveResellerDefaults}>ذخیره</Button>
                <Button type="button" variant="outline" onClick={loadDefaults}>بارگذاری مجدد</Button>
              </div>
            </CardContent>
          </Card>

          {me?.role === "admin" ? (
            <Card>
              <CardHeader>
                <div className="text-sm font-semibold">پیش‌فرض سراسری برای همه رسیلرها (ادمین)</div>
                <div className="text-xs text-[hsl(var(--fg))]/70">رسیلرهایی که تنظیم اختصاصی ندارند از این مقادیر استفاده می‌کنند.</div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <div className="text-xs text-[hsl(var(--fg))]/70">مدل قیمت پیش‌فرض</div>
                    <select
                      className="w-full rounded-xl border border-[hsl(var(--border))] bg-transparent px-3 py-2 text-sm"
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
                      className="w-full rounded-xl border border-[hsl(var(--border))] bg-transparent px-3 py-2 text-sm"
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

                  {globalDefaults.default_node_mode === "manual" ? (
                    <div className="space-y-2 md:col-span-2 rounded-xl border border-[hsl(var(--border))] p-3">
                      <div className="text-xs text-[hsl(var(--fg))]/70">انتخاب نودهای پیش‌فرض (سراسری)</div>
                      <div className="flex flex-wrap gap-2">
                        <Input placeholder="جستجوی نود" value={globalNodeQ} onChange={(e) => setGlobalNodeQ(e.target.value)} />
                        <Button type="button" variant="outline" onClick={() => setGlobalDefaults((v) => ({ ...v, default_node_ids: adminNodes.map((n) => n.id) }))}>انتخاب همه</Button>
                        <Button type="button" variant="outline" onClick={() => setGlobalDefaults((v) => ({ ...v, default_node_ids: [] }))}>پاک کردن</Button>
                      </div>
                      <div className="grid gap-2 md:grid-cols-2">
                        {globalFilteredNodes.map((n) => (
                          <label key={n.id} className="flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] px-3 py-2 text-sm">
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
                        className="w-full rounded-xl border border-[hsl(var(--border))] bg-transparent px-3 py-2 text-sm"
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
                    <div className="text-xs text-[hsl(var(--fg))]/70">پیشوند Label</div>
                    <Input value={globalDefaults.label_prefix} onChange={(e) => setGlobalDefaults((v) => ({ ...v, label_prefix: e.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs text-[hsl(var(--fg))]/70">پسوند Label</div>
                    <Input value={globalDefaults.label_suffix} onChange={(e) => setGlobalDefaults((v) => ({ ...v, label_suffix: e.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs text-[hsl(var(--fg))]/70">پیشوند Username</div>
                    <Input value={globalDefaults.username_prefix} onChange={(e) => setGlobalDefaults((v) => ({ ...v, username_prefix: e.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs text-[hsl(var(--fg))]/70">پسوند Username</div>
                    <Input value={globalDefaults.username_suffix} onChange={(e) => setGlobalDefaults((v) => ({ ...v, username_suffix: e.target.value }))} />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button type="button" onClick={saveGlobalDefaults}>ذخیره سراسری</Button>
                  <Button type="button" variant="outline" onClick={loadDefaults}>بارگذاری مجدد</Button>
                </div>
              </CardContent>
            </Card>
          ) : null}

          <div className="pt-2">
            <Button variant="outline" onClick={onLogout}>Logout</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
