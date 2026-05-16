import { NextRequest, NextResponse } from "next/server";
import { resolveAiApiContext } from "@/lib/ai/api-auth";
import { buildAssistantSnapshot } from "@/lib/ai/service";
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
    ? `Owner financials visible: unpaid ${snapshot.unpaidHours.toFixed(2)}h, $${snapshot.unpaidAmount.toFixed(2)}. Material receipts total $${snapshot.receiptTotal.toFixed(2)}, today $${snapshot.receiptToday.toFixed(2)}, receipts ${snapshot.receiptCount}.`
    : "Financial visibility is hidden. Do not discuss payroll, rates, receipt totals, costs, profit, or unpaid amounts.";

  return [
    `Workspace: ${snapshot.orgName}.`,
    `Current status: ${snapshot.onSiteCount} on site, ${snapshot.activeProjectCount} active projects, ${snapshot.openTaskCount} open tasks, ${snapshot.crewCount} crew profiles, ${snapshot.todayHours.toFixed(2)}h today.`,
    financialLine,
    `Projects: ${snapshot.projects
      .slice(0, 18)
      .map((project) => {
        const materials = project.materialSpec
          .slice(0, 8)
          .map((item) => `${item.name} ${item.quantity} ${item.unit}`.trim())
          .join("; ") || "none";
        const documents = snapshot.hasFinanceAccess
          ? project.estimates
              .slice(0, 6)
              .map((estimate) => `${estimate.documentType} ${estimate.title} ${estimate.status}, files ${estimate.attachmentNames.join(", ") || "none"}`)
              .join("; ") || "none"
          : "hidden";
        const receipts = snapshot.hasFinanceAccess
          ? `receipts $${project.receiptTotal.toFixed(2)}, today $${project.receiptToday.toFixed(2)}, count ${project.receiptCount}`
          : "receipts hidden";
        return `${project.name} (${project.status}, ${project.openTaskCount} open tasks, dates ${project.startDate ?? "none"} to ${project.endDate ?? "none"}, ${receipts}, materials ${materials}, documents ${documents})`;
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
    `Recent shifts: ${snapshot.recentShifts
      .slice(0, 30)
      .map((shift) => `${shift.workerName} on ${shift.projectName}, ${shift.clockInTime} to ${shift.clockOutTime ?? "open"}, ${shift.durationMinutes} minutes, checkout ${shift.checkoutStatus}`)
      .join(" | ") || "none"}.`,
    `Owner memory rules: ${snapshot.memoryRules
      .slice(0, 12)
      .map((rule) => rule.text)
      .join(" | ") || "none"}.`,
  ]
    .join("\n")
    .slice(0, 12_000);
}

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Live voice needs OPENAI_API_KEY in Vercel." },
        { status: 503 },
      );
    }

    const offerSdp = await request.text();
    if (!offerSdp.trim()) {
      return NextResponse.json({ error: "Missing browser SDP offer." }, { status: 400 });
    }

    const supabase = await createClient();
    const auth = await resolveAiApiContext(supabase);
    if (auth.kind === "unauthenticated") {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const managerData = auth.kind === "preview" ? auth.managerData : await getManagerWorkspaceData();
    const ownerJarvisAccess =
      auth.kind === "preview"
        ? true
        : auth.context.profile.role === "owner" || auth.context.profile.role === "admin";
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
      includeFinancials: ownerJarvisAccess,
    });
    const safetySource =
      auth.kind === "authenticated"
        ? `${auth.context.org.id}:${auth.context.profile.id}`
        : "preview:jarvis";
    const safetyIdentifier = await hashSafetyIdentifier(safetySource);
    const session = {
      type: "realtime",
      model: process.env.OPENAI_REALTIME_MODEL || DEFAULT_REALTIME_MODEL,
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
        output: { voice: process.env.OPENAI_REALTIME_VOICE || DEFAULT_REALTIME_VOICE },
      },
      instructions: [
        "You are Jarvis inside the Check-Time construction management app.",
        JARVIS_VOICE_PROFILE,
        "Start and continue in Russian unless the owner asks for another language. Be concise and act like an owner-side operating assistant.",
        "Use only the workspace context below for app facts. If a fact is missing, say it is not recorded in the current snapshot.",
        "When uncertain, ask for the exact project, worker, date range, or photo.",
        "Workspace context:",
        formatRealtimeWorkspaceContext(snapshot),
      ].join(" "),
      tracing: "auto",
    };

    const form = new FormData();
    form.set("sdp", offerSdp);
    form.set("session", JSON.stringify(session));

    const response = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "OpenAI-Safety-Identifier": safetyIdentifier,
      },
      body: form,
      cache: "no-store",
    });
    const responseText = await response.text();

    if (!response.ok) {
      let detailMessage = responseText.slice(0, 800);
      try {
        const parsed = JSON.parse(responseText) as { error?: { message?: string; code?: string } };
        detailMessage = parsed.error?.message ?? parsed.error?.code ?? detailMessage;
      } catch {
        // OpenAI sometimes returns plain text for SDP/call errors.
      }
      return NextResponse.json(
        { error: `OpenAI realtime connection failed: ${detailMessage}` },
        { status: response.status },
      );
    }

    return new NextResponse(responseText, {
      status: 200,
      headers: { "Content-Type": "application/sdp" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
