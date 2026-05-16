import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getManagerWorkspaceData } from "@/lib/manager-data";
import { resolveAiApiContext } from "@/lib/ai/api-auth";
import { answerManagerAssistant, buildAssistantSnapshot } from "@/lib/ai/service";
import {
  appendJarvisMemoryRule,
  detectJarvisMemoryInstruction,
  isJarvisMemoryWriter,
  normalizeJarvisAttachments,
} from "@/lib/ai/jarvis-memory";
import type { DailyReport } from "@/types/database";
import type { AssistantConversationTurn } from "@/lib/ai/types";

function assertNoError(error: { message: string } | null, label: string) {
  if (error) {
    throw new Error(`${label}: ${error.message}`);
  }
}

function normalizeConversationHistory(value: unknown): AssistantConversationTurn[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const record = item as Record<string, unknown>;
      const role = record.role === "assistant" ? "assistant" : record.role === "user" ? "user" : null;
      const text = typeof record.text === "string" ? record.text.trim() : "";
      if (!role || !text) return null;
      return { role, text: text.slice(0, 1200) };
    })
    .filter((item): item is AssistantConversationTurn => Boolean(item))
    .slice(-10);
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
    const attachments = normalizeJarvisAttachments(body.attachments);
    const history = normalizeConversationHistory(body.history);

    if (!question) {
      return NextResponse.json({ error: "Question is required." }, { status: 400 });
    }

    let managerData =
      auth.kind === "preview" ? auth.managerData : await getManagerWorkspaceData();
    const memoryInstruction = detectJarvisMemoryInstruction(question);
    let memorySaved = null;
    if (memoryInstruction) {
      if (auth.kind !== "authenticated" || !isJarvisMemoryWriter(auth.context.profile)) {
        return NextResponse.json(
          { error: "Only owner/admin can teach Jarvis persistent rules." },
          { status: 403 },
        );
      }

      const updated = appendJarvisMemoryRule({
        org: managerData.org,
        text: memoryInstruction,
        createdBy: auth.context.profile.id,
        source: "chat",
      });
      const { error: settingsError } = await supabase
        .from("organizations")
        .update({ settings: updated.settings })
        .eq("id", managerData.org.id);
      assertNoError(settingsError, "Jarvis memory update failed");

      memorySaved = updated.rule;
      managerData = {
        ...managerData,
        org: {
          ...managerData.org,
          settings: updated.settings,
        },
      };
    }
    const ownerJarvisAccess =
      auth.kind === "preview"
        ? true
        : auth.context.profile.role === "owner" || auth.context.profile.role === "admin";
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
      includeFinancials: ownerJarvisAccess,
    });
    if (memorySaved) {
      const ru = /[а-яё]/i.test(question);
      return NextResponse.json({
        ok: true,
        assistant: {
          answer: ru
            ? "Запомнил. Буду учитывать это правило в следующих ответах Jarvis."
            : "Remembered. Jarvis will apply this rule in future answers.",
          bullets: [memorySaved.text],
          links: [],
          confidence: 0.94,
          source: "fallback",
          memorySaved,
        },
      });
    }
    const assistant = await answerManagerAssistant(question, snapshot, { attachments, history });

    return NextResponse.json({
      ok: true,
      assistant: {
        ...assistant,
        memorySaved,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
