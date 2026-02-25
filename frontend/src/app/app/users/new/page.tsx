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
import { Modal } from "@/components/ui/modal";
import { copyText } from "@/lib/copy";

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

  const [nodeMode, setNodeMode] = React.useState<"all" | "custom">("all");
  const [nodes, setNodes] = React.useState<Array<{ id: number; name: string; panel_type: string }> | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = React.useState<number[]>([]);

  const [quote, setQuote] = React.useState<QuoteResp | null>(null);
  const [loading, setLoading] = React.useState(false);

  const [bulkMode, setBulkMode] = React.useState(false);
  const [bulkCount, setBulkCount] = React.useState<number>(5);
  const bulkPresets = [5, 10, 15, 20, 30, 40, 50];

  const [bulkResultOpen, setBulkResultOpen] = React.useState(false);
  const [bulkResults, setBulkResults] = React.useState<Array<{ label: string; user_id: number; master_url: string }>>([]);
  const [bulkErrors, setBulkErrors] = React.useState<Array<{ label: string; error: string }>>([]);

  function randomName() {
    const v = `u_${Math.random().toString(16).slice(2, 10)}`;
    setUsername(v);
  }

  async function loadNodes() {
    try {
      const res = await apiFetch<any>("/api/v1/reseller/nodes");
      const arr = res.items || [];
      const mapped = arr.map((n: any) => ({ id: n.id, name: n.name, panel_type: n.panel_type }));
      setNodes(mapped);

      const ids = mapped.map((n: any) => Number(n.id)).filter((x: number) => !Number.isNaN(x));
      // Keep selection sane after refresh
      setSelectedNodeIds((prev) => {
        if (nodeMode === "all") return ids;
        if (!prev.length) return ids;
        const set = new Set(ids);
        return prev.filter((x) => set.has(x));
      });

      push({ title: "Nodes loaded", type: "success" });
    } catch (e:any) {
      push({ title: "Cannot load nodes", desc: String(e.message||e), type: "error" });
    }
  }

  React.useEffect(() => {
    // Auto-load nodes so default "all" works without typing IDs
    loadNodes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function doQuote() {
    setLoading(true);
    try {
      const node_ids =
        nodes && nodes.length
          ? nodeMode === "all"
            ? nodes.map((n) => n.id)
            : selectedNodeIds
          : undefined;

      if (nodeMode === "custom" && (!node_ids || node_ids.length === 0)) {
        push({ title: "حداقل یک نود انتخاب کن", type: "error" });
        return;
      }
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
      const node_ids =
        nodes && nodes.length
          ? nodeMode === "all"
            ? nodes.map((n) => n.id)
            : selectedNodeIds
          : undefined;

      if (nodeMode === "custom" && (!node_ids || node_ids.length === 0)) {
        push({ title: "حداقل یک نود انتخاب کن", type: "error" });
        return;
      }

      const makePayload = (lbl: string, usr?: string) => ({
        label: lbl,
        username: usr || undefined,
        randomize_username: randomize,
        total_gb: totalGb,
        days,
        duration_preset: preset || undefined,
        pricing_mode: pricingMode,
        node_ids,
      });

      // Single create (default)
      if (!bulkMode) {
        const res = await apiFetch<CreateResp>("/api/v1/reseller/user-ops", { method: "POST", body: JSON.stringify(makePayload(label, username || undefined)) });
        push({ title: "کاربر ساخته شد", desc: `ID: ${res.user_id}`, type: "success" });
        r.push(`/app/users/${res.user_id}`);
        return;
      }

      // Bulk create (max 50)
      const count = Math.max(1, Math.min(50, Number(bulkCount) || 1));

      const baseLabel = (label || "").trim() || `customer_${Math.random().toString(16).slice(2, 8)}`;
      const baseUser = (username || "").trim() || "";

      const results: Array<{ label: string; user_id: number; master_url: string }> = [];
      const errors: Array<{ label: string; error: string }> = [];

      for (let i = 1; i <= count; i++) {
        const lbl = `${baseLabel}-${String(i).padStart(2, "0")}`;
        const usr = baseUser ? `${baseUser}-${String(i).padStart(2, "0")}` : undefined;

        try {
          const res = await apiFetch<CreateResp>("/api/v1/reseller/user-ops", {
            method: "POST",
            body: JSON.stringify(makePayload(lbl, usr)),
          });
          const master_url = `${window.location.origin}/api/v1/sub/${res.master_sub_token}`;
          results.push({ label: lbl, user_id: res.user_id, master_url });
        } catch (e: any) {
          errors.push({ label: lbl, error: String(e?.message || e) });
        }
      }

      setBulkResults(results);
      setBulkErrors(errors);
      setBulkResultOpen(true);

      if (errors.length && results.length) {
        push({ title: "ساخت گروهی: انجام شد با خطا", desc: `${results.length} موفق، ${errors.length} ناموفق`, type: "warning" });
      } else if (errors.length) {
        push({ title: "ساخت گروهی ناموفق", desc: `${errors.length} مورد`, type: "error" });
      } else {
        push({ title: "ساخت گروهی انجام شد", desc: `${results.length} کاربر`, type: "success" });
      }
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
  <label className="text-sm flex items-center gap-2">
    ساخت گروهی <HelpTip text="برای ساخت چند کاربر مشابه (حداکثر ۵۰ عدد)" />
  </label>
  <label className="flex items-center gap-2 text-sm">
    <input type="checkbox" checked={bulkMode} onChange={(e) => setBulkMode(e.target.checked)} />
    فعال
  </label>

  {bulkMode ? (
    <div className="space-y-2 rounded-2xl border border-[hsl(var(--border))] p-3 bg-[hsl(var(--muted))]">
      <div className="text-xs text-[hsl(var(--fg))]/70">تعداد ساخت (حداکثر ۵۰)</div>
      <div className="flex flex-wrap gap-2">
        {bulkPresets.map((n) => (
          <Button key={n} type="button" variant={bulkCount === n ? "primary" : "outline"} onClick={() => setBulkCount(n)}>
            {n}
          </Button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={1}
          max={50}
          value={bulkCount}
          onChange={(e) => setBulkCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
        />
        <div className="text-xs text-[hsl(var(--fg))]/70">عدد دلخواه</div>
      </div>
      <div className="text-xs text-[hsl(var(--fg))]/70">
        نکته: اگر Label را خالی بگذاری، سیستم خودش یک پایه می‌سازد. در حالت گروهی، به انتهای Label شماره اضافه می‌شود.
      </div>
    </div>
  ) : null}
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

          <Card>
            <CardHeader>
              <div className="text-sm text-[hsl(var(--fg))]/70">نودها</div>
              <div className="text-lg font-semibold">انتخاب نود</div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant={nodeMode === "all" ? "primary" : "outline"}
                  onClick={() => {
                    setNodeMode("all");
                    if (nodes?.length) setSelectedNodeIds(nodes.map((n) => n.id));
                  }}
                >
                  همه نودها
                </Button>
                <Button
                  type="button"
                  variant={nodeMode === "custom" ? "primary" : "outline"}
                  onClick={() => {
                    setNodeMode("custom");
                    if (nodes?.length && selectedNodeIds.length === 0) setSelectedNodeIds(nodes.map((n) => n.id));
                  }}
                >
                  انتخاب دستی
                </Button>
                <Button type="button" variant="outline" disabled={loading} onClick={loadNodes}>
                  {t("newUser.loadNodes")}
                </Button>
              </div>

              {nodes && nodes.length ? (
                <div className="text-xs text-[hsl(var(--fg))]/70">
                  {nodeMode === "all"
                    ? "به صورت پیش‌فرض همه نودهای اختصاص‌داده‌شده برای شما استفاده می‌شود."
                    : "نودهای موردنظر را انتخاب/غیرفعال کن."}
                </div>
              ) : (
                <div className="text-xs text-[hsl(var(--fg))]/70">در حال دریافت لیست نودها…</div>
              )}

              {nodeMode === "custom" && nodes && nodes.length ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {nodes.map((n) => {
                    const checked = selectedNodeIds.includes(n.id);
                    return (
                      <button
                        key={n.id}
                        type="button"
                        className={`text-right rounded-xl border p-3 transition hover:bg-[hsl(var(--muted))] ${
                          checked ? "border-[hsl(var(--primary))]" : "border-[hsl(var(--border))]"
                        }`}
                        onClick={() => {
                          setSelectedNodeIds((prev) =>
                            prev.includes(n.id) ? prev.filter((x) => x !== n.id) : [...prev, n.id]
                          );
                        }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-medium">{n.name}</div>
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            checked={checked}
                            onChange={() => {
                              setSelectedNodeIds((prev) =>
                                prev.includes(n.id) ? prev.filter((x) => x !== n.id) : [...prev, n.id]
                              );
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </div>
                        <div className="text-xs text-[hsl(var(--fg))]/70">#{n.id} • {n.panel_type}</div>
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {nodeMode === "custom" ? (
                <div className="text-xs text-[hsl(var(--fg))]/70">انتخاب شده: {selectedNodeIds.length}</div>
              ) : null}
            </CardContent>
          </Card>

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={loading} onClick={doQuote}>{t("newUser.quote")}</Button>
            <Button type="button" disabled={loading} onClick={doCreate}>{t("newUser.create")}</Button>
            <Button type="button" variant="ghost" onClick={() => r.push("/app/users")}>{t("newUser.back")}</Button>
          </div>

          {quote ? (
            <Card>
              <CardHeader>
                <div className="text-sm text-[hsl(var(--fg))]/70">پیش‌فاکتور</div>
                <div className="text-xl font-semibold">{(bulkMode ? quote.total_amount * Math.max(1, Math.min(50, Number(bulkCount) || 1)) : quote.total_amount).toLocaleString()} تومان</div>
                {bulkMode ? (
                  <div className="text-xs text-[hsl(var(--fg))]/70">در حالت ساخت گروهی، مبلغ نمایش داده‌شده برای {Math.max(1, Math.min(50, Number(bulkCount) || 1))} کاربر است.</div>
                ) : null}
              </CardHeader>
              <CardContent className="text-sm space-y-1">
                <div>هزینه زمان: {(bulkMode ? quote.time_amount * Math.max(1, Math.min(50, Number(bulkCount) || 1)) : quote.time_amount).toLocaleString()}</div>
                <div className="text-[hsl(var(--fg))]/70">جزئیات per-node (اگر per_node باشد):</div>
                <pre className="text-xs bg-[hsl(var(--muted))] rounded-xl p-3 overflow-auto">{JSON.stringify(quote.per_node_amount, null, 2)}</pre>
              </CardContent>
            </Card>
          ) : null}
        </CardContent>
      </Card>

<Modal
  open={bulkResultOpen}
  onClose={() => setBulkResultOpen(false)}
  title="نتیجه ساخت گروهی"
  className="max-w-3xl"
>
  <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="text-sm text-[hsl(var(--fg))]/70">
        {bulkResults.length} موفق {bulkErrors.length ? `• ${bulkErrors.length} ناموفق` : ""}
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={async () => {
            const txt = bulkResults.map((x) => x.master_url).join("\n");
            const ok = await copyText(txt);
            push({ title: ok ? "کپی شد" : "خطا در کپی", type: ok ? "success" : "error" });
          }}
          disabled={!bulkResults.length}
        >
          کپی همه لینک‌ها
        </Button>
        <Button type="button" onClick={() => setBulkResultOpen(false)}>
          بستن
        </Button>
      </div>
    </div>

    {bulkResults.length ? (
      <div className="max-h-[50vh] overflow-auto rounded-2xl border border-[hsl(var(--border))]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[hsl(var(--card))]">
            <tr className="text-right">
              <th className="p-3">Label</th>
              <th className="p-3">User ID</th>
              <th className="p-3">Master Sub</th>
              <th className="p-3">کپی</th>
            </tr>
          </thead>
          <tbody>
            {bulkResults.map((x) => (
              <tr key={x.user_id} className="border-t border-[hsl(var(--border))]">
                <td className="p-3 font-medium">{x.label}</td>
                <td className="p-3">{x.user_id}</td>
                <td className="p-3">
                  <a className="text-[hsl(var(--primary))] underline" href={x.master_url} target="_blank" rel="noreferrer">
                    {x.master_url}
                  </a>
                </td>
                <td className="p-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={async () => {
                      const ok = await copyText(x.master_url);
                      push({ title: ok ? "کپی شد" : "خطا در کپی", type: ok ? "success" : "error" });
                    }}
                  >
                    کپی
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : null}

    {bulkErrors.length ? (
      <div className="rounded-2xl border border-[hsl(var(--border))] p-3">
        <div className="text-sm font-semibold text-amber-500">موارد ناموفق</div>
        <div className="mt-2 space-y-1 text-xs text-[hsl(var(--fg))]/80">
          {bulkErrors.map((e, idx) => (
            <div key={idx}>
              <span className="font-medium">{e.label}:</span> {e.error}
            </div>
          ))}
        </div>
      </div>
    ) : null}
  </div>
</Modal>

    </div>
  );
}
