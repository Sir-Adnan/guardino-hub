"use client";

import * as React from "react";

type ToastType = "success" | "error" | "warning";

export type ToastInput = {
  title: string;
  desc?: string;
  type?: ToastType;
};

type Toast = ToastInput & { id: string };

const ToastCtx = React.createContext<{ push: (t: ToastInput) => void } | null>(null);

function tone(type?: ToastType) {
  switch (type) {
    case "success":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-100";
    case "warning":
      return "border-amber-500/30 bg-amber-500/10 text-amber-100";
    case "error":
    default:
      return "border-rose-500/30 bg-rose-500/10 text-rose-100";
  }
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<Toast[]>([]);

  const push = React.useCallback((t: ToastInput) => {
    const id = Math.random().toString(36).slice(2);
    const toast: Toast = { id, ...t };
    setItems((p) => [toast, ...p].slice(0, 4));
    window.setTimeout(() => setItems((p) => p.filter((x) => x.id !== id)), 3500);
  }, []);

  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="fixed top-3 right-3 z-[9999] flex w-[min(420px,calc(100vw-24px))] flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            role="status"
            aria-live="polite"
            className={`rounded-xl border p-3 shadow-lg backdrop-blur ${tone(t.type)}`}
          >
            <div className="text-sm font-semibold">{t.title}</div>
            {t.desc ? (
              <div className="mt-1 whitespace-pre-wrap text-xs opacity-90">{t.desc}</div>
            ) : null}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = React.useContext(ToastCtx);
  if (!ctx) throw new Error("ToastProvider missing");
  return ctx;
}
