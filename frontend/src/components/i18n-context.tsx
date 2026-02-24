"use client";

import * as React from "react";
import { storage } from "@/lib/storage";
import { dirFromLang, t as _t, type Lang } from "@/lib/i18n";

type I18nCtx = {
  lang: Lang;
  dir: "rtl" | "ltr";
  setLang: (lang: Lang) => void;
  t: (key: string) => string;
};

const Ctx = React.createContext<I18nCtx | null>(null);

function readInitialLang(): Lang {
  const v = storage.get("lang");
  return v === "en" ? "en" : "fa";
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = React.useState<Lang>(readInitialLang);
  const dir = dirFromLang(lang);

  const setLang = React.useCallback((next: Lang) => {
    setLangState(next);
    storage.set("lang", next);
  }, []);

  React.useEffect(() => {
    // Update HTML direction + language.
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [lang, dir]);

  const value = React.useMemo<I18nCtx>(() => {
    return {
      lang,
      dir,
      setLang,
      t: (key: string) => _t(lang, key),
    };
  }, [lang, dir, setLang]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nCtx {
  const v = React.useContext(Ctx);
  if (!v) throw new Error("useI18n must be used within I18nProvider");
  return v;
}
