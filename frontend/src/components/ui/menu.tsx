"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

export type MenuItem = {
  label: string;
  onClick: () => void | Promise<void>;
  disabled?: boolean;
  danger?: boolean;
  icon?: React.ReactNode;
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
    const top = r.bottom + 8;
    const left = align === "right" ? r.right : r.left;
    setPos({ top, left });
  }, [align]);

  React.useEffect(() => {
    if (!open) return;
    updatePos();
    const onResize = () => updatePos();
    window.addEventListener("scroll", onResize, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onResize, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, updatePos]);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const w = wrapRef.current;
      const m = menuRef.current;
      const t = e.target as any;
      if (w && w.contains(t)) return;
      if (m && m.contains(t)) return;
      setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  async function handle(item: MenuItem) {
    if (item.disabled) return;
    try {
      await item.onClick();
    } finally {
      setOpen(false);
    }
  }

  const panel = open && pos
    ? createPortal(
        <div
          ref={menuRef}
          className={cn(
            "fixed z-[9999] min-w-[180px] rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-1 shadow-lg",
            className
          )}
          style={{
            top: pos.top,
            left: align === "right" ? pos.left - 180 : pos.left,
          }}
          role="menu"
        >
          {items.map((item, idx) => (
            <button
              key={idx}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => handle(item)}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-[hsl(var(--fg))] hover:bg-[hsl(var(--muted))]/60",
                item.disabled && "opacity-50 cursor-not-allowed hover:bg-transparent",
                item.danger && "text-[hsl(var(--danger))]"
              )}
            >
              {item.icon ? <span className="shrink-0 opacity-80">{item.icon}</span> : null}
              <span className="text-start">{item.label}</span>
            </button>
          ))}
        </div>,
        document.body
      )
    : null;

  return (
    <div className="inline-flex" ref={wrapRef}>
      <div onClick={() => setOpen((v) => !v)}>{trigger}</div>
      {panel}
    </div>
  );
}
