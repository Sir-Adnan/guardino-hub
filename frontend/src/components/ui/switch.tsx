"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

export function Switch({ checked, onCheckedChange, disabled, className }: { checked: boolean; onCheckedChange: (v: boolean) => void; disabled?: boolean; className?: string }) {
  const isRTL = typeof document !== "undefined" && document.documentElement.dir === "rtl";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 items-center rounded-full border border-[hsl(var(--border))] transition-colors overflow-hidden",
        checked ? "bg-[hsl(var(--accent))]" : "bg-[hsl(var(--muted))]",
        disabled ? "opacity-50 cursor-not-allowed" : "hover:opacity-90",
        className
      )}
      aria-pressed={checked}
    >
      <span
        className={cn(
          // RTL-safe switch thumb. In RTL we anchor on the right and translate left when checked.
          "absolute top-0.5 h-5 w-5 rounded-full bg-[hsl(var(--card))] shadow-soft transition-transform",
          isRTL ? "right-0.5" : "left-0.5",
          checked ? (isRTL ? "-translate-x-[20px]" : "translate-x-[20px]") : "translate-x-0"
        )}
      />
    </button>
  );
}
