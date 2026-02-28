"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

export function Modal({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-3 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[2.5px]" onClick={onClose} />
      <div
        className={cn(
          "relative my-4 w-full max-w-xl rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(165deg,hsl(var(--card))_0%,hsl(var(--card))_62%,hsl(var(--muted)/0.20)_100%)] shadow-2xl shadow-slate-900/20 max-h-[92dvh] overflow-hidden sm:my-0",
          className
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-[hsl(var(--border))] bg-[linear-gradient(110deg,hsl(var(--accent)/0.14)_0%,hsl(var(--card))_70%)] px-5 py-4">
          <div className="text-base font-semibold">{title}</div>
          <button
            className="rounded-xl border border-transparent px-2 py-1 text-sm transition-all duration-200 hover:border-[hsl(var(--accent)/0.35)] hover:bg-[hsl(var(--muted))]"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="max-h-[calc(92dvh-72px)] overflow-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
