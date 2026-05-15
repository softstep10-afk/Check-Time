import { NextRequest, NextResponse } from "next/server";
import { answerWorkerAssistant } from "@/lib/ai/service";
import { getWorkerShellData } from "@/lib/worker-data";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const question = typeof body.question === "string" ? body.question.trim() : "";

    if (!question) {
      return NextResponse.json({ error: "Question is required." }, { status: 400 });
    }

    const shell = await getWorkerShellData();
    const assistant = await answerWorkerAssistant(question, shell);

    return NextResponse.json({ ok: true, assistant });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
