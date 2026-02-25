"use client";
import * as React from "react";
import { cn } from "@/lib/cn";

export function Button({
  className,
  variant = "primary",
  size = "md",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "outline"; size?: "sm" | "md" | "lg" }) {
  const base = "inline-flex items-center justify-center rounded-xl font-medium transition";
  const variants: Record<string, string> = {
    primary: "bg-[hsl(var(--accent))] text-[hsl(var(--accent-fg))] hover:opacity-90 shadow-soft",
    ghost: "hover:bg-[hsl(var(--muted))]",
    outline: "border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]",
  };
  const sizes: Record<string, string> = {
    sm: "px-3 py-1.5 text-xs",
    md: "px-4 py-2 text-sm",
    lg: "px-5 py-2.5 text-base",
  };
  return <button className={cn(base, variants[variant], sizes[size], className)} {...props} />;
}
