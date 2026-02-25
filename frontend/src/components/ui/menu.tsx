"use client";

import * as React from "react";
import { createPortal } from "react-dom";
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
  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null);

  const updatePos = React.useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const MIN_W = 180;
    const GAP = 8;
    const top = r.bottom + GAP;
    let left = align === "right" ? r.right - MIN_W : r.left;
    // keep within viewport
    left = Math.max(GAP, Math.min(left, window.innerWidth - MIN_W - GAP));
    setPos({ top, left });
  }, [align]);

  React.useEffect(() => {
    if (!open) return;
    updatePos();
    const onResize = () => updatePos();
    const onScroll = () => updatePos();
    window.addEventListener("resize", onResize);
    // capture=true to catch scroll on inner containers
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, updatePos]);

  React.useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!open) return;
      const wrap = wrapRef.current;
      const menu = menuRef.current;
      const t = e.target as any;
      if (wrap && wrap.contains(t)) return;
      if (menu && menu.contains(t)) return;
      setOpen(false);
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

  const dropdown = open && pos
    ? createPortal(
        <div
          ref={menuRef}
          style={{ position: "fixed", top: pos.top, left: pos.left }}
          className={cn(
            "z-[60] min-w-[180px] rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-soft p-1"
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
        </div>,
        document.body
      )
    : null;

  return (
    <div ref={wrapRef} className={cn("inline-block", className)}>
      <div onClick={() => setOpen((v) => !v)} className="inline-flex">
        {trigger}
      </div>
      {dropdown}
    </div>
  );
}
