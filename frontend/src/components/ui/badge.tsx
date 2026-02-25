"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

export function Badge({
  children,
  variant = "default",
  className,
}: {
  children: React.ReactNode;
  variant?: "default" | "success" | "warning" | "danger" | "muted";
  className?: string;
}) {
  const variants: Record<string, string> = {
    default: "bg-[hsl(var(--muted))] text-[hsl(var(--fg))]/90 border border-[hsl(var(--border))]",
    success: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30",
    warning: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30",
    danger: "bg-red-500/15 text-red-700 dark:text-red-300 border border-red-500/30",
    muted: "bg-[hsl(var(--card))] text-[hsl(var(--fg))]/70 border border-[hsl(var(--border))]",
  };
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold", variants[variant], className)}>
      {children}
    </span>
  );
}
