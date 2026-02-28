"use client";
import * as React from "react";
import { cn } from "@/lib/cn";

export function Button({
  className,
  variant = "primary",
  size = "md",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "outline"; size?: "sm" | "md" | "lg" }) {
  const base =
    "inline-flex items-center justify-center rounded-xl font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--accent)/0.45)] disabled:cursor-not-allowed disabled:opacity-60";
  const variants: Record<string, string> = {
    primary:
      "border border-[hsl(var(--accent)/0.35)] bg-[linear-gradient(135deg,hsl(var(--accent))_0%,hsl(var(--accent)/0.84)_100%)] text-[hsl(var(--accent-fg))] shadow-[0_10px_22px_-14px_hsl(var(--accent)/0.8)] hover:-translate-y-0.5 hover:brightness-95 active:translate-y-0",
    ghost:
      "border border-transparent bg-transparent text-[hsl(var(--fg))] hover:-translate-y-0.5 hover:bg-[linear-gradient(125deg,hsl(var(--accent)/0.10),transparent)]",
    outline:
      "border border-[hsl(var(--border))] bg-[linear-gradient(155deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] text-[hsl(var(--fg))] hover:-translate-y-0.5 hover:border-[hsl(var(--accent)/0.35)] hover:bg-[linear-gradient(125deg,hsl(var(--accent)/0.10),hsl(var(--surface-card-1)))]",
  };
  const sizes: Record<string, string> = {
    sm: "px-3 py-1.5 text-xs",
    md: "px-4 py-2 text-sm",
    lg: "px-5 py-2.5 text-base",
  };
  return <button className={cn(base, variants[variant], sizes[size], className)} {...props} />;
}
