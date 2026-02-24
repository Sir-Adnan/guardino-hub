"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/components/i18n-context";
import { HelpTip } from "@/components/ui/help-tip";

type QuoteResp = { total_amount: number; per_node_amount: Record<string, number>; time_amount: number };
type CreateResp = { user_id: number; master_sub_token: string; charged_amount: number; nodes_provisioned: number[] };

const durationPresets = [
  { key: "7d", label: "۷ روز" },
  { key: "1m", label: "۱ ماه" },
  { key: "3m", label: "۳ ماه" },
  { key: "6m", label: "۶ ماه" },
  { key: "1y", label: "۱ سال" },
];

export default function NewUserPage() {
  const r = useRouter();
  const { push } = useToast();
  const { t } = useI18n();

  const [label, setLabel] = React.useState("");
  const [username, setUsername] = React.useState("");
  const [randomize, setRandomize] = React.useState(false);

  const [totalGb, setTotalGb] = React.useState<number>(10);
  const [pricingMode, setPricingMode] = React.useState<"per_node" | "bundle">("per_node");

  const [preset, setPreset] = React.useState<string>("1m");
  const [days, setDays] = React.useState<number>(30);

  const [nodeIds, setNodeIds] = React.useState<string>("");
  const [nodes, setNodes] = React.useState<Array<{id:number; name:string; panel_type:string}> | null>(null); // comma-separated for now

  const [quote, setQuote] = React.useState<QuoteResp | null>(null);
  const [loading, setLoading] = React.useState(false);

  function randomName() {
    const v = `u_${Math.random().toString(16).slice(2, 10)}`;
    setUsername(v);
  }

  async function loadNodes() {
    try {
      const res = await apiFetch<any>("/api/v1/reseller/nodes");
      const arr = res.items || [];
      setNodes(arr.map((n:any) => ({ id: n.id, name: n.name, panel_type: n.panel_type })));
      push({ title: "Nodes loaded", type: "success" });
    } catch (e:any) {
      push({ title: "Cannot load nodes", desc: String(e.message||e), type: "error" });
    }
  }

  async function doQuote() {
    setLoading(true);
    try {
      const node_ids = nodeIds.trim() ? nodeIds.split(",").map((x) => Number(x.trim())).filter((n) => !Number.isNaN(n)) : undefined;
      const payload: any = {
        label,
        username: username || undefined,
        randomize_username: randomize,
        total_gb: totalGb,
        days,
        duration_preset: preset || undefined,
        pricing_mode: pricingMode,
        node_ids,
      };
      const res = await apiFetch<QuoteResp>("/api/v1/reseller/user-ops/quote", { method: "POST", body: JSON.stringify(payload) });
      setQuote(res);
      push({ title: "پیش‌فاکتور آماده شد", type: "success" });
    } catch (e: any) {
      push({ title: "خطا در محاسبه قیمت", desc: String(e.message || e), type: "error" });
    } finally {
      setLoading(false);
    }
  }

  async function doCreate() {
    setLoading(true);
    try {
      const node_ids = nodeIds.trim() ? nodeIds.split(",").map((x) => Number(x.trim())).filter((n) => !Number.isNaN(n)) : undefined;
      const payload: any = {
        label,
        username: username || undefined,
        randomize_username: randomize,
        total_gb: totalGb,
        days,
        duration_preset: preset || undefined,
        pricing_mode: pricingMode,
        node_ids,
      };
      const res = await apiFetch<CreateResp>("/api/v1/reseller/user-ops", { method: "POST", body: JSON.stringify(payload) });
      push({ title: "کاربر ساخته شد", desc: `ID: ${res.user_id}`, type: "success" });
      r.push(`/app/users/${res.user_id}`);
    } catch (e: any) {
      push({ title: "خطا در ساخت کاربر", desc: String(e.message || e), type: "error" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="text-xl font-semibold">{t("newUser.title")}</div>
          <div className="text-sm text-[hsl(var(--fg))]/70">{t("newUser.subtitle")}</div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm flex items-center gap-2">
                {t("newUser.label")} <HelpTip text={t("help.label")} />
              </label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="مثلاً customer-01" />
            </div>

            <div className="space-y-2">
              <label className="text-sm flex items-center gap-2">
                {t("newUser.username")} <HelpTip text={t("help.username")} />
              </label>
              <div className="flex gap-2">
                <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="اگر خالی باشد label استفاده می‌شود" />
                <Button type="button" variant="outline" onClick={randomName}>{t("newUser.random")}</Button>
              </div>
              <label className="flex items-center gap-2 text-xs text-[hsl(var(--fg))]/70">
                <input type="checkbox" checked={randomize} onChange={(e) => setRandomize(e.target.checked)} />
                {t("newUser.serverRandom")}
              </label>
            </div>

            <div className="space-y-2">
              <label className="text-sm">حجم (GB)</label>
              <Input type="number" value={totalGb} onChange={(e) => setTotalGb(Number(e.target.value))} />
            </div>

            <div className="space-y-2">
              <label className="text-sm flex items-center gap-2">
                {t("newUser.pricingMode")} <HelpTip text={t("help.pricingMode")} />
              </label>
              <div className="flex gap-2">
                <Button type="button" variant={pricingMode === "per_node" ? "primary" : "outline"} onClick={() => setPricingMode("per_node")}>{t("newUser.perNode")}</Button>
                <Button type="button" variant={pricingMode === "bundle" ? "primary" : "outline"} onClick={() => setPricingMode("bundle")}>{t("newUser.bundle")}</Button>
              </div>
              <div className="text-xs text-[hsl(var(--fg))]/70">{t("newUser.bundleHelp")}</div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm">پکیج زمانی</label>
              <div className="flex flex-wrap gap-2">
                {durationPresets.map((p) => (
                  <Button
                    key={p.key}
                    type="button"
                    variant={preset === p.key ? "primary" : "outline"}
                    onClick={() => {
                      setPreset(p.key);
                      // days is derived on backend, but we set UI hint too
                      if (p.key === "7d") setDays(7);
                      if (p.key === "1m") setDays(30);
                      if (p.key === "3m") setDays(90);
                      if (p.key === "6m") setDays(180);
                      if (p.key === "1y") setDays(365);
                    }}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
              <div className="text-xs text-[hsl(var(--fg))]/70">می‌توانی روزها را هم دستی تغییر بدهی (اختیاری)</div>
            </div>

            <div className="space-y-2">
              <label className="text-sm">Days (اختیاری)</label>
              <Input type="number" value={days} onChange={(e) => setDays(Number(e.target.value))} />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm flex items-center gap-2">
              {t("newUser.nodeIds")} <HelpTip text={t("help.nodeIds")} />
            </label>
            <Input value={nodeIds} onChange={(e) => setNodeIds(e.target.value)} placeholder="مثلاً 1,2,3 (اگر خالی باشد default nodes)" />
            <div className="text-xs text-[hsl(var(--fg))]/70">در نسخه بعد، این بخش به انتخاب گرافیکی نودها تبدیل می‌شود.</div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={loading} onClick={loadNodes}>{t("newUser.loadNodes")}</Button>
            <Button type="button" variant="outline" disabled={loading} onClick={doQuote}>{t("newUser.quote")}</Button>
            <Button type="button" disabled={loading} onClick={doCreate}>{t("newUser.create")}</Button>
            <Button type="button" variant="ghost" onClick={() => r.push("/app/users")}>{t("newUser.back")}</Button>
          </div>

          {nodes ? (
  <Card>
    <CardHeader>
      <div className="text-sm text-[hsl(var(--fg))]/70">Nodes</div>
      <div className="text-lg font-semibold">انتخاب سریع Node IDs</div>
    </CardHeader>
    <CardContent className="text-sm space-y-2">
      <div className="text-xs text-[hsl(var(--fg))]/70">روی یک نود کلیک کن تا ID به فیلد اضافه شود.</div>
      <div className="grid gap-2 md:grid-cols-2">
        {nodes.map((n) => (
          <button
            key={n.id}
            type="button"
            className="text-right rounded-xl border border-[hsl(var(--border))] p-3 hover:bg-[hsl(var(--muted))]"
            onClick={() => {
              const ids = nodeIds.trim() ? nodeIds.split(",").map((x) => x.trim()).filter(Boolean) : [];
              if (!ids.includes(String(n.id))) ids.push(String(n.id));
              setNodeIds(ids.join(","));
            }}
          >
            <div className="font-medium">{n.name}</div>
            <div className="text-xs text-[hsl(var(--fg))]/70">#{n.id} • {n.panel_type}</div>
          </button>
        ))}
      </div>
    </CardContent>
  </Card>
) : null}

          {quote ? (
            <Card>
              <CardHeader>
                <div className="text-sm text-[hsl(var(--fg))]/70">پیش‌فاکتور</div>
                <div className="text-xl font-semibold">{quote.total_amount.toLocaleString()} تومان</div>
              </CardHeader>
              <CardContent className="text-sm space-y-1">
                <div>هزینه زمان: {quote.time_amount.toLocaleString()}</div>
                <div className="text-[hsl(var(--fg))]/70">جزئیات per-node (اگر per_node باشد):</div>
                <pre className="text-xs bg-[hsl(var(--muted))] rounded-xl p-3 overflow-auto">{JSON.stringify(quote.per_node_amount, null, 2)}</pre>
              </CardContent>
            </Card>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
