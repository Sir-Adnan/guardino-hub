"use client";
import { cn } from "@/lib/cn";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "w-full rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(160deg,hsl(var(--card))_0%,hsl(var(--muted))/0.22_100%)] px-3 py-2 text-sm outline-none transition-all duration-200 placeholder:text-[hsl(var(--fg))]/45 hover:border-[hsl(var(--accent)/0.28)] focus:ring-2 focus:ring-[hsl(var(--accent))]",
        className
      )}
      {...props}
    />
  );
}
