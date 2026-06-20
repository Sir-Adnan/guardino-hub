"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const previouslyFocused = React.useRef<HTMLElement | null>(null);
  const titleId = React.useId();

  // Keep the latest onClose in a ref so the focus/keyboard effect only re-runs
  // when `open` toggles — not on every parent re-render (which would steal focus
  // back to the first field while the user is typing).
  const onCloseRef = React.useRef(onClose);
  React.useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  React.useEffect(() => {
    if (!open) return;

    previouslyFocused.current = (document.activeElement as HTMLElement) || null;

    const panel = panelRef.current;
    const focusables = panel ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)) : [];
    (focusables[0] || panel)?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null
      );
      if (nodes.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !active || !panel.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !active || !panel.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      // Restore focus to whatever was focused before the modal opened.
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center overflow-x-hidden overflow-y-auto p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? titleId : undefined}
    >
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[2.5px]" onClick={onClose} />
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn(
          "relative my-6 min-w-0 w-full max-w-xl rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(165deg,hsl(var(--card))_0%,hsl(var(--card))_52%,hsl(var(--muted))_100%)] shadow-2xl shadow-slate-900/20 max-h-[88dvh] overflow-hidden outline-none",
          className
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-[hsl(var(--border))] bg-[linear-gradient(110deg,hsl(var(--accent)/0.14)_0%,hsl(var(--card))_70%)] px-5 py-4">
          <div id={titleId} className="text-base font-semibold">{title}</div>
          <button
            className="rounded-xl border border-transparent px-2 py-1 text-sm transition-all duration-200 hover:border-[hsl(var(--accent)/0.35)] hover:bg-[hsl(var(--muted))]"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="max-h-[calc(88dvh-72px)] overflow-x-hidden overflow-y-auto px-3 py-4 sm:px-5">{children}</div>
      </div>
    </div>
  );
}
