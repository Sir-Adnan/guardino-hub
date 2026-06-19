"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

export function HelpTip({ text, className }: { text: string; className?: string }) {
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const tipRef = React.useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = React.useState(false);
  const [hovered, setHovered] = React.useState(false);
  const [focused, setFocused] = React.useState(false);
  const [pos, setPos] = React.useState<React.CSSProperties>({ left: -9999, top: -9999, width: 288 });
  const [mounted, setMounted] = React.useState(false);
  const visible = open || hovered || focused;

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const updatePosition = React.useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger || typeof window === "undefined") return;
    const rect = trigger.getBoundingClientRect();
    const margin = 12;
    const width = Math.min(288, Math.max(180, window.innerWidth - margin * 2));
    const left = Math.min(window.innerWidth - width - margin, Math.max(margin, rect.left + rect.width / 2 - width / 2));
    const tipHeight = Math.min(tipRef.current?.offsetHeight || 220, window.innerHeight - margin * 2);
    let top = rect.bottom + 8;
    if (top + tipHeight > window.innerHeight - margin) {
      top = Math.max(margin, rect.top - tipHeight - 8);
    }
    setPos({ left, top, width });
  }, []);

  React.useEffect(() => {
    if (!visible) return;
    updatePosition();
    const raf = window.requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [visible, updatePosition]);

  React.useEffect(() => {
    if (!open) return;
    function onPointerDown(ev: PointerEvent) {
      const target = ev.target as Node | null;
      if (target && (triggerRef.current?.contains(target) || tipRef.current?.contains(target))) return;
      setOpen(false);
    }
    function onKeyDown(ev: KeyboardEvent) {
      if (ev.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <span
      className={cn("relative inline-flex items-center justify-center", className)}
      onMouseEnter={() => {
        updatePosition();
        setHovered(true);
      }}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label="Help"
        aria-expanded={visible}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          updatePosition();
          setOpen((v) => !v);
        }}
        onFocus={() => {
          updatePosition();
          setFocused(true);
        }}
        onBlur={() => setFocused(false)}
        className={
          "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--muted))] text-[10px] font-bold text-[hsl(var(--fg))]/80 transition-colors hover:border-[hsl(var(--accent)/0.45)] hover:bg-[hsl(var(--accent)/0.12)] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--accent)/0.35)]"
        }
      >
        ?
      </button>
      {mounted
        ? createPortal(
            <span
              ref={tipRef}
              className={
                "fixed z-[10000] max-h-[min(20rem,calc(100dvh-24px))] max-w-[calc(100vw-24px)] overflow-auto rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 text-xs text-[hsl(var(--fg))]/90 shadow-2xl shadow-black/15 transition-all duration-150 " +
                (visible ? "pointer-events-auto visible translate-y-0 opacity-100" : "pointer-events-none invisible -translate-y-1 opacity-0")
              }
              style={{ direction: "inherit", ...pos }}
            >
              <span className="block whitespace-pre-line break-words leading-5 [overflow-wrap:anywhere]">{text}</span>
            </span>,
            document.body
          )
        : null}
    </span>
  );
}
