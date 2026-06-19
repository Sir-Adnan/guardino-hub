"use client";

import * as React from "react";
import { storage } from "@/lib/storage";
import { dirFromLang, t as _t, type Lang } from "@/lib/i18n";
import { getDigitStyle, localizeDigits, setDigitStyle as persistDigitStyle, type DigitStyle } from "@/lib/format";

type I18nCtx = {
  lang: Lang;
  dir: "rtl" | "ltr";
  digitStyle: DigitStyle;
  setLang: (lang: Lang) => void;
  setDigitStyle: (style: DigitStyle) => void;
  t: (key: string) => string;
};

const Ctx = React.createContext<I18nCtx | null>(null);

function readInitialLang(): Lang {
  const v = storage.get("lang");
  return v === "en" ? "en" : "fa";
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = React.useState<Lang>(readInitialLang);
  const [digitStyle, setDigitStyleState] = React.useState<DigitStyle>(getDigitStyle);
  const dir = dirFromLang(lang);

  const setLang = React.useCallback((next: Lang) => {
    setLangState(next);
    storage.set("lang", next);
  }, []);

  const setDigitStyle = React.useCallback((next: DigitStyle) => {
    setDigitStyleState(next);
    persistDigitStyle(next);
  }, []);

  React.useEffect(() => {
    // Update HTML direction + language.
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
    document.documentElement.dataset.digitStyle = digitStyle;
  }, [lang, dir, digitStyle]);

  const value = React.useMemo<I18nCtx>(() => {
    return {
      lang,
      dir,
      digitStyle,
      setLang,
      setDigitStyle,
      t: (key: string) => localizeDigits(_t(lang, key), digitStyle),
    };
  }, [lang, dir, digitStyle, setLang, setDigitStyle]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nCtx {
  const v = React.useContext(Ctx);
  if (!v) throw new Error("useI18n must be used within I18nProvider");
  return v;
}
