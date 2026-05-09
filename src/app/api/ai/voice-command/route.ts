import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getManagerWorkspaceData } from "@/lib/manager-data";
import { resolveAiApiContext } from "@/lib/ai/api-auth";
import { buildAssistantSnapshot, interpretVoiceCommand } from "@/lib/ai/service";
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
    const transcript = typeof body.transcript === "string" ? body.transcript.trim() : "";

    if (!transcript) {
      return NextResponse.json({ error: "Transcript is required." }, { status: 400 });
    }

    const managerData =
      auth.kind === "preview" ? auth.managerData : await getManagerWorkspaceData();
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

    const snapshot = buildAssistantSnapshot(managerData, reports);
    const command = await interpretVoiceCommand(transcript, snapshot);

    return NextResponse.json({
      ok: true,
      command,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
