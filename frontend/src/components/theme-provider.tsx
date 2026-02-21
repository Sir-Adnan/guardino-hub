"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import { storage } from "@/lib/storage";

const ACCENTS: Record<string, string> = {
  blue: "222 89% 55%",
  green: "142 71% 45%",
  red: "0 84% 60%",
  purple: "262 83% 58%",
  orange: "24 94% 50%",
};

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  React.useEffect(() => {
    const accent = storage.get("accent") || "blue";
    const v = ACCENTS[accent] || ACCENTS.blue;
    document.documentElement.style.setProperty("--accent", v);
    document.documentElement.style.setProperty("--accent-fg", "0 0% 100%");
  }, []);

  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem>
      {children}
    </NextThemesProvider>
  );
}

export function setAccent(accent: string) {
  const v = ACCENTS[accent] || ACCENTS.blue;
  document.documentElement.style.setProperty("--accent", v);
  document.documentElement.style.setProperty("--accent-fg", "0 0% 100%");
  storage.set("accent", accent);
}

export const accentOptions = Object.keys(ACCENTS);
