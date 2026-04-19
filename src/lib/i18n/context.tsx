"use client";

import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
} from "react";
import {
  type Locale,
  type TranslationKey,
  defaultLocale,
  translations,
} from "./translations";

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

const LOCALE_CHANGE_EVENT = "locale-change";

function readCookieLocale(): Locale {
  if (typeof document === "undefined") return defaultLocale;
  const match = document.cookie.match(/(?:^|;\s*)locale=(en|ru)/);
  return (match?.[1] as Locale) ?? defaultLocale;
}

function readStoredLocale(): Locale {
  if (typeof window === "undefined") return defaultLocale;
  // Prefer localStorage, fall back to cookie, then default
  const stored = localStorage.getItem("locale");
  if (stored === "en" || stored === "ru") return stored;
  return readCookieLocale();
}

function setCookie(locale: Locale) {
  document.cookie = `locale=${locale};path=/;max-age=31536000;SameSite=Lax`;
}

function subscribeToLocale(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", callback);
  window.addEventListener(LOCALE_CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(LOCALE_CHANGE_EVENT, callback);
  };
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  // Source of truth lives in localStorage (with cookie fallback). useSyncExternalStore
  // gives us SSR-safe hydration without setState-in-effect, and updates whenever the
  // locale is changed in any tab.
  const locale = useSyncExternalStore(
    subscribeToLocale,
    readStoredLocale,
    () => defaultLocale,
  );

  const setLocale = useCallback((next: Locale) => {
    localStorage.setItem("locale", next);
    setCookie(next);
    window.dispatchEvent(new Event(LOCALE_CHANGE_EVENT));
  }, []);

  const t = useCallback(
    (key: TranslationKey): string => {
      const entry = translations[key];
      if (!entry) return key;
      return entry[locale];
    },
    [locale],
  );

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useTranslation() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useTranslation must be used within I18nProvider");
  }
  return ctx;
}

export function LanguageSwitcher() {
  const { locale, setLocale } = useTranslation();

  return (
    <button
      type="button"
      onClick={() => setLocale(locale === "en" ? "ru" : "en")}
      className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-2 py-1.5 text-xs font-semibold"
      style={{
        borderColor: "var(--border-default)",
        color: "var(--text-secondary)",
        background: "transparent",
      }}
      aria-label="Switch language"
    >
      {locale === "ru" ? "\ud83c\uddf7\ud83c\uddfa RU" : "\ud83c\uddfa\ud83c\uddf8 EN"}
    </button>
  );
}

