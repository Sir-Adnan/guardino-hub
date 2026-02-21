"use client";
import * as React from "react";
import { fetchMe, type Me } from "@/lib/me";
import { storage } from "@/lib/storage";

const Ctx = React.createContext<{ me: Me | null; refresh: () => Promise<void> } | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = React.useState<Me | null>(null);

  const refresh = async () => {
    const t = storage.get("token");
    if (!t) {
      setMe(null);
      return;
    }
    try {
      const m = await fetchMe();
      setMe(m);
    } catch {
      setMe(null);
    }
  };

  React.useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <Ctx.Provider value={{ me, refresh }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = React.useContext(Ctx);
  if (!v) throw new Error("AuthProvider missing");
  return v;
}
