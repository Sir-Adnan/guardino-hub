"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useAuth } from "@/components/auth-context";
import { useI18n } from "@/components/i18n-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { fmtNumber } from "@/lib/format";
import { Menu as MenuIcon, Moon, Plus, Sun, ChevronLeft, ChevronRight } from "lucide-react";

function titleKey(pathname: string): string {
  if (pathname === "/app") return "nav.dashboard";
  if (pathname.startsWith("/app/admin/resellers")) return "adminResellers.title";
  if (pathname.startsWith("/app/admin/nodes")) return "adminNodes.title";
  if (pathname.startsWith("/app/admin/allocations")) return "adminAllocations.title";
  if (pathname.startsWith("/app/admin/reports/ledger")) return "nav.ledger";
  if (pathname.startsWith("/app/admin/reports/orders")) return "nav.orders";
  if (pathname.startsWith("/app/users")) return "users.title";
  if (pathname.startsWith("/app/nodes")) return "nav.nodes";
  if (pathname.startsWith("/app/settings")) return "nav.settings";
  return "app.title";
}

export function AppHeader({
  onMenuClick,
  onToggleCollapse,
  sidebarCollapsed,
}: { onMenuClick?: () => void; onToggleCollapse?: () => void; sidebarCollapsed?: boolean } = {}) {
  const p = usePathname();
  const { me } = useAuth();
  const { t } = useI18n();
  const locked = (me?.balance ?? 1) <= 0;
  const { theme, setTheme } = useTheme();

  const key = titleKey(p);
  const showCreateUser = p === "/app/users";

  const isDark = theme === "dark";

  return (
    <header className="sticky top-0 z-30 border-b border-[hsl(var(--border))] bg-[hsl(var(--card))]/85 backdrop-blur">
      <div className="px-4 sm:px-6 py-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-lg font-semibold truncate">{t(key)}</div>
          {locked ? (
            <div className="text-xs text-[hsl(var(--fg))]/70 truncate">{t("users.balanceZero")}</div>
          ) : (
            <div className="text-xs text-[hsl(var(--fg))]/60 truncate">{t("topbar.subtitle")}</div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            className="px-3 md:hidden"
            onClick={() => onMenuClick?.()}
            title={t("sidebar.open")}
            aria-label={t("sidebar.open")}
          >
            <MenuIcon size={20} />
          </Button>

          {onToggleCollapse ? (
            <Button
              variant="ghost"
              className="px-3 hidden md:inline-flex"
              onClick={() => onToggleCollapse()}
              title={sidebarCollapsed ? t("sidebar.open") : t("sidebar.close")}
              aria-label={sidebarCollapsed ? t("sidebar.open") : t("sidebar.close")}
            >
              {sidebarCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
            </Button>
          ) : null}

          {showCreateUser ? (
            <Link href="/app/users/new">
              <Button className="gap-2">
                <Plus size={16} />
                {t("users.create")}
              </Button>
            </Link>
          ) : null}

          <div className="hidden sm:flex items-center gap-2">
            <Badge variant={locked ? "danger" : "default"}>
              {t("users.balance")}: {fmtNumber(me?.balance ?? null)}
            </Badge>
            <Badge variant="muted">{me?.role ?? "—"}</Badge>
          </div>

          <Button
            variant="ghost"
            className="px-3"
            onClick={() => setTheme(isDark ? "light" : "dark")}
            title={isDark ? t("topbar.themeLight") : t("topbar.themeDark")}
          >
            {isDark ? <Sun size={18} /> : <Moon size={18} />}
          </Button>
        </div>
      </div>
    </header>
  );
}
