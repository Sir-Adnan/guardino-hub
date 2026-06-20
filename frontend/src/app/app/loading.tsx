// Branded loading screen shown while the /app segment loads (e.g. on PWA cold
// start), so users see a polished gradient screen instead of a blank/dark flash.
export default function AppLoading() {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 overflow-hidden bg-[hsl(var(--bg))] p-6">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(1000px_520px_at_50%_-10%,hsl(var(--surface-page-glow-1)/0.18),transparent_60%),radial-gradient(760px_480px_at_110%_115%,hsl(var(--surface-page-glow-2)/0.14),transparent_55%)]" />

      <div className="relative flex h-20 w-20 items-center justify-center rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-[0_24px_60px_-30px_hsl(var(--fg)/0.6)]">
        <img
          src="/brand/guardino-mark.png?v=2026-06-20-1"
          alt="Guardino"
          width={48}
          height={48}
          className="h-12 w-12 object-contain"
        />
      </div>

      <div className="relative text-center">
        <div className="text-base font-bold tracking-tight text-[hsl(var(--fg))]">Guardino Hub</div>
        <div className="mt-1 text-xs text-[hsl(var(--fg))]/60">در حال بارگذاری…</div>
      </div>

      <div className="relative h-6 w-6 animate-spin rounded-full border-2 border-[hsl(var(--border))] border-t-[hsl(var(--accent))]" />
    </div>
  );
}
