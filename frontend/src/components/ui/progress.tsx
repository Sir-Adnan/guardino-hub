"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

export function Progress({ value, className }: { value: number; className?: string }) {
  const v = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  return (
    <div className={cn("h-2 w-full rounded-full bg-[hsl(var(--muted))] overflow-hidden", className)}>
      <div className="h-full rounded-full bg-[hsl(var(--accent))]" style={{ width: `${v}%` }} />
    </div>
  );
}
