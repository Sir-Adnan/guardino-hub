"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

export type MenuItem = {
  label: string;
  onClick: () => void | Promise<void>;
  disabled?: boolean;
  danger?: boolean;
};

export function Menu({
  trigger,
  items,
  align = "right",
  className,
}: {
  trigger: React.ReactNode;
  items: MenuItem[];
  align?: "left" | "right";
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!open) return;
      const el = ref.current;
      if (!el) return;
      if (!el.contains(e.target as any)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div ref={ref} className={cn("relative inline-block", className)}>
      <div
        onClick={() => setOpen((v) => !v)}
        className="inline-flex"
      >
        {trigger}
      </div>
      {open ? (
        <div
          className={cn(
            "absolute z-30 mt-2 min-w-[180px] rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-soft p-1",
            align === "right" ? "right-0" : "left-0"
          )}
        >
          {items.map((it, idx) => (
            <button
              key={idx}
              disabled={it.disabled}
              onClick={async () => {
                if (it.disabled) return;
                setOpen(false);
                await it.onClick();
              }}
              className={cn(
                "w-full text-left rounded-xl px-3 py-2 text-sm hover:bg-[hsl(var(--muted))] disabled:opacity-50 disabled:hover:bg-transparent",
                it.danger ? "text-red-500" : ""
              )}
            >
              {it.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
