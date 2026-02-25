"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

export function Switch({ checked, onCheckedChange, disabled, className }: { checked: boolean; onCheckedChange: (v: boolean) => void; disabled?: boolean; className?: string }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 items-center overflow-hidden rounded-full border border-[hsl(var(--border))] transition",
        checked ? "bg-[hsl(var(--accent))]" : "bg-[hsl(var(--muted))]",
        disabled ? "opacity-50 cursor-not-allowed" : "hover:opacity-90",
        className
      )}
      aria-pressed={checked}
    >
      <span
        className={cn(
          "inline-block h-5 w-5 transform rounded-full bg-[hsl(var(--card))] shadow transition",
          checked ? "translate-x-5" : "translate-x-1"
        )}
      />
    </button>
  );
}
