import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranslationKey } from "@/lib/i18n";

/**
 * Safety brief version. Bump when the rule list materially changes so
 * acknowledgements before/after the change are distinguishable in the
 * audit trail. This is the only piece of safety state the client knows
 * about today; org/project-specific rule lists can override the default
 * keys below in a future phase.
 */
export const DEFAULT_SAFETY_VERSION = "v1-default-2026-04";

/**
 * Default rules shown when an org has not configured project- or
 * org-level safety text yet. Translation keys, so EN/RU swap together.
 */
export const DEFAULT_SAFETY_RULE_KEYS: TranslationKey[] = [
  "safety.defaultRule1",
  "safety.defaultRule2",
  "safety.defaultRule3",
  "safety.defaultRule4",
];

export interface WriteSafetyAckParams {
  orgId: string;
  workerId: string;
  projectId: string | null;
  safetyVersion: string;
}

/**
 * Insert a single safety_acknowledgements row. Returns the new id on
 * success. Errors are returned, never thrown — the caller should still
 * proceed with clock-in if the ack write fails (network, RLS, table
 * not migrated yet) so a missing audit row never traps a worker on a
 * real construction site.
 */
export async function writeSafetyAck(
  supabase: SupabaseClient,
  params: WriteSafetyAckParams,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from("safety_acknowledgements")
    .insert({
      org_id: params.orgId,
      worker_id: params.workerId,
      project_id: params.projectId,
      safety_version: params.safetyVersion,
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) {
    return { ok: false, error: error?.message ?? "Insert returned no row." };
  }
  return { ok: true, id: data.id };
}
