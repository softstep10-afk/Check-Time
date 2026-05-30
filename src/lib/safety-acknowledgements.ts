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
  signedName: string;
}

export type SafetyAckState = "acknowledged" | "unknown";

export async function readLatestSafetyAck(
  supabase: SupabaseClient,
  params: Pick<WriteSafetyAckParams, "workerId" | "safetyVersion">,
): Promise<SafetyAckState> {
  const { data, error } = await supabase
    .from("safety_acknowledgements")
    .select("id")
    .eq("worker_id", params.workerId)
    .eq("safety_version", params.safetyVersion)
    .order("acknowledged_at", { ascending: false })
    .limit(1);
  if (error || !data || data.length === 0) return "unknown";
  return "acknowledged";
}

export function normalizeSafetySignedName(signedName: string): string {
  return signedName.trim().replace(/\s+/g, " ");
}

export function canConfirmSafetyBrief(acknowledged: boolean, signedName: string): boolean {
  return acknowledged && normalizeSafetySignedName(signedName).length > 0;
}

export function buildSafetyAckInsert(params: WriteSafetyAckParams): Record<string, unknown> {
  const signedName = normalizeSafetySignedName(params.signedName);
  if (!signedName) {
    throw new Error("Typed safety signature name is required.");
  }
  return {
    org_id: params.orgId,
    worker_id: params.workerId,
    project_id: params.projectId,
    safety_version: params.safetyVersion,
    signed_name: signedName,
  };
}

/**
 * Insert a single safety_acknowledgements row. Returns the new id on
 * success.
 *
 * The caller MUST treat a non-ok result as a hard failure and refuse
 * to start the shift: the safety brief is the audit gate, and a shift
 * that opens without a corresponding ack row in the database leaves
 * the org with no defensible record that the worker saw the rules.
 * Errors are returned (never thrown) so the caller can decide how to
 * surface the message — but it must not silently fall through to
 * clockIn the way the original best-effort wiring did.
 */
export async function writeSafetyAck(
  supabase: SupabaseClient,
  params: WriteSafetyAckParams,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  let insertPayload: Record<string, unknown>;
  try {
    insertPayload = buildSafetyAckInsert(params);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Typed safety signature name is required.",
    };
  }
  const { data, error } = await supabase
    .from("safety_acknowledgements")
    .insert(insertPayload)
    .select("id")
    .single<{ id: string }>();
  if (error || !data) {
    return { ok: false, error: error?.message ?? "Insert returned no row." };
  }
  return { ok: true, id: data.id };
}
