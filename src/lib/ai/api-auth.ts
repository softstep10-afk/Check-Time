import "server-only";

import { AUTH_BYPASS_ENABLED } from "@/lib/auth-bypass";
import { getManagerWorkspaceData, requireManagerContext } from "@/lib/manager-data";
import { buildPreviewDailyReports } from "@/lib/preview-data";
import type { DailyReport } from "@/types/database";
import type { ManagerWorkspaceData } from "@/lib/manager-types";

type ServerSupabase = Parameters<typeof requireManagerContext>[0];

export type AiApiContext =
  | { kind: "unauthenticated" }
  | {
      kind: "preview";
      managerData: ManagerWorkspaceData;
      reports: DailyReport[];
    }
  | {
      kind: "authenticated";
      context: Awaited<ReturnType<typeof requireManagerContext>>;
    };

export async function resolveAiApiContext(
  supabase: ServerSupabase,
): Promise<AiApiContext> {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    if (!AUTH_BYPASS_ENABLED) {
      return { kind: "unauthenticated" };
    }
    return {
      kind: "preview",
      managerData: await getManagerWorkspaceData(),
      reports: buildPreviewDailyReports(),
    };
  }

  return {
    kind: "authenticated",
    context: await requireManagerContext(supabase),
  };
}
