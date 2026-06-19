"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/brand-logo";
import { HelpTip } from "@/components/ui/help-tip";
import { useI18n } from "@/components/i18n-context";
import { storage } from "@/lib/storage";
import { apiFetch } from "@/lib/api";

type TokenResponse = {
  access_token?: string | null;
  token_type: string;
  requires_2fa?: boolean;
  challenge_token?: string | null;
  expires_in_seconds?: number | null;
};

function localizeLoginError(raw: string, lang: "fa" | "en"): string {
  const s = (raw || "").trim();
  const lower = s.toLowerCase();
  if (lower.includes("invalid credentials")) return lang === "en" ? "Username or password is incorrect." : "نام کاربری یا رمز عبور اشتباه است.";
  if (lower.includes("account disabled")) return lang === "en" ? "Your account is disabled." : "حساب کاربری شما غیرفعال است.";
  if (lower.includes("invalid token")) return lang === "en" ? "Your session is not valid. Sign in again." : "نشست شما معتبر نیست. دوباره وارد شوید.";
  if (lower.includes("two-factor") || lower.includes("authenticator")) return lang === "en" ? "The two-factor code is incorrect or expired." : "کد دومرحله‌ای صحیح نیست یا منقضی شده است.";
  return s || (lang === "en" ? "Login failed." : "خطا در ورود.");
}

export default function LoginPage() {
  const r = useRouter();
  const { lang } = useI18n();
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [twoFactorCode, setTwoFactorCode] = React.useState("");
  const [challengeToken, setChallengeToken] = React.useState<string | null>(null);
  const [challengeTtl, setChallengeTtl] = React.useState<number | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const copy = React.useMemo(
    () =>
      lang === "en"
        ? {
            title: challengeToken ? "Two-factor verification" : "Sign in",
            subtitle: challengeToken ? "Enter your Authenticator code or a saved backup code." : "Sign in with an admin or reseller account.",
            twoFactorHelp: `This step protects your account. Authenticator codes rotate every 30 seconds and this login challenge is valid for about ${challengeTtl || 300} seconds.`,
            twoFactorLabel: "Two-factor code or backup code",
            username: "Username",
            password: "Password",
            submit: challengeToken ? "Verify and sign in" : "Sign in",
            back: "Back to password login",
          }
        : {
            title: challengeToken ? "تایید دومرحله‌ای" : "ورود",
            subtitle: challengeToken ? "کد Authenticator یا یکی از backup codeهای ذخیره‌شده را وارد کنید." : "با حساب ادمین یا نماینده وارد شوید.",
            twoFactorHelp: `این مرحله برای محافظت از حساب فعال شده است. کدهای Authenticator هر ۳۰ ثانیه عوض می‌شوند و challenge ورود حدود ${challengeTtl || 300} ثانیه اعتبار دارد.`,
            twoFactorLabel: "کد دومرحله‌ای یا backup code",
            username: "نام کاربری",
            password: "رمز عبور",
            submit: challengeToken ? "تایید و ورود" : "ورود",
            back: "بازگشت به ورود با رمز",
          },
    [challengeToken, challengeTtl, lang]
  );

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
      setErr(localizeLoginError(String(e.message || e), lang));
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
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">{copy.title}</h1>
            {challengeToken ? <HelpTip text={copy.twoFactorHelp} /> : null}
          </div>
          <p className="text-sm text-[hsl(var(--fg))]/70">{copy.subtitle}</p>
        </div>

        {challengeToken ? (
          <div className="space-y-3">
            <div className="space-y-2">
              <label className="text-sm">{copy.twoFactorLabel}</label>
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
              <label className="text-sm">{copy.username}</label>
              <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
            </div>
            <div className="space-y-2">
              <label className="text-sm">{copy.password}</label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </div>
          </>
        )}

        {err ? <div className="text-sm text-red-500">{err}</div> : null}

        <Button disabled={loading || (challengeToken ? !twoFactorCode.trim() : !username.trim() || !password)} className="w-full">
          {loading ? "..." : copy.submit}
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
            {copy.back}
          </Button>
        ) : null}
      </form>
    </main>
  );
}
