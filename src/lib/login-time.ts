import type { TranslationKey } from "@/lib/i18n";

type TFn = (key: TranslationKey) => string;

export function formatLoginStampTime(date: Date, t: TFn): string {
  const h = date.getHours() % 12 || 12;
  const ap = date.getHours() >= 12 ? "PM" : "AM";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${t("login.clockedInAt")} ${h}:${pad(date.getMinutes())} ${ap}`;
}
