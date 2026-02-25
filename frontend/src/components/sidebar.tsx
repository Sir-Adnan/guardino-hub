"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { useAuth } from "@/components/auth-context";
import { LayoutDashboard, Users, Server, Settings, ChevronLeft, ChevronRight } from "lucide-react";
import { useI18n } from "@/components/i18n-context";
import { Badge } from "@/components/ui/badge";
import { fmtNumber } from "@/lib/format";

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

export function Sidebar({
  className,
  onNavigate,
  collapsed,
  onToggleCollapse,
}: { className?: string; onNavigate?: () => void; collapsed?: boolean; onToggleCollapse?: () => void } = {}) {
  const { me } = useAuth();
  const isAdmin = me?.role === "admin";
  const p = usePathname();
  const { lang, setLang, t } = useI18n();
  return (
    <aside
      className={cn(
        "shrink-0 border-r border-[hsl(var(--border))] bg-[hsl(var(--sidebar-bg))] flex min-h-screen flex-col transition-all",
        collapsed ? "w-16" : "w-64",
        className
      )}
    >
      <div className={cn("flex items-center justify-between p-3 border-b border-[hsl(var(--border))]", collapsed ? "flex-col gap-2" : "px-4")}>
        <div className={cn("text-lg font-semibold tracking-tight", collapsed ? "text-sm" : "")}>
          {collapsed ? "GH" : t("app.title")}
        </div>
        <button
          type="button"
          onClick={() => onToggleCollapse?.()}
          className="rounded-lg border border-[hsl(var(--border))] p-1 hover:bg-[hsl(var(--muted))]"
          title={collapsed ? t("sidebar.open") : t("sidebar.close")}
          aria-label={collapsed ? t("sidebar.open") : t("sidebar.close")}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>
      <nav className="px-2 flex-1">
        {items.filter(it => isAdmin ? true : !it.href.startsWith('/app/admin')).map((it) => {
          const active = p === it.href || (it.href !== "/app" && p.startsWith(it.href));
          const Icon = it.icon;
          return (
            <Link
              key={it.href}
              href={it.href}
              onClick={() => onNavigate?.()}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition",
                active ? "bg-[hsl(var(--muted))]" : "hover:bg-[hsl(var(--muted))]"
              )}
            >
              <Icon size={18} />
              {!collapsed ? <span>{t(it.labelKey)}</span> : null}
            </Link>
          );
        })}
      </nav>

      <div className="p-3 border-t border-[hsl(var(--border))]">
        <div className="mb-3">
          {!collapsed ? (
            <>
              <div className="text-xs text-[hsl(var(--fg))]/70">{t("sidebar.signedInAs")}</div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{me?.username ?? "—"}</div>
                  <div className="text-xs text-[hsl(var(--fg))]/60 truncate">{me?.role ?? "—"}</div>
                </div>
                <Badge variant={(me?.balance ?? 1) <= 0 ? "danger" : "default"}>
                  {t("users.balance")}: {fmtNumber(me?.balance ?? null)}
                </Badge>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Badge variant={(me?.balance ?? 1) <= 0 ? "danger" : "default"}>{fmtNumber(me?.balance ?? null)}</Badge>
            </div>
          )}
        </div>

        {!collapsed ? (
          <>
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
          </>
        ) : null}
      </div>
    </aside>
  );
}
