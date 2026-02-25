export function fmtNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US").format(n);
}

export function fmtMaybeNumber(n: number | null | undefined, fallback = "—"): string {
  const v = fmtNumber(n);
  return v === "—" ? fallback : v;
}
