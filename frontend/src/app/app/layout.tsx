"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { AuthProvider } from "@/components/auth-context";
import { storage } from "@/lib/storage";
import { AppHeader } from "@/components/app-header";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const r = useRouter();
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  React.useEffect(() => {
    const t = storage.get("token");
    if (!t) r.push("/login");
  }, [r]);

  React.useEffect(() => {
    if (!sidebarOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [sidebarOpen]);

  return (
    <AuthProvider>
      <div className="min-h-screen flex bg-[hsl(var(--bg))]">
        {/* Desktop sidebar */}
        <div className="hidden md:block">
          <Sidebar collapsed={sidebarCollapsed} onToggleCollapse={() => setSidebarCollapsed((v) => !v)} />
        </div>

        {/* Mobile sidebar drawer */}
        {sidebarOpen ? (
          <div className="fixed inset-0 z-50 md:hidden">
            <div className="absolute inset-0 bg-black/55 backdrop-blur-[1.5px]" onClick={() => setSidebarOpen(false)} />
            <div className="absolute inset-y-0 right-0 w-[88vw] max-w-[320px] border-l border-[hsl(var(--border))] bg-[hsl(var(--sidebar-bg))] shadow-2xl">
              <Sidebar className="!static !w-full h-full min-h-0 max-h-[100dvh]" onNavigate={() => setSidebarOpen(false)} />
            </div>
          </div>
        ) : null}

        <div className="flex-1 min-w-0 flex flex-col">
          <AppHeader onMenuClick={() => setSidebarOpen(true)} onToggleCollapse={() => setSidebarCollapsed((v) => !v)} sidebarCollapsed={sidebarCollapsed} />
          <main className="relative flex-1 overflow-x-hidden p-3 sm:p-4 lg:p-6">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_35%_at_0%_0%,hsl(var(--accent)/0.08),transparent_60%),radial-gradient(60%_38%_at_100%_100%,hsl(var(--accent)/0.06),transparent_62%)]" />
            <div className="relative z-[1] mx-auto w-full max-w-[1700px]">
              {children}
            </div>
          </main>
        </div>
      </div>
    </AuthProvider>
  );
}
