"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Modal } from "@/components/ui/modal";
import { apiFetch } from "@/lib/api";
import { fmtNumber } from "@/lib/format";
import { copyText } from "@/lib/copy";
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

  const [nodeMode, setNodeMode] = React.useState<"all" | "manual" | "group">("all");
  const [selectedNodeIds, setSelectedNodeIds] = React.useState<number[]>([]);
  const [nodePickQ, setNodePickQ] = React.useState("");
  const [nodeGroup, setNodeGroup] = React.useState<string>("");
  const [nodes, setNodes] = React.useState<Array<{id:number; name:string; panel_type:string; tags?: string[]}> | null>(null); // allowed nodes

  const [bulkEnabled, setBulkEnabled] = React.useState(false);
  const [bulkCount, setBulkCount] = React.useState<number>(5);
  const bulkPresets = [5, 10, 15, 20, 30, 40, 50];

  const [bulkLinksOpen, setBulkLinksOpen] = React.useState(false);
  const [bulkLinks, setBulkLinks] = React.useState<Array<{ user_id: number; label: string; master_link: string }>>([]);

  const [quote, setQuote] = React.useState<QuoteResp | null>(null);
  const [loading, setLoading] = React.useState(false);

  const tagOptions = React.useMemo(() => {
    const set = new Set<string>();
    (nodes || []).forEach((n) => (n.tags || []).forEach((tg) => set.add(String(tg))));
    return Array.from(set).sort();
  }, [nodes]);

  const filteredNodes = React.useMemo(() => {
    const qq = nodePickQ.trim().toLowerCase();
    if (!qq) return nodes || [];
    return (nodes || []).filter((n) => `${n.id} ${n.name} ${n.panel_type}`.toLowerCase().includes(qq));
  }, [nodes, nodePickQ]);

  function toggleAll(v: boolean) {
    if (!nodes) return;
    setSelectedNodeIds(v ? nodes.map((n) => n.id) : []);
  }

  function toggleOne(id: number, v: boolean) {
    setSelectedNodeIds((prev) => {
      const s = new Set(prev);
      if (v) s.add(id);
      else s.delete(id);
      return Array.from(s);
    });
  }

  function randomName() {
    const v = `u_${Math.random().toString(16).slice(2, 10)}`;
    // Label is required by backend. If it's empty, fill it too.
    if (!label.trim()) setLabel(v);
    setUsername(v);
  }

  async function loadNodes() {
    try {
      const res = await apiFetch<any>("/api/v1/reseller/nodes");
      const arr = res.items || [];
      setNodes(arr.map((n:any) => ({ id: n.id, name: n.name, panel_type: n.panel_type, tags: n.tags || [] })));
      if (nodeMode === "manual" && selectedNodeIds.length === 0) {
        setSelectedNodeIds(arr.map((n: any) => n.id));
      }
    } catch (e:any) {
      push({ title: "Cannot load nodes", desc: String(e.message||e), type: "error" });
    }
  }

  React.useEffect(() => {
    loadNodes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (nodeMode === "manual" && nodes && selectedNodeIds.length === 0) {
      setSelectedNodeIds(nodes.map((n) => n.id));
    }
  }, [nodeMode, nodes, selectedNodeIds.length]);

  async function doQuote() {
    setLoading(true);
    try {
      if (nodeMode === "manual" && selectedNodeIds.length === 0) {
        throw new Error(t("newUser.nodeSelectRequired"));
      }
      if (nodeMode === "group" && !nodeGroup) {
        throw new Error(t("newUser.nodeGroupRequired"));
      }
      const node_ids = nodeMode === "manual" ? selectedNodeIds : undefined;
      const node_group = nodeMode === "group" ? nodeGroup || undefined : undefined;
      const payload: any = {
        label,
        username: username || undefined,
        randomize_username: randomize,
        total_gb: totalGb,
        days,
        duration_preset: preset || undefined,
        pricing_mode: pricingMode,
        node_ids,
        node_group,
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
      if (nodeMode === "manual" && selectedNodeIds.length === 0) {
        throw new Error(t("newUser.nodeSelectRequired"));
      }
      if (nodeMode === "group" && !nodeGroup) {
        throw new Error(t("newUser.nodeGroupRequired"));
      }
      const node_ids = nodeMode === "manual" ? selectedNodeIds : undefined;
      const node_group = nodeMode === "group" ? nodeGroup || undefined : undefined;
      const count = bulkEnabled ? Math.min(Math.max(1, Number(bulkCount) || 1), 50) : 1;
      const created: Array<{ user_id: number; label: string; master_link: string }> = [];
      for (let i = 1; i <= count; i++) {
        const suffix = count > 1 ? `-${i}` : "";
        const label_i = `${label}${suffix}`;
        const username_i = randomize ? undefined : username ? (count > 1 ? `${username}_${i}` : username) : undefined;
        const payload: any = {
          label: label_i,
          username: username_i || undefined,
          randomize_username: randomize,
          total_gb: totalGb,
          days,
          duration_preset: preset || undefined,
          pricing_mode: pricingMode,
          node_ids,
          node_group,
        };
        try {
          const res = await apiFetch<CreateResp>("/api/v1/reseller/user-ops", { method: "POST", body: JSON.stringify(payload) });
          const base = typeof window !== "undefined" ? window.location.origin : "";
          created.push({ user_id: res.user_id, label: label_i, master_link: `${base}/api/v1/sub/${res.master_sub_token}` });
        } catch (err: any) {
          if (created.length) {
            setBulkLinks(created);
            setBulkLinksOpen(true);
          }
          throw err;
        }
      }

      if (created.length === 1) {
        push({ title: "کاربر ساخته شد", desc: `ID: ${created[0].user_id}`, type: "success" });
        r.push(`/app/users/${created[0].user_id}`);
      } else if (created.length > 1) {
        setBulkLinks(created);
        setBulkLinksOpen(true);
        push({ title: "کاربران ساخته شدند", desc: `تعداد: ${created.length}`, type: "success" });
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

          <div className="space-y-3">
            <label className="text-sm flex items-center gap-2">
              {t("newUser.nodeSelect")} <HelpTip text={t("help.nodeIds")} />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant={nodeMode === "all" ? "primary" : "outline"} onClick={() => { setNodeMode("all"); setNodeGroup(""); }}>
                {t("newUser.nodesAll")}
              </Button>
              <Button type="button" variant={nodeMode === "manual" ? "primary" : "outline"} onClick={() => { setNodeMode("manual"); setNodeGroup(""); }}>
                {t("newUser.nodesManual")}
              </Button>
              <Button type="button" variant={nodeMode === "group" ? "primary" : "outline"} onClick={() => setNodeMode("group")}>
                {t("newUser.nodesGroup")}
              </Button>
            </div>

            {nodeMode === "all" ? (
              <div className="text-xs text-[hsl(var(--fg))]/70">{t("newUser.nodesAllHint")}</div>
            ) : null}

            {nodeMode === "group" ? (
              <div className="space-y-2">
                <select
                  className="w-full rounded-xl border border-[hsl(var(--border))] bg-transparent px-3 py-2 text-sm"
                  value={nodeGroup}
                  onChange={(e) => setNodeGroup(e.target.value)}
                >
                  <option value="">{t("newUser.nodeGroupNone")}</option>
                  {tagOptions.map((tg) => (
                    <option key={tg} value={tg}>
                      {tg}
                    </option>
                  ))}
                </select>
                <div className="text-xs text-[hsl(var(--fg))]/70">{t("newUser.nodeGroupHint")}</div>
                {tagOptions.length ? (
                  <div className="flex flex-wrap gap-1">
                    {tagOptions.slice(0, 14).map((tg) => (
                      <span key={tg} className="text-[10px] rounded-lg px-2 py-0.5 border border-[hsl(var(--border))] text-[hsl(var(--fg))]/70">
                        {tg}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {nodeMode === "manual" ? (
              <div className="rounded-2xl border border-[hsl(var(--border))] p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Input value={nodePickQ} onChange={(e) => setNodePickQ(e.target.value)} placeholder={t("common.search")} />
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" onClick={() => toggleAll(true)}>{t("newUser.selectAll")}</Button>
                    <Button type="button" variant="outline" onClick={() => toggleAll(false)}>{t("newUser.clearAll")}</Button>
                  </div>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  {filteredNodes.map((n) => (
                    <label key={n.id} className="flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] px-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selectedNodeIds.includes(n.id)}
                        onChange={(e) => toggleOne(n.id, e.target.checked)}
                      />
                      <span className="truncate">{n.name} (#{n.id}) • {n.panel_type}</span>
                    </label>
                  ))}
                </div>
                {!filteredNodes.length ? <div className="text-xs text-[hsl(var(--fg))]/70">{t("common.empty")}</div> : null}
              </div>
            ) : null}
          </div>

          <div className="space-y-2 rounded-2xl border border-[hsl(var(--border))] p-3">
            <div className="flex items-center gap-2">
              <Switch checked={bulkEnabled} onCheckedChange={setBulkEnabled} />
              <div className="text-sm font-medium">{t("newUser.bulk")}</div>
            </div>
            {bulkEnabled ? (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  {bulkPresets.map((n) => (
                    <Button key={n} type="button" variant={bulkCount === n ? "primary" : "outline"} onClick={() => setBulkCount(n)}>
                      {n}
                    </Button>
                  ))}
                </div>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={bulkCount}
                  onChange={(e) => setBulkCount(Math.min(50, Math.max(1, Number(e.target.value) || 1)))}
                />
                <div className="text-xs text-[hsl(var(--fg))]/70">{t("newUser.bulkHint")}</div>
              </div>
            ) : (
              <div className="text-xs text-[hsl(var(--fg))]/70">{t("newUser.bulkOff")}</div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={loading} onClick={doQuote}>{t("newUser.quote")}</Button>
            <Button type="button" disabled={loading} onClick={doCreate}>{bulkEnabled ? t("newUser.createBulk") : t("newUser.create")}</Button>
            <Button type="button" variant="ghost" onClick={() => r.push("/app/users")}>{t("newUser.back")}</Button>
          </div>

          {quote ? (
            <Card>
              <CardHeader>
                <div className="text-sm text-[hsl(var(--fg))]/70">پیش‌فاکتور</div>
                <div className="text-xl font-semibold">
                  {fmtNumber(quote.total_amount * (bulkEnabled ? bulkCount : 1))} تومان
                </div>
                {bulkEnabled ? (
                  <div className="text-xs text-[hsl(var(--fg))]/60">
                    {t("newUser.bulkTotalHint").replace("{count}", String(bulkCount)).replace("{per}", fmtNumber(quote.total_amount))}
                  </div>
                ) : null}
              </CardHeader>
              <CardContent className="text-sm space-y-1">
                <div>هزینه زمان: {fmtNumber(quote.time_amount)}</div>
                <div className="text-[hsl(var(--fg))]/70">جزئیات per-node (اگر per_node باشد):</div>
                <pre className="text-xs bg-[hsl(var(--muted))] rounded-xl p-3 overflow-auto">{JSON.stringify(quote.per_node_amount, null, 2)}</pre>
              </CardContent>
            </Card>
          ) : null}
        </CardContent>
      </Card>

      <Modal
        open={bulkLinksOpen}
        onClose={() => {
          setBulkLinksOpen(false);
          setBulkLinks([]);
        }}
        title={t("newUser.bulkLinksTitle")}
      >
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-[hsl(var(--fg))]/70">{t("newUser.bulkLinksHint")}</div>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const all = bulkLinks.map((x) => x.master_link).join("\n");
                copyText(all).then((ok) => push({ title: ok ? t("common.copied") : t("common.failed"), type: ok ? "success" : "error" }));
              }}
            >
              {t("newUser.copyAll")}
            </Button>
          </div>
          <div className="space-y-2">
            {bulkLinks.map((x) => (
              <div key={x.user_id} className="rounded-xl border border-[hsl(var(--border))] p-3">
                <div className="text-xs text-[hsl(var(--fg))]/70">{x.label} • #{x.user_id}</div>
                <div className="mt-1 break-all text-xs">{x.master_link}</div>
                <div className="mt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => copyText(x.master_link).then((ok) => push({ title: ok ? t("common.copied") : t("common.failed"), type: ok ? "success" : "error" }))}
                  >
                    {t("common.copy")}
                  </Button>
                </div>
              </div>
            ))}
            {!bulkLinks.length ? <div className="text-xs text-[hsl(var(--fg))]/70">{t("common.empty")}</div> : null}
          </div>
        </div>
      </Modal>
    </div>
  );
}
