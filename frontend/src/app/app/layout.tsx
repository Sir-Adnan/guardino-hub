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
  React.useEffect(() => {
    const t = storage.get("token");
    if (!t) r.push("/login");
  }, [r]);

  return (
    <AuthProvider>
      <div className="min-h-screen flex bg-[hsl(var(--bg))]">
        {/* Desktop sidebar */}
        <div className="hidden md:block">
          <Sidebar />
        </div>

        {/* Mobile sidebar drawer */}
        {sidebarOpen ? (
          <div className="fixed inset-0 z-50 md:hidden">
            <div className="absolute inset-0 bg-black/40" onClick={() => setSidebarOpen(false)} />
            <div className="absolute inset-y-0 right-0 w-[80vw] max-w-[320px]">
              <Sidebar className="h-full min-h-0" onNavigate={() => setSidebarOpen(false)} />
            </div>
          </div>
        ) : null}

        <div className="flex-1 min-w-0 flex flex-col">
          <AppHeader onMenuClick={() => setSidebarOpen(true)} />
          <main className="flex-1 p-3 sm:p-4 lg:p-6">
            {children}
          </main>
        </div>
      </div>
    </AuthProvider>
  );
}
