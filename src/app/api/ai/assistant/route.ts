import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getManagerWorkspaceData } from "@/lib/manager-data";
import { resolveAiApiContext } from "@/lib/ai/api-auth";
import { answerManagerAssistant, buildAssistantSnapshot } from "@/lib/ai/service";
import { hasFinanceAccess } from "@/lib/finance-access";
import type { DailyReport } from "@/types/database";

function assertNoError(error: { message: string } | null, label: string) {
  if (error) {
    throw new Error(`${label}: ${error.message}`);
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const auth = await resolveAiApiContext(supabase);
    if (auth.kind === "unauthenticated") {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }
    const body = (await request.json()) as Record<string, unknown>;
    const question = typeof body.question === "string" ? body.question.trim() : "";

    if (!question) {
      return NextResponse.json({ error: "Question is required." }, { status: 400 });
    }

    const managerData =
      auth.kind === "preview" ? auth.managerData : await getManagerWorkspaceData();
    const managerHasFinanceAccess =
      auth.kind === "preview"
        ? true
        : await hasFinanceAccess(supabase, {
            id: auth.context.profile.id,
            role: auth.context.profile.role,
          });
    let reports: DailyReport[];
    if (auth.kind === "preview") {
      reports = auth.reports;
    } else {
      const reportsResult = await supabase
        .from("daily_reports")
        .select("*")
        .order("report_date", { ascending: false })
        .range(0, 11)
        .returns<DailyReport[]>();
      assertNoError(reportsResult.error, "Daily reports query failed");
      reports = reportsResult.data ?? [];
    }

    const snapshot = buildAssistantSnapshot(managerData, reports, {
      includeFinancials: managerHasFinanceAccess,
    });
    const assistant = await answerManagerAssistant(question, snapshot);

    return NextResponse.json({
      ok: true,
      assistant,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
