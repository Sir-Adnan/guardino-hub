"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, X } from "lucide-react";

import { cn } from "@/lib/cn";
import { formatJalaliDateTime, jalaliToGregorian, normalizeFaDigits } from "@/lib/jalali";
import { Button } from "@/components/ui/button";

const MONTHS_FA = [
  "فروردین",
  "اردیبهشت",
  "خرداد",
  "تیر",
  "مرداد",
  "شهریور",
  "مهر",
  "آبان",
  "آذر",
  "دی",
  "بهمن",
  "اسفند",
];

const WEEKDAYS_FA = ["ش", "ی", "د", "س", "چ", "پ", "ج"];

function toPersianDigits(value: number | string) {
  return String(value).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)] || d);
}

function getJalaliParts(date: Date) {
  const parts = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(date);
  const year = Number(normalizeFaDigits(parts.find((p) => p.type === "year")?.value || "0"));
  const month = Number(normalizeFaDigits(parts.find((p) => p.type === "month")?.value || "0"));
  const day = Number(normalizeFaDigits(parts.find((p) => p.type === "day")?.value || "0"));
  return { year, month, day };
}

function monthLength(year: number, month: number) {
  if (month <= 6) return 31;
  if (month <= 11) return 30;
  return jalaliToGregorian(year, 12, 30) ? 30 : 29;
}

function toWeekStartSaturday(date: Date) {
  return (date.getDay() + 1) % 7;
}

