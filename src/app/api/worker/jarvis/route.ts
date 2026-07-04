import { NextRequest, NextResponse } from "next/server";
import { answerWorkerAssistant } from "@/lib/ai/service";
import {
  createPaidApiLimitGuard,
  isPaidApiLimitError,
  paidApiLimitResponse,
} from "@/lib/paid-api-limits";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getWorkerShellData } from "@/lib/worker-data";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const body = (await request.json()) as Record<string, unknown>;
    const question = typeof body.question === "string" ? body.question.trim() : "";

    if (!question) {
      return NextResponse.json({ error: "Question is required." }, { status: 400 });
    }

    const shell = await getWorkerShellData();
    const assistant = await answerWorkerAssistant(question, shell, {
      beforeProviderCall: createPaidApiLimitGuard({
        adminClient: createAdminClient(),
        orgId: shell.profile.org_id,
        profileId: shell.profile.id,
        route: "/api/worker/jarvis",
      }),
    });

    return NextResponse.json({ ok: true, assistant });
  } catch (error) {
    if (isPaidApiLimitError(error)) {
      return paidApiLimitResponse(error.result);
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
