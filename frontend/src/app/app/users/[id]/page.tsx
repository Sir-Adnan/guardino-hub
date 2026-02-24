"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/ui/toast";

type UserOut = { id: number; label: string; total_gb: number; used_bytes: number; expire_at: string; status: string };
type UsersPage = { items: UserOut[]; total: number };
type LinksResp = { user_id: number; master_link: string; node_links: Array<{ node_id: number; direct_url?: string; status: string; detail?: string }> };

type OpResult = { ok: boolean; charged_amount: number; refunded_amount: number; new_balance: number; user_id: number; detail?: string };

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const userId = Number(id);
  const r = useRouter();
  const { push } = useToast();

  const [user, setUser] = React.useState<UserOut | null>(null);
  const [links, setLinks] = React.useState<LinksResp | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  const [extendDays, setExtendDays] = React.useState(30);
  const [addGb, setAddGb] = React.useState(10);
  const [decreaseGb, setDecreaseGb] = React.useState(5);

  async function refresh() {
    setErr(null);
    try {
      const up = await apiFetch<UsersPage>("/api/v1/reseller/users");
      const u = up.items.find((x) => x.id === userId) || null;
      setUser(u);
      const lr = await apiFetch<LinksResp>(`/api/v1/reseller/users/${userId}/links?refresh=true`);
      setLinks(lr);
    } catch (e: any) {
      setErr(String(e.message || e));
    }
  }

  React.useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function op(path: string, body: any) {
    try {
      const res = await apiFetch<OpResult>(path, { method: "POST", body: JSON.stringify(body) });
      push({ title: "عملیات انجام شد", desc: `Balance: ${res.new_balance}`, type: "success" });
      await refresh();
    } catch (e: any) {
      push({ title: "خطا", desc: String(e.message || e), type: "error" });
    }
  }

  async function setStatus(status: "active" | "disabled") {
    await op(`/api/v1/reseller/users/${userId}/set-status`, { status });
  }

  async function resetUsage() {
    await op(`/api/v1/reseller/users/${userId}/reset-usage`, {});
  }

  async function revoke() {
    await op(`/api/v1/reseller/users/${userId}/revoke`, {});
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => r.push("/app/users")}>بازگشت</Button>
        <Button variant="outline" onClick={refresh}>Refresh</Button>
        <Button variant="ghost" onClick={() => r.push("/app/users/new")}>ساخت کاربر جدید</Button>
      </div>

      {err ? <div className="text-sm text-red-500">{err}</div> : null}

      <Card>
        <CardHeader>
          <div className="text-sm text-[hsl(var(--fg))]/70">User</div>
          <div className="text-xl font-semibold">{user ? user.label : `#${userId}`}</div>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          {user ? (
            <>
              <div>GB: <span className="font-semibold">{user.total_gb}</span></div>
              <div className="flex items-center justify-between gap-2">
                <div>Status: <span className="font-semibold">{user.status}</span></div>
                {user.status === "active" ? (
                  <Button type="button" variant="outline" onClick={() => setStatus("disabled")}>Disable</Button>
                ) : (
                  <Button type="button" onClick={() => setStatus("active")}>Enable</Button>
                )}
              </div>
              <div>Expire: <span className="font-semibold">{new Date(user.expire_at).toLocaleString()}</span></div>
            </>
          ) : <div className="text-[hsl(var(--fg))]/70">Loading...</div>}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="text-xl font-semibold">Links</div>
            <div className="text-sm text-[hsl(var(--fg))]/70">Direct لینک هر پنل + لینک مرکزی</div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {links ? (
              <>
                <div className="space-y-1">
                  <div className="text-xs text-[hsl(var(--fg))]/70">Master</div>
                  <div className="flex gap-2">
                    <Input value={links.master_link} readOnly />
                    <Button type="button" variant="outline" onClick={() => navigator.clipboard.writeText(links.master_link)}>Copy</Button>
                  </div>
                </div>

                <div className="space-y-2">
                  {links.node_links.map((n) => (
                    <div key={n.node_id} className="rounded-xl border border-[hsl(var(--border))] p-3">
                      <div className="flex items-center justify-between">
                        <div className="font-medium">Node #{n.node_id}</div>
                        <div className="text-xs text-[hsl(var(--fg))]/70">{n.status}</div>
                      </div>
                      {n.direct_url ? (
                        <div className="mt-2 flex gap-2">
                          <Input value={n.direct_url} readOnly />
                          <Button type="button" variant="outline" onClick={() => navigator.clipboard.writeText(n.direct_url!)}>Copy</Button>
                        </div>
                      ) : (
                        <div className="text-xs text-[hsl(var(--fg))]/70 mt-2">{n.detail || "No direct link"}</div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            ) : <div className="text-[hsl(var(--fg))]/70">Loading...</div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="text-xl font-semibold">Operations</div>
            <div className="text-sm text-[hsl(var(--fg))]/70">تمدید / افزایش حجم / ریفاند</div>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="rounded-xl border border-[hsl(var(--border))] p-3 space-y-2">
              <div className="font-medium">Subscription</div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={resetUsage}>Reset Usage</Button>
                <Button type="button" variant="outline" onClick={revoke}>Revoke (Regenerate)</Button>
              </div>
              <div className="text-xs text-[hsl(var(--fg))]/70">
                Revoke: در Marzban/Pasarguard توکن ساب عوض می‌شود. در WGDashboard پییر حذف و دوباره ساخته می‌شود (لینک تغییر می‌کند).
              </div>
            </div>

            <div className="rounded-xl border border-[hsl(var(--border))] p-3 space-y-2">
              <div className="font-medium">Extend</div>
              <div className="flex gap-2">
                <Input type="number" value={extendDays} onChange={(e) => setExtendDays(Number(e.target.value))} />
                <Button type="button" onClick={() => op(`/api/v1/reseller/users/${userId}/extend`, { days: extendDays })}>Extend</Button>
              </div>
            </div>

            <div className="rounded-xl border border-[hsl(var(--border))] p-3 space-y-2">
              <div className="font-medium">Add Traffic</div>
              <div className="flex gap-2">
                <Input type="number" value={addGb} onChange={(e) => setAddGb(Number(e.target.value))} />
                <Button type="button" onClick={() => op(`/api/v1/reseller/users/${userId}/add-traffic`, { add_gb: addGb })}>Add</Button>
              </div>
            </div>

            <div className="rounded-xl border border-[hsl(var(--border))] p-3 space-y-2">
              <div className="font-medium">Refund (Decrease)</div>
              <div className="flex gap-2">
                <Input type="number" value={decreaseGb} onChange={(e) => setDecreaseGb(Number(e.target.value))} />
                <Button type="button" variant="outline" onClick={() => op(`/api/v1/reseller/users/${userId}/refund`, { action: "decrease", decrease_gb: decreaseGb })}>Refund</Button>
              </div>
              <div className="text-xs text-[hsl(var(--fg))]/70">طبق سیاست: فقط تا ۱۰ روز و فقط حجم باقی‌مانده.</div>
            </div>

            <div className="rounded-xl border border-[hsl(var(--border))] p-3 space-y-2">
              <div className="font-medium">Delete (Refund remaining)</div>
              <Button type="button" variant="outline" onClick={() => op(`/api/v1/reseller/users/${userId}/refund`, { action: "delete" })}>
                Delete & Refund
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
