import { NextResponse } from "next/server";
import { resolveAiApiContext } from "@/lib/ai/api-auth";
import { buildAssistantSnapshot } from "@/lib/ai/service";
import { hasFinanceAccess } from "@/lib/finance-access";
import { getManagerWorkspaceData } from "@/lib/manager-data";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_REALTIME_MODEL, DEFAULT_REALTIME_VOICE, JARVIS_VOICE_PROFILE } from "@/lib/ai/jarvis-voice";
import type { DailyReport } from "@/types/database";

async function hashSafetyIdentifier(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function formatRealtimeWorkspaceContext(snapshot: ReturnType<typeof buildAssistantSnapshot>): string {
  const financialLine = snapshot.hasFinanceAccess
    ? `Unpaid payroll visible: ${snapshot.unpaidHours.toFixed(2)}h, $${snapshot.unpaidAmount.toFixed(2)}.`
    : "Financial visibility is hidden. Do not discuss payroll, rates, receipt totals, costs, profit, or unpaid amounts.";

  return [
    `Workspace: ${snapshot.orgName}.`,
    `Current status: ${snapshot.onSiteCount} on site, ${snapshot.activeProjectCount} active projects, ${snapshot.openTaskCount} open tasks.`,
    financialLine,
    `Projects: ${snapshot.projects
      .slice(0, 18)
      .map((project) => {
        const materials = project.materialSpec
          .slice(0, 8)
          .map((item) => `${item.name} ${item.quantity} ${item.unit}`.trim())
          .join("; ") || "none";
        const estimates = snapshot.hasFinanceAccess
          ? project.estimates
              .slice(0, 6)
              .map((estimate) => `${estimate.title} client $${estimate.clientPrice} margin $${estimate.margin}`)
              .join("; ") || "none"
          : "hidden";
        return `${project.name} (${project.status}, ${project.openTaskCount} open tasks, dates ${project.startDate ?? "none"} to ${project.endDate ?? "none"}, materials ${materials}, estimates ${estimates})`;
      })
      .join(" | ") || "none"}.`,
    `People: ${snapshot.workerMetrics
      .slice(0, 18)
      .map((worker) => `${worker.name} (${worker.role}, skills ${worker.skills.join(", ") || "none"}, note ${worker.capabilitiesNote ?? "none"})`)
      .join(" | ") || "none"}.`,
    `Live workers: ${snapshot.liveWorkers
      .map((worker) => `${worker.name} on ${worker.projectName ?? "unknown project"}`)
      .join(" | ") || "none"}.`,
    `Open tasks: ${snapshot.openTasks
      .slice(0, 20)
      .map((task) => `${task.title} on ${task.projectName}, priority ${task.priority}, assigned ${task.assignedToName ?? "unassigned"}`)
      .join(" | ") || "none"}.`,
    `Owner memory rules: ${snapshot.memoryRules
      .slice(0, 12)
      .map((rule) => rule.text)
      .join(" | ") || "none"}.`,
  ]
    .join("\n")
    .slice(0, 12_000);
}

export async function POST() {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Realtime voice is not connected yet. Add OPENAI_API_KEY in Vercel." },
        { status: 503 },
      );
    }

    const supabase = await createClient();
    const auth = await resolveAiApiContext(supabase);
    if (auth.kind === "unauthenticated") {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const managerData = auth.kind === "preview" ? auth.managerData : await getManagerWorkspaceData();
    const managerHasFinanceAccess =
      auth.kind === "preview"
        ? true
        : await hasFinanceAccess(supabase, {
            id: auth.context.profile.id,
            role: auth.context.profile.role,
          });
    let reports: DailyReport[] = [];
    if (auth.kind === "preview") {
      reports = auth.reports;
    } else {
      const reportsResult = await supabase
        .from("daily_reports")
        .select("*")
        .order("report_date", { ascending: false })
        .range(0, 5)
        .returns<DailyReport[]>();
      reports = reportsResult.data ?? [];
    }
    const snapshot = buildAssistantSnapshot(managerData, reports, {
      includeFinancials: managerHasFinanceAccess,
    });
    const workspaceContext = formatRealtimeWorkspaceContext(snapshot);
    const model = process.env.OPENAI_REALTIME_MODEL || DEFAULT_REALTIME_MODEL;
    const voice = process.env.OPENAI_REALTIME_VOICE || DEFAULT_REALTIME_VOICE;
    const safetySource =
      auth.kind === "authenticated"
        ? `${auth.context.org.id}:${auth.context.profile.id}`
        : "preview:jarvis";
    const safetyIdentifier = await hashSafetyIdentifier(safetySource);

    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "OpenAI-Safety-Identifier": safetyIdentifier,
      },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model,
          audio: {
            input: {
              noise_reduction: { type: "near_field" },
              turn_detection: {
                type: "semantic_vad",
                eagerness: "medium",
                create_response: true,
                interrupt_response: true,
              },
            },
            output: { voice },
          },
          instructions: [
            "You are Jarvis inside the Check-Time construction management app.",
            JARVIS_VOICE_PROFILE,
            "Start and continue in Russian unless the owner asks for another language. Be concise and act like an owner-side operating assistant.",
            "Use only the workspace context below for app facts. If a fact is missing, say it is not recorded in the current snapshot.",
            "When uncertain, ask for the exact project, worker, date range, or photo.",
            "Workspace context:",
            workspaceContext,
          ].join(" "),
          tracing: "auto",
        },
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      const details = await response.text();
      let detailMessage = details.slice(0, 800);
      try {
        const parsed = JSON.parse(details) as { error?: { message?: string } };
        detailMessage = parsed.error?.message ?? detailMessage;
      } catch {
        // Keep raw text when OpenAI does not return JSON.
      }
      return NextResponse.json(
        { error: `OpenAI realtime token request failed: ${detailMessage}`, details: detailMessage },
        { status: response.status },
      );
    }

    const realtime = (await response.json()) as unknown;
    return NextResponse.json({ ok: true, realtime, model, voice });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
