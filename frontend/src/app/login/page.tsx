"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { storage } from "@/lib/storage";
import { apiFetch } from "@/lib/api";

type TokenResponse = { access_token: string; token_type: string };

function localizeLoginError(raw: string): string {
  const s = (raw || "").trim();
  const lower = s.toLowerCase();
  if (lower.includes("invalid credentials")) return "نام کاربری یا رمز عبور اشتباه است.";
  if (lower.includes("account disabled")) return "حساب کاربری شما غیرفعال است.";
  if (lower.includes("invalid token")) return "نشست شما معتبر نیست. دوباره وارد شوید.";
  return s || "خطا در ورود.";
}

export default function LoginPage() {
  const r = useRouter();
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [err, setErr] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      const res = await apiFetch<TokenResponse>("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      storage.set("token", res.access_token);
      r.push("/app");
    } catch (e: any) {
      setErr(localizeLoginError(String(e.message || e)));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <form onSubmit={onSubmit} className="max-w-md w-full rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-soft p-6 space-y-4">
        <div>
          <h1 className="text-xl font-semibold">ورود</h1>
          <p className="text-sm text-[hsl(var(--fg))]/70">با حساب ادمین یا نماینده وارد شوید</p>
        </div>
        <div className="space-y-2">
          <label className="text-sm">نام کاربری</label>
          <Input value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>
        <div className="space-y-2">
          <label className="text-sm">رمز عبور</label>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {err ? <div className="text-sm text-red-500">{err}</div> : null}
        <Button disabled={loading} className="w-full">{loading ? "..." : "ورود"}</Button>
      </form>
    </main>
  );
}
