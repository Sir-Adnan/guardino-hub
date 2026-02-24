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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className={cn("relative w-full max-w-xl rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-soft", className)}>
        <div className="flex items-center justify-between gap-3 border-b border-[hsl(var(--border))] px-5 py-4">
          <div className="text-base font-semibold">{title}</div>
          <button className="rounded-xl px-2 py-1 text-sm hover:bg-[hsl(var(--muted))]" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
