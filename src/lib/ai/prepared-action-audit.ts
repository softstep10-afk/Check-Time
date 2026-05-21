import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { logAuditServer } from "@/lib/audit-server";
import type { AssistantAction } from "@/lib/ai/types";
import type { Profile } from "@/types/database";

export const JARVIS_ACTION_PREPARED_AUDIT_ACTION = "jarvis_action_prepared";

function isPreparedWriteAction(action: AssistantAction): boolean {
  return action.kind !== "navigate";
}

function sanitizePreparedAction(action: AssistantAction): Record<string, unknown> {
  if (action.kind === "create_project") {
    return {
      kind: action.kind,
      label: action.label,
      payload: {
        name: action.payload.name,
        address: action.payload.address ?? null,
        notes: action.payload.notes ?? null,
        startDate: action.payload.startDate ?? null,
        endDate: action.payload.endDate ?? null,
      },
    };
  }

  if (action.kind === "create_task") {
    return {
      kind: action.kind,
      label: action.label,
      payload: {
        title: action.payload.title,
        description: action.payload.description ?? null,
        projectId: action.payload.projectId ?? null,
        projectName: action.payload.projectName ?? null,
        assignedTo: action.payload.assignedTo ?? null,
        assignedToName: action.payload.assignedToName ?? null,
      },
    };
  }

  return {
    kind: action.kind,
    label: action.label,
  };
}

export async function logJarvisPreparedActions(
  supabase: SupabaseClient,
  {
    profile,
    actions,
    route,
    question,
  }: {
    profile: Profile;
    actions?: AssistantAction[];
    route: string;
    question: string;
  },
) {
  const preparedActions = (actions ?? []).filter(isPreparedWriteAction);
  if (!preparedActions.length) return;

  await logAuditServer(supabase, {
    orgId: profile.org_id,
    actorId: profile.id,
    actorName: profile.name,
    actorRole: profile.role,
    action: JARVIS_ACTION_PREPARED_AUDIT_ACTION,
    targetType: "jarvis_action",
    targetId: preparedActions[0].kind,
    afterData: {
      route,
      question: question.slice(0, 500),
      actionCount: preparedActions.length,
      actions: preparedActions.map(sanitizePreparedAction),
    },
  });
}
