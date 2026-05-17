import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getManagerWorkspaceData } from "@/lib/manager-data";
import { resolveAiApiContext } from "@/lib/ai/api-auth";
import {
  answerManagerAssistant,
  buildAssistantSnapshot,
  buildJarvisWakeResponse,
} from "@/lib/ai/service";
import {
  getGoogleTtsCredentialDiagnostics,
  hasGoogleTtsCredentials,
  synthesizeJarvisSpeech,
} from "@/lib/ai/google-tts";
import {
  appendJarvisMemoryRule,
  detectJarvisMemoryInstruction,
  isJarvisMemoryWriter,
  normalizeJarvisAttachments,
} from "@/lib/ai/jarvis-memory";
import type { AssistantConversationTurn } from "@/lib/ai/types";
import type { DailyReport } from "@/types/database";

export const runtime = "nodejs";

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

function buildSpokenText(assistant: {
  answer: string;
  bullets?: string[];
}): string {
  return assistant.answer.replace(/\s+/g, " ").trim().slice(0, 320);
}

function normalizeLocale(value: unknown): "en" | "ru" | null {
  return value === "en" || value === "ru" ? value : null;
}

function cleanErrorMessage(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\bundefined\b/gi, "").replace(/\s+/g, " ").replace(/^[\s:.-]+|[\s:.-]+$/g, "").trim();
}

function describeErrorRecord(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const record = value as Record<string, unknown>;
  return [
    typeof record.code === "string" || typeof record.code === "number" ? `code ${record.code}` : "",
    typeof record.status === "string" || typeof record.status === "number" ? `status ${record.status}` : "",
    cleanErrorMessage(record.details),
  ].filter(Boolean).join(", ");
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const message = cleanErrorMessage(error.message);
    if (message) return message;

    const details = describeErrorRecord(error);
    return details ? `${fallback} (${details})` : fallback;
  }

  const message = cleanErrorMessage(error);
  if (message) return message;
  const details = describeErrorRecord(error);
  return details ? `${fallback} (${details})` : fallback;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const auth = await resolveAiApiContext(supabase);
    if (auth.kind === "unauthenticated") {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const body = (await request.json()) as Record<string, unknown>;
    const question =
      typeof body.question === "string"
        ? body.question.trim()
        : typeof body.transcript === "string"
          ? body.transcript.trim()
          : "";
    const attachments = normalizeJarvisAttachments(body.attachments);
    const history = normalizeConversationHistory(body.history);
    const locale = normalizeLocale(body.locale);

    if (!question) {
      return NextResponse.json({ error: "Question is required." }, { status: 400 });
    }

    const wakeResponse = buildJarvisWakeResponse(question);
    if (wakeResponse) {
      if (!hasGoogleTtsCredentials()) {
        return NextResponse.json({
          ok: true,
          assistant: {
            ...wakeResponse,
            memorySaved: null,
          },
          audio: null,
          audioError: "Google Cloud Text-to-Speech credentials are not configured.",
        });
      }

      let audio = null;
      let audioError: string | null = null;
      try {
        audio = await synthesizeJarvisSpeech(buildSpokenText(wakeResponse), { locale });
      } catch (ttsError) {
        audioError = getErrorMessage(ttsError, "Google Cloud Text-to-Speech request failed.");
        if (process.env.NODE_ENV !== "production") {
          console.warn("[Jarvis voice] TTS failed", {
            audioError,
            credentials: getGoogleTtsCredentialDiagnostics(),
          });
        }
      }

      return NextResponse.json({
        ok: true,
        assistant: {
          ...wakeResponse,
          memorySaved: null,
        },
        audio,
        audioError,
      });
    }

    let managerData =
      auth.kind === "preview" ? auth.managerData : await getManagerWorkspaceData();
    const memoryInstruction = detectJarvisMemoryInstruction(question);
    let memorySaved = null;
    if (memoryInstruction) {
      if (auth.kind !== "authenticated" || !isJarvisMemoryWriter(auth.context.profile)) {
        return NextResponse.json(
          { error: "Only owner/admin can teach Gemini persistent rules." },
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
      assertNoError(settingsError, "Gemini memory update failed");

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
    const assistant = memorySaved
      ? {
          answer: /[а-яё]/i.test(question)
            ? "Принял. Правило сохранено."
            : "Rule stored.",
          bullets: [memorySaved.text],
          links: [],
          confidence: 0.94,
          source: "fallback" as const,
          memorySaved,
        }
      : {
          ...(await answerManagerAssistant(question, snapshot, { attachments, history })),
          memorySaved,
        };

    if (!hasGoogleTtsCredentials()) {
      return NextResponse.json({
        ok: true,
        assistant,
        audio: null,
        audioError: "Google Cloud Text-to-Speech credentials are not configured.",
      });
    }

    let audio = null;
    let audioError: string | null = null;
    try {
      audio = await synthesizeJarvisSpeech(buildSpokenText(assistant), { locale });
    } catch (ttsError) {
      audioError = getErrorMessage(ttsError, "Google Cloud Text-to-Speech request failed.");
      if (process.env.NODE_ENV !== "production") {
        console.warn("[Jarvis voice] TTS failed", {
          audioError,
          credentials: getGoogleTtsCredentialDiagnostics(),
        });
      }
    }

    return NextResponse.json({
      ok: true,
      assistant,
      audio,
      audioError,
    });
  } catch (error) {
    const message = getErrorMessage(error, "Internal server error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
