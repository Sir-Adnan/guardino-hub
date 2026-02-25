"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

export function Switch({ checked, onCheckedChange, disabled, className }: { checked: boolean; onCheckedChange: (v: boolean) => void; disabled?: boolean; className?: string }) {
  const [isRTL, setIsRTL] = React.useState(false);
  React.useEffect(() => {
    setIsRTL(typeof document !== "undefined" && document.documentElement.dir === "rtl");
  }, []);

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      role="switch"
      aria-checked={checked}
      aria-disabled={disabled}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-all duration-200 overflow-hidden",
        checked ? "border-[hsl(var(--accent)/0.45)] bg-[hsl(var(--accent))]" : "border-[hsl(var(--border))] bg-[hsl(var(--muted))]",
        disabled ? "opacity-55 cursor-not-allowed" : "hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]",
        className
      )}
    >
      <span
        className={cn(
          "absolute top-[2px] h-5 w-5 rounded-full bg-[hsl(var(--card))] shadow transition-transform duration-200",
          isRTL ? "right-[2px]" : "left-[2px]",
          checked ? (isRTL ? "-translate-x-5" : "translate-x-5") : "translate-x-0"
        )}
      />
    </button>
  );
}
