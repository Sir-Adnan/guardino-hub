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
      return "border-emerald-600/30 bg-emerald-50 text-emerald-900";
    case "warning":
      return "border-amber-600/30 bg-amber-50 text-amber-900";
    case "error":
    default:
      return "border-rose-600/30 bg-rose-50 text-rose-900";
  }
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<Toast[]>([]);
  const remove = React.useCallback((id: string) => {
    setItems((p) => p.filter((x) => x.id !== id));
  }, []);

  const push = React.useCallback((t: ToastInput) => {
    const id = Math.random().toString(36).slice(2);
    const toast: Toast = { id, ...t };
    setItems((p) => [toast, ...p].slice(0, 4));
    window.setTimeout(() => remove(id), 3500);
  }, [remove]);

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
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-semibold">{t.title}</div>
                {t.desc ? (
                  <div className="mt-1 whitespace-pre-wrap text-xs opacity-90">{t.desc}</div>
                ) : null}
              </div>
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => remove(t.id)}
                className="rounded-md px-2 py-0.5 text-xs opacity-80 transition hover:bg-black/10 hover:opacity-100"
              >
                ×
              </button>
            </div>
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
