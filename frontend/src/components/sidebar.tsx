"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { useAuth } from "@/components/auth-context";
import { useI18n } from "@/components/i18n-context";
import { Badge } from "@/components/ui/badge";
import { fmtNumber } from "@/lib/format";
import { storage } from "@/lib/storage";
import {
  ArrowDownUp,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  LogOut,
  PlugZap,
  Power,
  Settings,
  Users,
  Wallet,
  Copy,
  Server,
} from "lucide-react";

const items = [
  { href: "/app", labelKey: "nav.dashboard", icon: LayoutDashboard },
  { href: "/app/admin/resellers", labelKey: "nav.resellers", icon: Users },
  { href: "/app/admin/nodes", labelKey: "nav.adminNodes", icon: Server },
  { href: "/app/admin/allocations", labelKey: "nav.allocations", icon: PlugZap },
  { href: "/app/admin/reports/ledger", labelKey: "nav.ledger", icon: ArrowDownUp },
  { href: "/app/admin/reports/orders", labelKey: "nav.orders", icon: Wallet },
  { href: "/app/users", labelKey: "nav.users", icon: Copy },
  { href: "/app/nodes", labelKey: "nav.nodes", icon: Power },
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
  const pathname = usePathname();
  const router = useRouter();
  const { lang, setLang, t } = useI18n();

  function logout() {
    storage.del("token");
    onNavigate?.();
    router.replace("/login");
  }

  return (
    <aside
      className={cn(
        "shrink-0 border-r border-[hsl(var(--border))] bg-[hsl(var(--sidebar-bg))] flex h-screen max-h-screen flex-col overflow-hidden transition-all",
        collapsed ? "w-16" : "w-72",
        className
      )}
    >
      <div
        className={cn(
          "flex items-center justify-between border-b border-[hsl(var(--border))] p-3",
          collapsed ? "flex-col gap-2" : "px-4"
        )}
      >
        <div className={cn("text-lg font-semibold tracking-tight", collapsed ? "text-sm" : "")}>{collapsed ? "GH" : t("app.title")}</div>
        <button
          type="button"
          onClick={() => onToggleCollapse?.()}
          className="rounded-lg border border-[hsl(var(--border))] p-1 transition-colors hover:bg-[hsl(var(--muted))]"
          title={collapsed ? t("sidebar.open") : t("sidebar.close")}
          aria-label={collapsed ? t("sidebar.open") : t("sidebar.close")}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-3">
        {items
          .filter((it) => (isAdmin ? true : !it.href.startsWith("/app/admin")))
          .map((it) => {
            const active = pathname === it.href || (it.href !== "/app" && pathname.startsWith(it.href));
            const Icon = it.icon;
            return (
              <Link
                key={it.href}
                href={it.href}
                onClick={() => onNavigate?.()}
                title={collapsed ? t(it.labelKey) : undefined}
                className={cn(
                  "group flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-[hsl(var(--accent)/0.16)] text-[hsl(var(--accent))] shadow-soft"
                    : "text-[hsl(var(--fg))]/85 hover:bg-[hsl(var(--muted))]/75 hover:text-[hsl(var(--fg))]"
                )}
              >
                <Icon size={18} className={cn("shrink-0", active ? "opacity-100" : "opacity-85 group-hover:opacity-100")} />
                {!collapsed ? <span className="truncate">{t(it.labelKey)}</span> : null}
              </Link>
            );
          })}
      </nav>

      <div className="border-t border-[hsl(var(--border))] p-3">
        <div className="mb-3">
          {!collapsed ? (
            <>
              <div className="text-xs text-[hsl(var(--fg))]/70">{t("sidebar.signedInAs")}</div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{me?.username ?? "—"}</div>
                  <div className="truncate text-xs text-[hsl(var(--fg))]/60">{me?.role ?? "—"}</div>
                </div>
                <Badge variant={(me?.balance ?? 1) <= 0 ? "danger" : "default"}>{fmtNumber(me?.balance ?? null)}</Badge>
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
            <div className="mb-2 text-xs text-[hsl(var(--fg))]/70">{t("lang.label")}</div>
            <div className="mb-3 flex gap-2">
              <button
                type="button"
                onClick={() => setLang("fa")}
                className={cn(
                  "flex-1 rounded-xl border px-3 py-2 text-xs transition-colors",
                  lang === "fa"
                    ? "border-[hsl(var(--accent)/0.35)] bg-[hsl(var(--accent)/0.14)] text-[hsl(var(--accent))]"
                    : "border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]"
                )}
              >
                {t("lang.fa")}
              </button>
              <button
                type="button"
                onClick={() => setLang("en")}
                className={cn(
                  "flex-1 rounded-xl border px-3 py-2 text-xs transition-colors",
                  lang === "en"
                    ? "border-[hsl(var(--accent)/0.35)] bg-[hsl(var(--accent)/0.14)] text-[hsl(var(--accent))]"
                    : "border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]"
                )}
              >
                {t("lang.en")}
              </button>
            </div>
          </>
        ) : null}

        <button
          type="button"
          onClick={logout}
          className={cn(
            "w-full rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 transition-colors hover:bg-red-500/15 dark:text-red-400",
            collapsed ? "flex items-center justify-center" : "inline-flex items-center justify-center gap-2"
          )}
          title={t("sidebar.logout")}
        >
          <LogOut size={16} />
          {!collapsed ? <span>{t("sidebar.logout")}</span> : null}
        </button>
      </div>
    </aside>
  );
}
