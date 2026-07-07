import type { Locale } from "./translations";

/**
 * Fire-and-forget: persist the chosen UI locale to the user's OWN
 * profiles.language via the server route, so server-side features (push
 * titles, Jarvis voice, future emails) match what the worker actually sees.
 *
 * The device localStorage/cookie remains the instant source of truth for the
 * UI — this is a best-effort background write that never blocks or throws.
 */
export function persistProfileLocale(locale: Locale): void {
  if (typeof fetch === "undefined") return;
  void fetch("/api/profile/language", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ locale }),
    keepalive: true,
  }).catch(() => {
    // Best-effort: the device locale is already applied; ignore failures.
  });
}
