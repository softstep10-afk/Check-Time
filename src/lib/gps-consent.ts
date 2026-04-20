import type { SupabaseClient } from "@supabase/supabase-js";

export type ConsentState = "granted" | "denied" | "unknown";

/**
 * Read the latest worker_location_consents row for a worker.
 * Returns "unknown" when there is no row OR when the read fails for any
 * reason (RLS, network, etc.) — callers should treat that as "no consent
 * decision yet" and never block the UI on it.
 */
export async function readLatestConsent(
  supabase: SupabaseClient,
  workerId: string,
): Promise<ConsentState> {
  const { data, error } = await supabase
    .from("worker_location_consents")
    .select("consented")
    .eq("worker_id", workerId)
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
};

/**
 * Append a new worker_location_consents row. Inserts (never updates) so
 * the table doubles as an audit trail of every consent flip. Errors are
 * returned, not thrown — the caller decides whether to surface them.
 */
export async function writeConsent(
  supabase: SupabaseClient,
  params: WriteConsentParams,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.from("worker_location_consents").insert({
    org_id: params.orgId,
    worker_id: params.workerId,
    signed_name: params.signedName,
    consented: params.granted,
    consent_version: 1,
    user_agent: params.userAgent ?? null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