function buildGregorianDate(year: number, month: number, day: number, hour: number, minute: number) {
  const g = jalaliToGregorian(year, month, day);
  if (!g) return null;
  const dt = new Date(g.gy, g.gm - 1, g.gd, hour, minute, 0, 0);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

function addDays(base: Date, days: number) {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

function addMonths(base: Date, months: number) {
  const d = new Date(base);
  d.setMonth(d.getMonth() + months);
  return d;
}

export function JalaliDateTimePicker({
  value,
  onChange,
  disabled,
  className,
  triggerClassName,
  mode = "full",
  placeholder = "انتخاب تاریخ",
}: {
  value: Date | null;
  onChange: (next: Date) => void;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  mode?: "full" | "icon";
  placeholder?: string;
}) {
  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null);

  const [viewYear, setViewYear] = React.useState<number>(0);
  const [viewMonth, setViewMonth] = React.useState<number>(1);
  const [selectedDay, setSelectedDay] = React.useState<number>(1);
  const [hour, setHour] = React.useState<number>(0);
  const [minute, setMinute] = React.useState<number>(0);

  const syncFromDate = React.useCallback((date: Date) => {
    const parts = getJalaliParts(date);
    setViewYear(parts.year);
    setViewMonth(parts.month);
    setSelectedDay(parts.day);
    setHour(date.getHours());
    setMinute(date.getMinutes());
  }, []);

  React.useEffect(() => {
    const base = value || new Date();
    if (Number.isNaN(base.getTime())) return;
    syncFromDate(base);
  }, [value, syncFromDate]);

  const commit = React.useCallback(
    (year: number, month: number, day: number, hh: number, mm: number) => {
      const maxDay = monthLength(year, month);
      const safeDay = Math.max(1, Math.min(maxDay, day));
      const safeHour = Math.max(0, Math.min(23, hh));
      const safeMinute = Math.max(0, Math.min(59, mm));
      const next = buildGregorianDate(year, month, safeDay, safeHour, safeMinute);
      if (!next) return;
      onChange(next);
    },
    [onChange]
  );

  const updatePos = React.useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const panelWidth = Math.max(320, panelRef.current?.offsetWidth || 340);
    const panelHeight = panelRef.current?.offsetHeight || 420;
    const vpPad = 8;

    let left = r.left;
    left = Math.max(vpPad, Math.min(left, window.innerWidth - panelWidth - vpPad));

    let top = r.bottom + 8;
    if (top + panelHeight > window.innerHeight - vpPad && r.top - panelHeight - 8 > vpPad) {
      top = r.top - panelHeight - 8;
    }
    top = Math.max(vpPad, top);
    setPos({ top, left });
  }, []);

  React.useEffect(() => {
    if (!open) return;
    updatePos();
    const raf = window.requestAnimationFrame(updatePos);
    const onMove = () => updatePos();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, updatePos]);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
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

  const firstDayDate = buildGregorianDate(viewYear, viewMonth, 1, hour, minute);
  const firstOffset = firstDayDate ? toWeekStartSaturday(firstDayDate) : 0;
  const daysCount = monthLength(viewYear, viewMonth);
  const selectedParts = value && !Number.isNaN(value.getTime()) ? getJalaliParts(value) : null;

  React.useEffect(() => {
    const maxDay = monthLength(viewYear, viewMonth);
    if (selectedDay > maxDay) setSelectedDay(maxDay);
  }, [viewYear, viewMonth, selectedDay]);

  const years = React.useMemo(() => {
    const base = getJalaliParts(value || new Date()).year;
    return Array.from({ length: 15 }, (_, i) => base - 5 + i);
  }, [value]);

  const quickActions = [
    { key: "7d", label: "+7d", apply: (d: Date) => addDays(d, 7) },
    { key: "1m", label: "+1m", apply: (d: Date) => addMonths(d, 1) },
    { key: "2m", label: "+2m", apply: (d: Date) => addMonths(d, 2) },
    { key: "3m", label: "+3m", apply: (d: Date) => addMonths(d, 3) },
    { key: "6m", label: "+6m", apply: (d: Date) => addMonths(d, 6) },
    { key: "1y", label: "+1y", apply: (d: Date) => addMonths(d, 12) },
  ] as const;

  const panel =
    open && pos
      ? createPortal(
          <div
            ref={panelRef}
            className="fixed z-[9999] w-[340px] rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(165deg,hsl(var(--card))_0%,hsl(var(--card))_60%,hsl(var(--muted)/0.18)_100%)] p-3 shadow-2xl"
            style={{ top: pos.top, left: pos.left }}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <button
                type="button"
                className="rounded-lg border border-[hsl(var(--border))] p-1.5 hover:bg-[hsl(var(--muted))]"
                onClick={() => {
                  const m = viewMonth === 1 ? 12 : viewMonth - 1;
                  const y = viewMonth === 1 ? viewYear - 1 : viewYear;
                  setViewMonth(m);
                  setViewYear(y);
                }}
                aria-label="ماه قبل"
              >
                <ChevronRight size={16} />
              </button>

              <div className="flex items-center gap-2">
                <select
                  className="rounded-lg border border-[hsl(var(--border))] bg-transparent px-2 py-1 text-sm outline-none"
                  value={viewMonth}
                  onChange={(e) => setViewMonth(Number(e.target.value))}
                >
                  {MONTHS_FA.map((m, i) => (
                    <option key={m} value={i + 1}>
                      {m}
                    </option>
                  ))}
                </select>
                <select
                  className="rounded-lg border border-[hsl(var(--border))] bg-transparent px-2 py-1 text-sm outline-none"
                  value={viewYear}
                  onChange={(e) => setViewYear(Number(e.target.value))}
                >
                  {years.map((y) => (
                    <option key={y} value={y}>
                      {toPersianDigits(y)}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                className="rounded-lg border border-[hsl(var(--border))] p-1.5 hover:bg-[hsl(var(--muted))]"
                onClick={() => {
                  const m = viewMonth === 12 ? 1 : viewMonth + 1;
                  const y = viewMonth === 12 ? viewYear + 1 : viewYear;
                  setViewMonth(m);
                  setViewYear(y);
                }}
                aria-label="ماه بعد"
              >
                <ChevronLeft size={16} />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-1 border-b border-[hsl(var(--border))] pb-2 text-center text-xs text-[hsl(var(--fg))]/70">
              {WEEKDAYS_FA.map((d) => (
                <div key={d}>{d}</div>
              ))}
            </div>

            <div className="mt-2 grid grid-cols-7 gap-1">
              {Array.from({ length: firstOffset }).map((_, i) => (
                <div key={`e-${i}`} className="h-9" />
              ))}
              {Array.from({ length: daysCount }).map((_, idx) => {
                const day = idx + 1;
                const isSelected = Boolean(
                  selectedParts &&
                    selectedParts.year === viewYear &&
                    selectedParts.month === viewMonth &&
                    selectedParts.day === day
                );
                return (
                  <button
                    key={day}
                    type="button"
                    className={cn(
                      "h-9 rounded-lg text-sm transition-all",
                      isSelected
                        ? "bg-[hsl(var(--accent))] text-[hsl(var(--accent-fg))] shadow-soft"
                        : "hover:bg-[hsl(var(--muted))]"
                    )}
                    onClick={() => {
                      setSelectedDay(day);
                      commit(viewYear, viewMonth, day, hour, minute);
                    }}
                  >
                    {toPersianDigits(day)}
                  </button>
                );
              })}
            </div>

            <div className="mt-3 flex flex-wrap gap-1 border-t border-[hsl(var(--border))] pt-2">
              {quickActions.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className="rounded-md px-2 py-1 text-xs text-[hsl(var(--fg))]/75 hover:bg-[hsl(var(--muted))]"
                  onClick={() => {
                    const base = value || new Date();
                    const next = item.apply(base);
                    onChange(next);
                    syncFromDate(next);
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="mt-3 rounded-xl border border-[hsl(var(--border))] p-2.5">
              <div className="mb-2 flex items-center gap-2 text-xs text-[hsl(var(--fg))]/75">
                <Clock3 size={14} />
                زمان
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={hour}
                  onChange={(e) => {
                    const h = Math.max(0, Math.min(23, Number(e.target.value) || 0));
                    setHour(h);
                    commit(viewYear, viewMonth, selectedDay, h, minute);
                  }}
                  className="w-20 rounded-lg border border-[hsl(var(--border))] bg-transparent px-2 py-1 text-center text-sm outline-none focus:ring-2 focus:ring-[hsl(var(--accent))]"
                />
                <span className="text-sm">:</span>
                <input
                  type="number"
                  min={0}
                  max={59}
                  value={minute}
                  onChange={(e) => {
                    const m = Math.max(0, Math.min(59, Number(e.target.value) || 0));
                    setMinute(m);
                    commit(viewYear, viewMonth, selectedDay, hour, m);
                  }}
                  className="w-20 rounded-lg border border-[hsl(var(--border))] bg-transparent px-2 py-1 text-center text-sm outline-none focus:ring-2 focus:ring-[hsl(var(--accent))]"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mr-auto"
                  onClick={() => {
                    const now = new Date();
                    onChange(now);
                    syncFromDate(now);
                  }}
                >
                  الان
                </Button>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <div ref={wrapRef} className={cn("relative", className)}>
      {mode === "icon" ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => !disabled && setOpen((v) => !v)}
          title={value ? `تاریخ انتخابی: ${formatJalaliDateTime(value)}` : placeholder}
          aria-label="انتخاب تاریخ شمسی"
          className={cn(
            "inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(145deg,hsl(var(--card))_0%,hsl(var(--muted)/0.34)_100%)] text-[hsl(var(--fg))]/80 outline-none transition-all duration-200 hover:-translate-y-0.5 hover:border-[hsl(var(--accent)/0.45)] hover:text-[hsl(var(--accent))] hover:shadow-soft disabled:cursor-not-allowed disabled:opacity-60",
            triggerClassName
          )}
        >
          <CalendarDays size={17} />
        </button>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => !disabled && setOpen((v) => !v)}
          className={cn(
            "flex h-10 w-full items-center justify-between rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(160deg,hsl(var(--card))_0%,hsl(var(--muted)/0.28)_100%)] px-3 text-sm outline-none transition-all duration-200 hover:border-[hsl(var(--accent)/0.35)] hover:bg-[hsl(var(--muted)/0.45)] disabled:cursor-not-allowed disabled:opacity-60",
            triggerClassName
          )}
        >
          <span className="truncate text-right">{value ? formatJalaliDateTime(value) : placeholder}</span>
          <span className="flex items-center gap-1 text-[hsl(var(--fg))]/70">
            {value ? (
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  const now = new Date();
                  onChange(now);
                  syncFromDate(now);
                }}
                className="rounded p-1 hover:bg-[hsl(var(--muted))]"
                role="button"
                aria-label="بازگشت به الان"
                title="بازگشت به الان"
              >
                <X size={14} />
              </span>
            ) : null}
            <CalendarDays size={16} />
          </span>
        </button>
      )}
      {panel}
    </div>
  );
}
