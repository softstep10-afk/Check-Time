import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { BrowserPushSubscription, PushSubscriptionRecord } from "@/lib/notifications/types";

// Service-role data layer for push_subscriptions. There is NO client access to
// this table (RLS + no policy); everything goes through here. The table is
// applied by the owner AFTER deploy, so every function no-ops gracefully while it
// does not exist yet (logs once, never throws).

type SupabaseError = { code?: string; message?: string } | null;

/** True when the failure is "table push_subscriptions does not exist yet". */
export function isMissingTableError(error: SupabaseError): boolean {
  if (!error) return false;
  // 42P01 = undefined_table (Postgres); PGRST205 = table not in PostgREST schema cache.
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  const message = (error.message ?? "").toLowerCase();
  return message.includes("does not exist") || message.includes("could not find the table");
}

let warnedMissingTable = false;
function warnMissingTableOnce(where: string): void {
  if (warnedMissingTable) return;
  warnedMissingTable = true;
  console.warn(
    `[push] push_subscriptions table not present yet — ${where} is a no-op until the owner applies migration 00046.`,
  );
}

const SELECT_COLUMNS =
  "id, profile_id, endpoint, p256dh, auth, user_agent, created_at, last_seen_at, revoked_at";

/** Active (not revoked) subscriptions for a profile. Empty on missing table. */
export async function getActiveSubscriptions(
  profileId: string,
): Promise<PushSubscriptionRecord[]> {
  const admin = createAdminClient();
  if (!admin) return [];
  const { data, error } = await admin
    .from("push_subscriptions")
    .select(SELECT_COLUMNS)
    .eq("profile_id", profileId)
    .is("revoked_at", null);
  if (error) {
    if (isMissingTableError(error)) warnMissingTableOnce("getActiveSubscriptions");
    else console.warn("[push] getActiveSubscriptions failed:", error.message);
    return [];
  }
  return (data ?? []) as PushSubscriptionRecord[];
}

/**
 * Store or refresh this device's subscription for a profile. Endpoint is unique,
 * so a re-subscribe upserts (and un-revokes / bumps last_seen_at). Returns false
 * (no-op) when the table is missing or the service key is absent.
 */
export async function upsertSubscription(args: {
  profileId: string;
  subscription: BrowserPushSubscription;
  userAgent: string | null;
}): Promise<boolean> {
  const admin = createAdminClient();
  if (!admin) return false;
  const nowIso = new Date().toISOString();
  const { error } = await admin
    .from("push_subscriptions")
    .upsert(
      {
        profile_id: args.profileId,
        endpoint: args.subscription.endpoint,
        p256dh: args.subscription.keys.p256dh,
        auth: args.subscription.keys.auth,
        user_agent: args.userAgent,
        last_seen_at: nowIso,
        revoked_at: null,
      },
      { onConflict: "endpoint" },
    );
  if (error) {
    if (isMissingTableError(error)) warnMissingTableOnce("upsertSubscription");
    else console.warn("[push] upsertSubscription failed:", error.message);
    return false;
  }
  return true;
}

/** Mark a subscription revoked by endpoint, scoped to the owning profile. */
export async function revokeByEndpoint(profileId: string, endpoint: string): Promise<boolean> {
  const admin = createAdminClient();
  if (!admin) return false;
  const { error } = await admin
    .from("push_subscriptions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("profile_id", profileId)
    .eq("endpoint", endpoint);
  if (error) {
    if (isMissingTableError(error)) warnMissingTableOnce("revokeByEndpoint");
    else console.warn("[push] revokeByEndpoint failed:", error.message);
    return false;
  }
  return true;
}

/** Mark a subscription revoked by id (used when the push service returns 404/410). */
export async function revokeById(id: string): Promise<void> {
  const admin = createAdminClient();
  if (!admin) return;
  const { error } = await admin
    .from("push_subscriptions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id);
  if (error && !isMissingTableError(error)) {
    console.warn("[push] revokeById failed:", error.message);
  }
}
