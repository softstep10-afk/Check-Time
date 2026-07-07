import type { SupabaseClient } from "@supabase/supabase-js";

export type ConsentState = "granted" | "denied" | "unknown";

export const GPS_CONSENT_VERSION = 2;
export const GPS_CONSENT_LEGACY_STORAGE_KEY = "check-time-gps-consent";

export function gpsConsentStorageKey(version = GPS_CONSENT_VERSION): string {
  return `check-time-gps-consent-v${version}`;
}

type ConsentStorage = Pick<Storage, "getItem" | "setItem">;

export function readCachedGpsConsent(
  storage: ConsentStorage | null | undefined,
  version = GPS_CONSENT_VERSION,
): ConsentState {
  if (!storage) return "unknown";
  const current = storage.getItem(gpsConsentStorageKey(version));
  const cached =
    current ??
    (version === 1 ? storage.getItem(GPS_CONSENT_LEGACY_STORAGE_KEY) : null);
  if (cached === "true") {
    if (current == null) storage.setItem(gpsConsentStorageKey(version), "true");
    return "granted";
  }
  if (cached === "false") {
    if (current == null) storage.setItem(gpsConsentStorageKey(version), "false");
    return "denied";
  }
  return "unknown";
}

export function hasCachedGpsConsentDecision(
  storage: ConsentStorage | null | undefined,
  version = GPS_CONSENT_VERSION,
): boolean {
  return readCachedGpsConsent(storage, version) !== "unknown";
}

export function writeCachedGpsConsent(
  storage: ConsentStorage | null | undefined,
  granted: boolean,
  version = GPS_CONSENT_VERSION,
): void {
  if (!storage) return;
  const value = String(granted);
  storage.setItem(gpsConsentStorageKey(version), value);
  if (version === 1) storage.setItem(GPS_CONSENT_LEGACY_STORAGE_KEY, value);
}

/**
 * Read the latest worker_location_consents row for a worker.
 * Returns "unknown" when there is no row OR when the read fails for any
 * reason (RLS, network, etc.) — callers should treat that as "no consent
 * decision yet" and never block the UI on it.
 */
export async function readLatestConsent(
  supabase: SupabaseClient,
  workerId: string,
  consentVersion = GPS_CONSENT_VERSION,
): Promise<ConsentState> {
  const { data, error } = await supabase
    .from("worker_location_consents")
    .select("consented")
    .eq("worker_id", workerId)
    .eq("consent_version", consentVersion)
    .order("signed_at", { ascending: false })
    .limit(1);
  if (error || !data || data.length === 0) return "unknown";
  return (data[0] as { consented: boolean }).consented ? "granted" : "denied";
}

export type WriteConsentParams = {
  orgId: string;
  workerId: string;
  signedName: string;
  granted: boolean;
  userAgent?: string;
  consentVersion?: number;
};

export function buildGpsConsentInsert(params: WriteConsentParams): Record<string, unknown> {
  return {
    org_id: params.orgId,
    worker_id: params.workerId,
    signed_name: params.signedName.trim(),
    consented: params.granted,
    consent_version: params.consentVersion ?? GPS_CONSENT_VERSION,
    user_agent: params.userAgent ?? null,
  };
}

/**
 * Append a new worker_location_consents row. Inserts (never updates) so
 * the table doubles as an audit trail of every consent flip. Errors are
 * returned, not thrown — the caller decides whether to surface them.
 */
export async function writeConsent(
  supabase: SupabaseClient,
  params: WriteConsentParams,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.from("worker_location_consents").insert(buildGpsConsentInsert(params));
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
