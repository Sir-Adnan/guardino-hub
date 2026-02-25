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

function parseNodeIds(v: string): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const p of (v || "").split(",")) {
    const n = Number(p.trim());
    if (!Number.isInteger(n) || n <= 0 || seen.has(n)) continue;
    out.push(n);
    seen.add(n);
  }
  return out;
}

function toNodeIdsText(ids: number[]): string {
  return (ids || []).join(", ");
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
  const [resellerNodeIdsText, setResellerNodeIdsText] = React.useState("");
  const [globalNodeIdsText, setGlobalNodeIdsText] = React.useState("");

  function onLogout() {
    storage.del("token");
    r.push("/login");
  }

  async function loadDefaults() {
    setLoadingDefaults(true);
    try {
      const env = await apiFetch<UserDefaultsEnvelope>("/api/v1/reseller/settings/user-defaults");
      setResellerDefaults(env.reseller_defaults || EMPTY_DEFAULTS);
      setResellerNodeIdsText(toNodeIdsText(env.reseller_defaults?.default_node_ids || []));

      if (me?.role === "admin") {
        const g = await apiFetch<UserDefaults>("/api/v1/admin/settings/user-defaults");
        setGlobalDefaults(g || EMPTY_DEFAULTS);
        setGlobalNodeIdsText(toNodeIdsText(g?.default_node_ids || []));
      } else {
        setGlobalDefaults(env.global_defaults || EMPTY_DEFAULTS);
        setGlobalNodeIdsText(toNodeIdsText(env.global_defaults?.default_node_ids || []));
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
        default_node_ids: parseNodeIds(resellerNodeIdsText),
      };
      const saved = await apiFetch<UserDefaults>("/api/v1/reseller/settings/user-defaults", {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      setResellerDefaults(saved);
      setResellerNodeIdsText(toNodeIdsText(saved.default_node_ids || []));
      push({ title: "تنظیمات ذخیره شد", type: "success" });
    } catch (e: any) {
      push({ title: "خطا در ذخیره تنظیمات", desc: String(e?.message || e), type: "error" });
    }
  }

  async function saveGlobalDefaults() {
    try {
      const payload: UserDefaults = {
        ...globalDefaults,
        default_node_ids: parseNodeIds(globalNodeIdsText),
      };
      const saved = await apiFetch<UserDefaults>("/api/v1/admin/settings/user-defaults", {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      setGlobalDefaults(saved);
      setGlobalNodeIdsText(toNodeIdsText(saved.default_node_ids || []));
      push({ title: "پیش‌فرض سراسری ذخیره شد", type: "success" });
    } catch (e: any) {
      push({ title: "خطا در ذخیره پیش‌فرض سراسری", desc: String(e?.message || e), type: "error" });
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="text-xl font-semibold">Settings</div>
          <div className="text-sm text-[hsl(var(--fg))]/70">تنظیمات ظاهری و حساب</div>
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
              <div className="text-sm font-semibold">پیش‌فرض ساخت کاربر (حساب شما)</div>
              <div className="text-xs text-[hsl(var(--fg))]/70">
                این تنظیمات فرم ساخت کاربر را برای شما آماده می‌کند.
              </div>
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
                <div className="space-y-2 md:col-span-2">
                  <div className="text-xs text-[hsl(var(--fg))]/70">Node IDs پیش‌فرض (فقط حالت دستی)</div>
                  <Input
                    value={resellerNodeIdsText}
                    onChange={(e) => setResellerNodeIdsText(e.target.value)}
                    placeholder="مثال: 1,2,4"
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <div className="text-xs text-[hsl(var(--fg))]/70">Tag پیش‌فرض (فقط حالت گروهی)</div>
                  <Input
                    value={resellerDefaults.default_node_group}
                    onChange={(e) => setResellerDefaults((v) => ({ ...v, default_node_group: e.target.value }))}
                    placeholder="مثال: vip"
                  />
                </div>
                <div className="space-y-2">
                  <div className="text-xs text-[hsl(var(--fg))]/70">پیشوند Label</div>
                  <Input
                    value={resellerDefaults.label_prefix}
                    onChange={(e) => setResellerDefaults((v) => ({ ...v, label_prefix: e.target.value }))}
                    placeholder="مثال: VIP-"
                  />
                </div>
                <div className="space-y-2">
                  <div className="text-xs text-[hsl(var(--fg))]/70">پسوند Label</div>
                  <Input
                    value={resellerDefaults.label_suffix}
                    onChange={(e) => setResellerDefaults((v) => ({ ...v, label_suffix: e.target.value }))}
                    placeholder="مثال: -IR"
                  />
                </div>
                <div className="space-y-2">
                  <div className="text-xs text-[hsl(var(--fg))]/70">پیشوند Username</div>
                  <Input
                    value={resellerDefaults.username_prefix}
                    onChange={(e) => setResellerDefaults((v) => ({ ...v, username_prefix: e.target.value }))}
                    placeholder="مثال: usr_"
                  />
                </div>
                <div className="space-y-2">
                  <div className="text-xs text-[hsl(var(--fg))]/70">پسوند Username</div>
                  <Input
                    value={resellerDefaults.username_suffix}
                    onChange={(e) => setResellerDefaults((v) => ({ ...v, username_suffix: e.target.value }))}
                    placeholder="مثال: _01"
                  />
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
                <div className="text-xs text-[hsl(var(--fg))]/70">
                  هر رسیلری که تنظیم اختصاصی نداشته باشد از این مقدارها استفاده می‌کند.
                </div>
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
                  <div className="space-y-2 md:col-span-2">
                    <div className="text-xs text-[hsl(var(--fg))]/70">Node IDs پیش‌فرض (فقط حالت دستی)</div>
                    <Input
                      value={globalNodeIdsText}
                      onChange={(e) => setGlobalNodeIdsText(e.target.value)}
                      placeholder="مثال: 1,2,4"
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <div className="text-xs text-[hsl(var(--fg))]/70">Tag پیش‌فرض (فقط حالت گروهی)</div>
                    <Input
                      value={globalDefaults.default_node_group}
                      onChange={(e) => setGlobalDefaults((v) => ({ ...v, default_node_group: e.target.value }))}
                      placeholder="مثال: vip"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs text-[hsl(var(--fg))]/70">پیشوند Label</div>
                    <Input
                      value={globalDefaults.label_prefix}
                      onChange={(e) => setGlobalDefaults((v) => ({ ...v, label_prefix: e.target.value }))}
                      placeholder="مثال: VIP-"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs text-[hsl(var(--fg))]/70">پسوند Label</div>
                    <Input
                      value={globalDefaults.label_suffix}
                      onChange={(e) => setGlobalDefaults((v) => ({ ...v, label_suffix: e.target.value }))}
                      placeholder="مثال: -IR"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs text-[hsl(var(--fg))]/70">پیشوند Username</div>
                    <Input
                      value={globalDefaults.username_prefix}
                      onChange={(e) => setGlobalDefaults((v) => ({ ...v, username_prefix: e.target.value }))}
                      placeholder="مثال: usr_"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs text-[hsl(var(--fg))]/70">پسوند Username</div>
                    <Input
                      value={globalDefaults.username_suffix}
                      onChange={(e) => setGlobalDefaults((v) => ({ ...v, username_suffix: e.target.value }))}
                      placeholder="مثال: _01"
                    />
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
