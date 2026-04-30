import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranslationKey } from "@/lib/i18n";

/**
 * Safety brief version. Bump when the rule list materially changes so
 * acknowledgements before/after the change are distinguishable in the
 * audit trail. v2 introduces the full Washington (WAC 296-155 / 880 /
 * 876) reference set + 10-rule list inside the fullscreen Safety Brief
 * acknowledgement screen.
 */
export const DEFAULT_SAFETY_VERSION = "v2-wa-2026-04";

/**
 * Default rules shown when an org has not configured project- or
 * org-level safety text yet. Translation keys, so EN/RU swap together.
 * The list is read top-to-bottom inside SafetyBriefModal.
 */
export const DEFAULT_SAFETY_RULE_KEYS: TranslationKey[] = [
  "safety.rule1",
  "safety.rule2",
  "safety.rule3",
  "safety.rule4",
  "safety.rule5",
  "safety.rule6",
  "safety.rule7",
  "safety.rule8",
  "safety.rule9",
  "safety.rule10",
];

/**
 * Washington construction safety reference notes shown in the brief.
 * Translation keys; UI renders them as a compact "see also" list with
 * a disclaimer that this brief is a daily reminder, not a replacement
 * for full OSHA / WA DOSH training.
 */
export const SAFETY_REFERENCE_KEYS: TranslationKey[] = [
  "safety.reference155",
  "safety.reference155_110",
  "safety.reference155_205",
  "safety.reference155_426",
  "safety.reference880",
  "safety.reference876",
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
