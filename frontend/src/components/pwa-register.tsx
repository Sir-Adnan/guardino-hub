"use client";

import * as React from "react";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const DISMISSED_AT_KEY = "guardino:pwa-install-dismissed-at";
const DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function isStandaloneMode() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches || Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
}

function canShowInstallPrompt() {
  try {
    const raw = window.localStorage.getItem(DISMISSED_AT_KEY);
    if (!raw) return true;
    const last = Number(raw);
    return !Number.isFinite(last) || Date.now() - last > DISMISS_TTL_MS;
  } catch {
    return true;
  }
}

export function PwaRegister() {
  const [installPrompt, setInstallPrompt] = React.useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;

    const hadController = Boolean(navigator.serviceWorker.controller);
    let refreshing = false;
    const onControllerChange = () => {
      if (!hadController || refreshing) return;
      refreshing = true;
      window.location.reload();
    };

    const register = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then((registration) => registration.update().catch(() => null))
        .catch(() => {
          // PWA should never break normal panel usage.
        });
    };

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    if (document.readyState === "complete") {
      register();
      return () => navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    }

    window.addEventListener("load", register, { once: true });
    return () => {
      window.removeEventListener("load", register);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  React.useEffect(() => {
    if (isStandaloneMode()) return;

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      const promptEvent = event as BeforeInstallPromptEvent;
      setInstallPrompt(promptEvent);
      setVisible(canShowInstallPrompt());
    };

    const onInstalled = () => {
      setVisible(false);
      setInstallPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function install() {
    if (!installPrompt) return;
    setVisible(false);
    await installPrompt.prompt();
    await installPrompt.userChoice.catch(() => null);
    setInstallPrompt(null);
  }

  function dismiss() {
    setVisible(false);
    try {
      window.localStorage.setItem(DISMISSED_AT_KEY, String(Date.now()));
    } catch {
      // Ignore storage failures.
    }
  }

  if (!visible || !installPrompt) return null;

  return (
    <div
      dir="rtl"
      className="fixed inset-x-3 bottom-3 z-[80] mx-auto max-w-[420px] rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(145deg,hsl(var(--card))_0%,hsl(var(--muted))_100%)] p-3 text-[hsl(var(--fg))] shadow-[0_20px_50px_-22px_rgba(15,23,42,0.45)] backdrop-blur sm:inset-x-auto sm:right-4 sm:bottom-4"
    >
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-red-900/10 bg-white shadow-[0_12px_24px_-16px_rgba(153,0,0,0.8)]">
          <img src="/brand/guardino-mark.png" alt="" className="h-full w-full object-contain" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">نصب گاردینو روی موبایل</div>
          <div className="mt-1 text-xs leading-5 text-[hsl(var(--fg))]/68">
            پنل را مثل یک اپلیکیشن باز کنید؛ دسترسی سریع‌تر، تمام‌صفحه و مناسب استفاده روزانه رسیلرها.
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" size="sm" className="gap-2" onClick={install}>
              <Download size={14} />
              نصب
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={dismiss}>
              بعداً
            </Button>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[hsl(var(--fg))]/60 transition-colors hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--fg))]"
          aria-label="بستن"
          title="بستن"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
