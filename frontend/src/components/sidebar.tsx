"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { useAuth } from "@/components/auth-context";
import { LayoutDashboard, Users, Server, Settings } from "lucide-react";

const items = [
  // Reseller + Admin (backend will enforce permissions)

  { href: "/app", label: "Dashboard", icon: LayoutDashboard },
{ href: "/app/admin/resellers", label: "Resellers", icon: Users },
{ href: "/app/admin/nodes", label: "Admin Nodes", icon: Server },
  { href: "/app/admin/allocations", label: "Allocations", icon: Server },
  { href: "/app/admin/reports/ledger", label: "Ledger", icon: Server },
  { href: "/app/admin/reports/orders", label: "Orders", icon: Server },
  { href: "/app/users", label: "Users", icon: Users },
  { href: "/app/nodes", label: "Nodes", icon: Server },
  { href: "/app/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const { me } = useAuth();
  const isAdmin = me?.role === "admin";
  const p = usePathname();
  return (
    <aside className="w-64 shrink-0 border-r border-[hsl(var(--border))] bg-[hsl(var(--card))]">
      <div className="p-4 text-lg font-semibold">Guardino Hub</div>
      <nav className="px-2">
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
              <span>{it.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
