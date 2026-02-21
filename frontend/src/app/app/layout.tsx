"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { storage } from "@/lib/storage";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const r = useRouter();
  React.useEffect(() => {
    const t = storage.get("token");
    if (!t) r.push("/login");
  }, [r]);

  return (
    <div className="min-h-screen flex">
      <Sidebar />
      <main className="flex-1 p-6 bg-[hsl(var(--bg))]">
        {children}
      </main>
    </div>
  );
}
