"use client";
import * as React from "react";

type Toast = { id: string; title: string; desc?: string; type?: "success" | "error" };

const ToastCtx = React.createContext<{
  push: (t: Omit<Toast, "id">) => void;
} | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<Toast[]>([]);

  const push = (t: Omit<Toast, "id">) => {
    const id = Math.random().toString(36).slice(2);
    const toast: Toast = { id, ...t };
    setItems((p) => [toast, ...p].slice(0, 4));
    setTimeout(() => setItems((p) => p.filter((x) => x.id !== id)), 3500);
  };

  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="fixed top-4 left-4 z-50 space-y-2">
        {items.map((t) => (
          <div
            key={t.id}
            className={`w-80 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-soft p-3 ${
              t.type === "error" ? "ring-2 ring-red-500/30" : t.type === "success" ? "ring-2 ring-green-500/30" : ""
            }`}
          >
            <div className="text-sm font-semibold">{t.title}</div>
            {t.desc ? <div className="text-xs text-[hsl(var(--fg))]/70 mt-1">{t.desc}</div> : null}
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
