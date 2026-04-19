import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getManagerWorkspaceData, requireManagerContext } from "@/lib/manager-data";
import { answerManagerAssistant, buildAssistantSnapshot } from "@/lib/ai/service";
import type { DailyReport } from "@/types/database";

function assertNoError(error: { message: string } | null, label: string) {
  if (error) {
    throw new Error(`${label}: ${error.message}`);
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    await requireManagerContext(supabase);
    const body = (await request.json()) as Record<string, unknown>;
    const question = typeof body.question === "string" ? body.question.trim() : "";

    if (!question) {
      return NextResponse.json({ error: "Question is required." }, { status: 400 });
    }

    const [managerData, reportsResult] = await Promise.all([
      getManagerWorkspaceData(),
      supabase
        .from("daily_reports")
        .select("*")
        .order("report_date", { ascending: false })
        .range(0, 11)
        .returns<DailyReport[]>(),
    ]);

    assertNoError(reportsResult.error, "Daily reports query failed");

    const snapshot = buildAssistantSnapshot(managerData, reportsResult.data ?? []);
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
