import { createClient } from "@/lib/supabase/client";
import { AUTH_BYPASS_ENABLED } from "@/lib/auth-bypass";
import { redactSensitive, safeErrorForLog } from "@/lib/safe-log";

export type AuditLogResult =
  | { ok: true }
  | { ok: false; errorMessage: string };

export async function logAudit({
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
  actorId: string;
  actorName: string;
  actorRole: string;
  action: string;
  targetType?: string;
  targetId?: string;
  beforeData?: Record<string, unknown> | null;
  afterData?: Record<string, unknown> | null;
}): Promise<AuditLogResult> {
  if (AUTH_BYPASS_ENABLED) {
    console.log("[Audit]", action, targetType, targetId, redactSensitive({ beforeData, afterData }));
    return { ok: true };
  }

  // Best-effort: never throw out of logAudit. Callers use it inside
  // flows that already committed the primary action (payroll close,
  // force checkout, …) and a failing audit row must not crash those.
  try {
    const supabase = createClient();
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
    if (error) {
      console.warn("[Audit] insert failed:", safeErrorForLog(error));
      return { ok: false, errorMessage: error.message };
    }
    return { ok: true };
  } catch (err) {
    console.warn("[Audit] insert threw:", safeErrorForLog(err));
    return {
      ok: false,
      errorMessage: err instanceof Error ? err.message : "Audit insert failed.",
    };
  }
}
