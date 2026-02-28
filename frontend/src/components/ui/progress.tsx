"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

export function Progress({ value, className }: { value: number; className?: string }) {
  const v = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  return (
    <div className={cn("h-2.5 w-full rounded-full border border-[hsl(var(--border))] bg-[linear-gradient(120deg,hsl(var(--muted))_0%,hsl(var(--card))_100%)] overflow-hidden", className)}>
      <div
        className="h-full rounded-full bg-[linear-gradient(90deg,hsl(var(--accent))_0%,hsl(var(--accent)/0.78)_100%)] shadow-[0_0_14px_hsl(var(--accent)/0.35)] transition-all duration-300"
        style={{ width: `${v}%` }}
      />
    </div>
  );
}
