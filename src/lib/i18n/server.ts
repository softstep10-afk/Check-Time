import { cookies } from "next/headers";
import {
  type Locale,
  type TranslationKey,
  defaultLocale,
  translations,
} from "./translations";

export async function getServerLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const value = cookieStore.get("locale")?.value;
  if (value === "en" || value === "ru") return value;
  return defaultLocale;
}

export function serverT(locale: Locale, key: TranslationKey): string {
  const entry = translations[key];
  if (!entry) return key;
  return entry[locale];
}
