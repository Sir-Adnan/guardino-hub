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
    const viewportPad = 8;
    const menuWidth = Math.max(180, menuRef.current?.offsetWidth || 220);
    const menuHeight = menuRef.current?.offsetHeight || 220;

    let left = align === "right" ? r.right - menuWidth : r.left;
    left = Math.max(viewportPad, Math.min(left, window.innerWidth - menuWidth - viewportPad));

    let top = r.bottom + 8;
    if (top + menuHeight > window.innerHeight - viewportPad && r.top - menuHeight - 8 > viewportPad) {
      top = r.top - menuHeight - 8;
    }
    top = Math.max(viewportPad, top);

    setPos({ top, left });
  }, [align]);

  React.useEffect(() => {
    if (!open) return;
    updatePos();
    const raf = window.requestAnimationFrame(updatePos);
    const onResize = () => updatePos();
    window.addEventListener("scroll", onResize, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.cancelAnimationFrame(raf);
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
            "fixed z-[9999] min-w-[180px] rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(160deg,hsl(var(--card))_0%,hsl(var(--card))_45%,hsl(var(--muted))_100%)] p-1 shadow-2xl shadow-slate-900/20",
            className
          )}
          style={{
            top: pos.top,
            left: pos.left,
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
                "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-[hsl(var(--fg))] transition-all duration-150 hover:-translate-y-0.5 hover:bg-[linear-gradient(125deg,hsl(var(--accent)/0.14),transparent)]",
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
