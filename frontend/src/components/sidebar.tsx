"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { useAuth } from "@/components/auth-context";
import { LayoutDashboard, Users, Server, Settings } from "lucide-react";
import { useI18n } from "@/components/i18n-context";

const items = [
  // Reseller + Admin (backend will enforce permissions)

  { href: "/app", labelKey: "nav.dashboard", icon: LayoutDashboard },
  { href: "/app/admin/resellers", labelKey: "nav.resellers", icon: Users },
  { href: "/app/admin/nodes", labelKey: "nav.adminNodes", icon: Server },
  { href: "/app/admin/allocations", labelKey: "nav.allocations", icon: Server },
  { href: "/app/admin/reports/ledger", labelKey: "nav.ledger", icon: Server },
  { href: "/app/admin/reports/orders", labelKey: "nav.orders", icon: Server },
  { href: "/app/users", labelKey: "nav.users", icon: Users },
  { href: "/app/nodes", labelKey: "nav.nodes", icon: Server },
  { href: "/app/settings", labelKey: "nav.settings", icon: Settings },
];

export function Sidebar() {
  const { me } = useAuth();
  const isAdmin = me?.role === "admin";
  const p = usePathname();
  const { lang, setLang, t } = useI18n();
  return (
    <aside className="w-64 shrink-0 border-r border-[hsl(var(--border))] bg-[hsl(var(--card))] flex min-h-screen flex-col">
      <div className="p-4 text-lg font-semibold">{t("app.title")}</div>
      <nav className="px-2 flex-1">
        {items.filter(it => isAdmin ? true : !it.href.startsWith('/app/admin')).map((it) => {
          const active = p === it.href || (it.href !== "/app" && p.startsWith(it.href));
          const Icon = it.icon;
          return (
            <Link
              key={it.href}
              href={it.href}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition",
                active ? "bg-[hsl(var(--muted))]" : "hover:bg-[hsl(var(--muted))]"
              )}
            >
              <Icon size={18} />
              <span>{t(it.labelKey)}</span>
            </Link>
          );
        })}
      </nav>

      <div className="p-3 border-t border-[hsl(var(--border))]">
        <div className="text-xs text-[hsl(var(--fg))]/70 mb-2">{t("lang.label")}</div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setLang("fa")}
            className={cn(
              "flex-1 rounded-xl border border-[hsl(var(--border))] px-3 py-2 text-xs",
              lang === "fa" ? "bg-[hsl(var(--muted))]" : "hover:bg-[hsl(var(--muted))]"
            )}
          >
            {t("lang.fa")}
          </button>
          <button
            type="button"
            onClick={() => setLang("en")}
            className={cn(
              "flex-1 rounded-xl border border-[hsl(var(--border))] px-3 py-2 text-xs",
              lang === "en" ? "bg-[hsl(var(--muted))]" : "hover:bg-[hsl(var(--muted))]"
            )}
          >
            {t("lang.en")}
          </button>
        </div>
      </div>
    </aside>
  );
}
