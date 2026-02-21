"use client";
import * as React from "react";
import { cn } from "@/lib/cn";

export function Button({
  className,
  variant = "primary",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "outline" }) {
  const base = "inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-medium transition";
  const variants: Record<string, string> = {
    primary: "bg-[hsl(var(--accent))] text-[hsl(var(--accent-fg))] hover:opacity-90 shadow-soft",
    ghost: "hover:bg-[hsl(var(--muted))]",
    outline: "border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]",
  };
  return <button className={cn(base, variants[variant], className)} {...props} />;
}
