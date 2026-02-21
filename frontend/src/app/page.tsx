import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md w-full rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-soft p-6">
        <h1 className="text-2xl font-semibold mb-2">Guardino Hub</h1>
        <p className="text-sm text-[hsl(var(--fg))]/70 mb-6">پنل فروش نمایندگی VPN (نسخه UI اسکفولد)</p>
        <Link href="/login" className="inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-medium bg-[hsl(var(--accent))] text-[hsl(var(--accent-fg))] shadow-soft">
          ورود
        </Link>
      </div>
    </main>
  );
}
