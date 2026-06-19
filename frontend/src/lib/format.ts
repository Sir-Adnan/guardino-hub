export type DigitStyle = "latin" | "persian";

export const DIGIT_STYLE_STORAGE_KEY = "guardino_digit_style";

const DASH = "\u2014";
const PERSIAN_DIGITS = ["\u06f0", "\u06f1", "\u06f2", "\u06f3", "\u06f4", "\u06f5", "\u06f6", "\u06f7", "\u06f8", "\u06f9"];

export function toLatinDigits(value: string | number): string {
  return String(value ?? "")
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

export function getDigitStyle(): DigitStyle {
  if (typeof window === "undefined") return "latin";
  try {
    const datasetStyle = window.document?.documentElement?.dataset?.digitStyle;
    if (datasetStyle === "persian") return "persian";
    if (datasetStyle === "latin") return "latin";
    return window.localStorage.getItem(DIGIT_STYLE_STORAGE_KEY) === "persian" ? "persian" : "latin";
  } catch {
    return "latin";
  }
}

export function setDigitStyle(style: DigitStyle) {
  if (typeof window === "undefined") return;
  try {
    window.document.documentElement.dataset.digitStyle = style;
    window.localStorage.setItem(DIGIT_STYLE_STORAGE_KEY, style);
    window.dispatchEvent(new CustomEvent("guardino:digit-style", { detail: style }));
  } catch {
    // Storage can be blocked in private or strict browser modes.
  }
}

export function localizeDigits(value: string | number, style: DigitStyle = getDigitStyle()): string {
  const latin = toLatinDigits(value);
  if (style !== "persian") return latin;
  return latin.replace(/\d/g, (d) => PERSIAN_DIGITS[Number(d)] || d);
}

export function formatNumberWithDigits(n: number, options?: Intl.NumberFormatOptions): string {
  const style = getDigitStyle();
  return new Intl.NumberFormat(style === "persian" ? "fa-IR" : "en-US", options).format(n);
}

export function fmtNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return DASH;
  if (typeof n !== "number" || !Number.isFinite(n)) return DASH;
  return formatNumberWithDigits(n);
}

export function fmtMaybeNumber(n: number | null | undefined, fallback = DASH): string {
  const v = fmtNumber(n);
  return v === DASH ? fallback : v;
}
