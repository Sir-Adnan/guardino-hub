"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/brand-logo";
import { storage } from "@/lib/storage";
import { apiFetch } from "@/lib/api";

type TokenResponse = {
  access_token?: string | null;
  token_type: string;
  requires_2fa?: boolean;
  challenge_token?: string | null;
  expires_in_seconds?: number | null;
};

function localizeLoginError(raw: string): string {
  const s = (raw || "").trim();
  const lower = s.toLowerCase();
  if (lower.includes("invalid credentials")) return "نام کاربری یا رمز عبور اشتباه است.";
  if (lower.includes("account disabled")) return "حساب کاربری شما غیرفعال است.";
  if (lower.includes("invalid token")) return "نشست شما معتبر نیست. دوباره وارد شوید.";
  if (lower.includes("two-factor") || lower.includes("authenticator")) return "کد دومرحله‌ای صحیح نیست یا منقضی شده است.";
  return s || "خطا در ورود.";
}

export default function LoginPage() {
  const r = useRouter();
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [twoFactorCode, setTwoFactorCode] = React.useState("");
  const [challengeToken, setChallengeToken] = React.useState<string | null>(null);
  const [challengeTtl, setChallengeTtl] = React.useState<number | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  function resetTwoFactor() {
    setChallengeToken(null);
    setChallengeTtl(null);
    setTwoFactorCode("");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      if (challengeToken) {
        const verified = await apiFetch<TokenResponse>("/api/v1/auth/login/2fa", {
          method: "POST",
          body: JSON.stringify({ challenge_token: challengeToken, code: twoFactorCode }),
        });
        if (!verified.access_token) throw new Error("Invalid two-factor response");
        storage.set("token", verified.access_token);
        r.push("/app");
        return;
      }

      const res = await apiFetch<TokenResponse>("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      if (res.requires_2fa && res.challenge_token) {
        setChallengeToken(res.challenge_token);
        setChallengeTtl(res.expires_in_seconds || 300);
        setPassword("");
        return;
      }
      if (!res.access_token) throw new Error("Invalid login response");
      storage.set("token", res.access_token);
      r.push("/app");
    } catch (e: any) {
      setErr(localizeLoginError(String(e.message || e)));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md space-y-4 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-soft"
      >
        <div className="flex items-center gap-3">
          <BrandMark markClassName="h-14 w-14 rounded-2xl" />
          <div className="min-w-0">
            <div className="truncate text-lg font-extrabold">Guardino Hub</div>
            <div className="truncate text-xs text-[hsl(var(--fg))]/60">VPN Reseller Platform</div>
          </div>
        </div>

        <div>
          <h1 className="text-xl font-semibold">{challengeToken ? "تایید دومرحله‌ای" : "ورود"}</h1>
          <p className="text-sm text-[hsl(var(--fg))]/70">
            {challengeToken
              ? "کد ۶ رقمی Authenticator یا یکی از backup codeهای ذخیره‌شده را وارد کنید."
              : "با حساب ادمین یا نماینده وارد شوید."}
          </p>
        </div>

        {challengeToken ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-3))]/60 p-3 text-xs leading-6 text-[hsl(var(--fg))]/75">
              این مرحله برای محافظت از حساب فعال شده است. کدهای Authenticator هر ۳۰ ثانیه عوض می‌شوند و challenge ورود حدود{" "}
              {challengeTtl || 300} ثانیه اعتبار دارد.
            </div>
            <div className="space-y-2">
              <label className="text-sm">کد دومرحله‌ای یا backup code</label>
              <Input
                value={twoFactorCode}
                onChange={(e) => setTwoFactorCode(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                autoFocus
              />
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <label className="text-sm">نام کاربری</label>
              <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
            </div>
            <div className="space-y-2">
              <label className="text-sm">رمز عبور</label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </div>
          </>
        )}

        {err ? <div className="text-sm text-red-500">{err}</div> : null}

        <Button disabled={loading || (challengeToken ? !twoFactorCode.trim() : !username.trim() || !password)} className="w-full">
          {loading ? "..." : challengeToken ? "تایید و ورود" : "ورود"}
        </Button>
        {challengeToken ? (
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => {
              resetTwoFactor();
              setErr(null);
            }}
          >
            بازگشت به ورود با رمز
          </Button>
        ) : null}
      </form>
    </main>
  );
}
