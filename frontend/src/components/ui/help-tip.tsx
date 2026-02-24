"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

export function HelpTip({ text, className }: { text: string; className?: string }) {
  return (
    <span className={cn("relative inline-flex items-center justify-center group", className)}>
      <span
        className={
          "inline-flex h-4 w-4 items-center justify-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--muted))] text-[10px] font-bold text-[hsl(var(--fg))]/80"
        }
      >
        ?
      </span>
      <span
        className={
          "pointer-events-none absolute left-1/2 top-full z-50 mt-2 w-72 -translate-x-1/2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 text-xs text-[hsl(var(--fg))]/90 shadow-soft opacity-0 transition-opacity group-hover:opacity-100"
        }
        style={{ direction: "inherit" }}
      >
        <span className="whitespace-pre-line leading-5">{text}</span>
      </span>
    </span>
  );
}
