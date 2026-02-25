"use client";
import * as React from "react";

type ToastType = "success" | "warning" | "error";
type Toast = { id: string; title: string; desc?: string; type?: ToastType };

const ToastCtx = React.createContext<{ push: (t: Omit<Toast, "id">) => void } | null>(null);

function tone(type?: ToastType) {
  switch (type) {
    case "success":
      return "border-emerald-400/40";
    case "warning":
      return "border-amber-400/40";
    case "error":
    default:
      return "border-rose-400/40";
  }
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<Toast[]>([]);

  const push = (t: Omit<Toast, "id">) => {
    const id = Math.random().toString(36).slice(2);
    const toast: Toast = { id, ...t };
    setItems((p) => [toast, ...p].slice(0, 4));
    window.setTimeout(() => setItems((p) => p.filter((x) => x.id !== id)), 3500);
  };

  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="fixed top-3 right-3 z-[9999] flex w-[min(420px,calc(100vw-24px))] flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            role="status"
            aria-live="polite"
            className={`rounded-2xl border bg-slate-950/90 p-3 text-white shadow-lg backdrop-blur ${tone(t.type)}`}
          >
            <div className="text-sm font-semibold">{t.title}</div>
            {t.desc ? <div className="mt-1 text-xs text-white/80">{t.desc}</div> : null}
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
