"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { AuthProvider } from "@/components/auth-context";
import { storage } from "@/lib/storage";
import { AppHeader } from "@/components/app-header";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const r = useRouter();
  React.useEffect(() => {
    const t = storage.get("token");
    if (!t) r.push("/login");
  }, [r]);

  return (
    <AuthProvider>
      <div className="min-h-screen flex bg-[hsl(var(--bg))]">
        <Sidebar />
        <div className="flex-1 min-w-0 flex flex-col">
          <AppHeader />
          <main className="flex-1 p-6">
            {children}
          </main>
        </div>
      </div>
    </AuthProvider>
  );
}
