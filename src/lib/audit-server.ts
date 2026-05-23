import type { SupabaseClient } from "@supabase/supabase-js";
import { safeErrorForLog } from "@/lib/safe-log";

export async function logAuditServer(
  supabase: SupabaseClient,
  {
    orgId,
    actorId,
    actorName,
    actorRole,
    action,
    targetType,
    targetId,
    beforeData,
    afterData,
  }: {
    orgId: string;
    actorId: string | null;
    actorName: string;
    actorRole: string;
    action: string;
    targetType?: string;
    targetId?: string;
    beforeData?: Record<string, unknown> | null;
    afterData?: Record<string, unknown> | null;
  },
) {
  try {
    const { error } = await supabase.from("audit_log").insert({
      org_id: orgId,
      actor_id: actorId,
      actor_name: actorName,
      actor_role: actorRole,
      action,
      target_type: targetType ?? null,
      target_id: targetId ?? null,
      before_data: beforeData ?? null,
      after_data: afterData ?? null,
    });
    if (error) console.warn("[Audit] server insert failed:", safeErrorForLog(error));
  } catch (error) {
    console.warn("[Audit] server insert threw:", safeErrorForLog(error));
  }
}
