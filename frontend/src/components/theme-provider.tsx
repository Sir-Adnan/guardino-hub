"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import { storage } from "@/lib/storage";

const ACCENTS: Record<string, string> = {
  blue: "222 89% 55%",
  green: "142 71% 45%",
  red: "0 84% 60%",
  purple: "262 83% 58%",
  orange: "24 94% 50%",
};

type PresetVars = {
  sidebarBg: string;
  surfaceCard1: string;
  surfaceCard2: string;
  surfaceCard3: string;
  surfaceInput1: string;
  surfaceInput2: string;
  surfaceInput3: string;
  surfaceHeaderAccent: string;
  pageGlow1: string;
  pageGlow2: string;
};

type PresetPalette = {
  label: string;
  light: PresetVars;
  dark: PresetVars;
};

const PRESETS: Record<string, PresetPalette> = {
  ocean: {
    label: "Ocean",
    light: {
      sidebarBg: "210 30% 95%",
      surfaceCard1: "0 0% 100%",
      surfaceCard2: "210 36% 98%",
      surfaceCard3: "210 42% 95%",
      surfaceInput1: "0 0% 100%",
      surfaceInput2: "210 34% 98%",
      surfaceInput3: "210 40% 95%",
      surfaceHeaderAccent: "200 92% 48%",
      pageGlow1: "200 92% 48%",
      pageGlow2: "187 85% 45%",
    },
    dark: {
      sidebarBg: "222 47% 10%",
      surfaceCard1: "222 47% 14%",
      surfaceCard2: "222 40% 16%",
      surfaceCard3: "217 33% 20%",
      surfaceInput1: "222 46% 13%",
      surfaceInput2: "222 41% 15%",
      surfaceInput3: "217 33% 19%",
      surfaceHeaderAccent: "198 93% 58%",
      pageGlow1: "198 93% 58%",
      pageGlow2: "186 84% 52%",
    },
  },
  aurora: {
    label: "Aurora",
    light: {
      sidebarBg: "266 20% 95%",
      surfaceCard1: "0 0% 100%",
      surfaceCard2: "270 30% 98%",
      surfaceCard3: "190 45% 95%",
      surfaceInput1: "0 0% 100%",
      surfaceInput2: "255 30% 98%",
      surfaceInput3: "182 45% 95%",
      surfaceHeaderAccent: "258 86% 61%",
      pageGlow1: "258 86% 61%",
      pageGlow2: "178 78% 43%",
    },
    dark: {
      sidebarBg: "248 24% 11%",
      surfaceCard1: "222 47% 14%",
      surfaceCard2: "254 30% 16%",
      surfaceCard3: "184 28% 20%",
      surfaceInput1: "222 47% 13%",
      surfaceInput2: "255 30% 15%",
      surfaceInput3: "183 27% 18%",
      surfaceHeaderAccent: "263 90% 68%",
      pageGlow1: "263 90% 68%",
      pageGlow2: "177 74% 45%",
    },
  },
  sunset: {
    label: "Sunset",
    light: {
      sidebarBg: "28 28% 95%",
      surfaceCard1: "0 0% 100%",
      surfaceCard2: "26 48% 98%",
      surfaceCard3: "42 62% 94%",
      surfaceInput1: "0 0% 100%",
      surfaceInput2: "24 44% 98%",
      surfaceInput3: "39 55% 94%",
      surfaceHeaderAccent: "18 92% 55%",
      pageGlow1: "18 92% 55%",
      pageGlow2: "45 93% 47%",
    },
    dark: {
      sidebarBg: "20 22% 11%",
      surfaceCard1: "222 47% 14%",
      surfaceCard2: "18 34% 18%",
      surfaceCard3: "36 30% 20%",
      surfaceInput1: "222 47% 13%",
      surfaceInput2: "16 30% 17%",
      surfaceInput3: "34 26% 19%",
      surfaceHeaderAccent: "20 95% 62%",
      pageGlow1: "20 95% 62%",
      pageGlow2: "42 95% 53%",
    },
  },
};

function applyAccent(accent: string) {
  const v = ACCENTS[accent] || ACCENTS.blue;
  document.documentElement.style.setProperty("--accent", v);
  document.documentElement.style.setProperty("--accent-fg", "0 0% 100%");
}

function applyPreset(preset: string, isDark: boolean) {
  const key = PRESETS[preset] ? preset : "ocean";
  const vars = isDark ? PRESETS[key].dark : PRESETS[key].light;
  document.documentElement.style.setProperty("--sidebar-bg", vars.sidebarBg);
  document.documentElement.style.setProperty("--surface-card-1", vars.surfaceCard1);
  document.documentElement.style.setProperty("--surface-card-2", vars.surfaceCard2);
  document.documentElement.style.setProperty("--surface-card-3", vars.surfaceCard3);
  document.documentElement.style.setProperty("--surface-input-1", vars.surfaceInput1);
  document.documentElement.style.setProperty("--surface-input-2", vars.surfaceInput2);
  document.documentElement.style.setProperty("--surface-input-3", vars.surfaceInput3);
  document.documentElement.style.setProperty("--surface-header-accent", vars.surfaceHeaderAccent);
  document.documentElement.style.setProperty("--surface-page-glow-1", vars.pageGlow1);
  document.documentElement.style.setProperty("--surface-page-glow-2", vars.pageGlow2);
}

function ThemeSync() {
  const { resolvedTheme } = useTheme();

  React.useEffect(() => {
    const accent = storage.get("accent") || "blue";
    const preset = storage.get("theme_preset") || "ocean";
    applyAccent(accent);
    applyPreset(preset, resolvedTheme === "dark");
  }, [resolvedTheme]);

  return null;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {

  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem>
      <ThemeSync />
      {children}
    </NextThemesProvider>
  );
}

export function setAccent(accent: string) {
  applyAccent(accent);
  storage.set("accent", accent);
}

export function setThemePreset(preset: string) {
  const p = PRESETS[preset] ? preset : "ocean";
  const isDark = document.documentElement.classList.contains("dark");
  applyPreset(p, isDark);
  storage.set("theme_preset", p);
}

export const accentOptions = Object.keys(ACCENTS);
export const presetOptions = Object.entries(PRESETS).map(([key, value]) => ({ key, label: value.label }));
