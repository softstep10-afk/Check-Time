import type { DailyReport } from "@/types/database";
import type { ManagerWorkspaceData } from "@/lib/manager-types";
import {
  buildManagerSessions,
  buildProfileSummaries,
  buildProjectSummaries,
  getOverviewStats,
} from "@/lib/manager-utils";
import {
  type AssistantResult,
  type AssistantSnapshot,
  type DailyReportInput,
  type GeneratedDailyReport,
  type PhotoAnalysisInput,
  type PhotoAnalysisResult,
  type VoiceCommandResult,
} from "@/lib/ai/types";

export const ORG_TIME_ZONE = "America/Los_Angeles";

const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: ORG_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function roundNumber(value: number): number {
  return Math.round(value * 100) / 100;
}

function toLowerList(values: string[]): string[] {
  return values
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => value.toLowerCase());
}

function uniqueList(values: string[], limit = 5): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    const key = trimmed.toLowerCase();

    if (!trimmed || seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(trimmed);

    if (output.length >= limit) {
      break;
    }
  }

  return output;
}

function keywordMatches(text: string, keywords: string[]): string[] {
  const normalized = text.toLowerCase();

  return uniqueList(
    keywords.filter((keyword) => normalized.includes(keyword)).map((keyword) => keyword),
  );
}

function buildHeadline(input: DailyReportInput): string {
  const subject = input.projectName === "All Projects" ? "Org Summary" : input.projectName;
  return `${subject} - ${input.reportDate}`;
}

function buildDailyReportFallback(input: DailyReportInput): GeneratedDailyReport {
  const workersCount = input.workerNames.length;
  const hoursWorked = roundNumber(input.hoursWorked);
  const completedCount = input.completedTasks.length;
  const openCount = input.openTasks.length;
  const photosTaken = input.photosTaken;
  const highlights = uniqueList(
    [
      workersCount > 0
        ? `${workersCount} crew member${workersCount === 1 ? "" : "s"} logged time in the selected window.`
        : "No clocked labor was recorded in the selected window.",
      hoursWorked > 0
        ? `${hoursWorked.toFixed(2)} hours were captured across the ledger.`
        : "No paid hours landed in the selected window.",
      completedCount > 0
        ? `${completedCount} task${completedCount === 1 ? "" : "s"} moved to done.`
        : "No tasks were marked done in the selected window.",
      photosTaken > 0
        ? `${photosTaken} photo or video upload${photosTaken === 1 ? "" : "s"} documented field progress.`
        : "No media uploads were attached to this window.",
      input.mediaCaptions[0] ? `Field note: ${input.mediaCaptions[0]}` : "",
    ],
    4,
  );
  const risks = uniqueList(
    [
      openCount > 0
        ? `${openCount} task${openCount === 1 ? "" : "s"} still need follow-through.`
        : "",
      photosTaken === 0 ? "No fresh field evidence was uploaded for review." : "",
      hoursWorked === 0 ? "No crew hours were recorded, so the report window may be incomplete." : "",
    ],
    3,
  );
  const nextActions = uniqueList(
    [
      openCount > 0 ? "Close or reassign the remaining open tasks." : "Keep the task board current before the next shift starts.",
      photosTaken === 0 ? "Ask the field crew for at least one progress photo on the next pass." : "Review the latest uploads against the day plan.",
      workersCount > 0 ? "Compare labor logged against the expected daily production target." : "Confirm whether the site was intentionally idle.",
    ],
    3,
  );

  return {
    headline: buildHeadline(input),
    summary:
      `${input.projectName} logged ${hoursWorked.toFixed(2)} hours with ` +
      `${completedCount} completed task${completedCount === 1 ? "" : "s"} and ` +
      `${photosTaken} media upload${photosTaken === 1 ? "" : "s"} in the selected window.` +
      (openCount > 0 ? ` ${openCount} task${openCount === 1 ? "" : "s"} remain open.` : ""),
    highlights,
    risks,
    nextActions,
    laborSignal:
      hoursWorked > 0
        ? `${hoursWorked.toFixed(2)} labor hours recorded`
        : "No labor signal detected",
    deliverySignal:
      completedCount > 0
        ? `${completedCount} task${completedCount === 1 ? "" : "s"} completed`
        : "Delivery progress is mostly qualitative right now",
    confidence: hoursWorked > 0 || photosTaken > 0 ? 0.62 : 0.38,
    source: "fallback",
  };
}

function buildPhotoAnalysisFallback(input: PhotoAnalysisInput): PhotoAnalysisResult {
  const text = `${input.filename} ${input.caption}`.trim();
  const progressTags = keywordMatches(text, [
    "framing",
    "concrete",
    "pour",
    "excavat",
    "roof",
    "wiring",
    "electrical",
    "inspection",
    "paint",
    "drywall",
    "finish",
    "demo",
    "plumbing",
  ]);
  const safetyFlags = keywordMatches(text, [
    "hazard",
    "unsafe",
    "trip",
    "fall",
    "spill",
    "exposed",
    "crack",
    "broken",
    "warning",
    "blocked",
    "debris",
  ]).map((item) => `Mentioned or implied risk term: ${item}`);
  const qualityFlags = keywordMatches(text, [
    "misalign",
    "rework",
    "gap",
    "leak",
    "crack",
    "uneven",
    "damaged",
    "missing",
  ]).map((item) => `Possible quality concern from metadata: ${item}`);
  const followUps = uniqueList(
    [
      input.caption
        ? "Compare the upload note against the active task list for this project."
        : "Ask the crew for a caption so the media can be tied to a concrete work step.",
      input.isCheckout
        ? "Confirm the checkout media lines up with the end-of-shift proof requirement."
        : "Verify whether this upload should be attached to a daily report.",
      safetyFlags.length > 0
        ? "Escalate the noted risk terms for manager review."
        : "No explicit safety issue surfaced in the filename or caption.",
    ],
    3,
  );
  const tags = uniqueList([...progressTags, ...toLowerList(input.relatedTasks)]);

  return {
    summary: input.caption
      ? `Metadata suggests this ${input.mediaType} documents ${input.projectName} work tied to: ${input.caption}.`
      : `This ${input.mediaType} from ${input.projectName} has limited metadata, so the analysis is based on filename and surrounding task context.`,
    progressObservation:
      progressTags.length > 0
        ? `Likely work phase signaled by metadata: ${progressTags.join(", ")}.`
        : "No specific work phase was clearly signaled by the available metadata.",
    safetyFlags,
    qualityFlags,
    followUps,
    tags,
    confidence: input.caption ? 0.58 : 0.34,
    source: "fallback",
  };
}

function findProjectRoute(
  text: string,
  snapshot: AssistantSnapshot,
): { label: string; href: string } | null {
  const normalized = text.toLowerCase();

  for (const project of snapshot.projects) {
    if (normalized.includes(project.name.toLowerCase())) {
      return {
        label: `Open ${project.name}`,
        href: `/projects/${project.id}`,
      };
    }
  }

  return null;
}

function isFinancialQuestion(normalized: string): boolean {
  return [
    "payroll",
    "unpaid",
    "receipt",
    "receipts",
    "expense",
    "expenses",
    "spend",
    "spending",
    "cost",
    "costs",
    "profit",
    "reimbursement",
    "paid",
    "gross",
    "net",
  ].some((keyword) => normalized.includes(keyword));
}

function buildAssistantFallback(
  question: string,
  snapshot: AssistantSnapshot,
): AssistantResult {
  const normalized = question.toLowerCase();
  const liveWorkerNames = snapshot.liveWorkers.map((worker) => worker.name);
  const projectRoute = findProjectRoute(question, snapshot);

  if (!snapshot.hasFinanceAccess && isFinancialQuestion(normalized)) {
    return {
      answer:
        "Financial details are restricted for this account. You can still review operational project status, tasks, media, and crew activity.",
      bullets: [
        `${snapshot.onSiteCount} workers are currently on site.`,
        `${snapshot.openTaskCount} tasks remain open across the org.`,
      ],
      links: [{ label: "Open overview", href: "/overview" }],
      confidence: 0.78,
      source: "fallback",
    };
  }

  if (normalized.includes("who") && normalized.includes("site")) {
    return {
      answer:
        liveWorkerNames.length > 0
          ? `${liveWorkerNames.join(", ")} ${liveWorkerNames.length === 1 ? "is" : "are"} currently clocked in.`
          : "Nobody is currently clocked in.",
      bullets: snapshot.liveWorkers.map((worker) => {
        const duration =
          worker.currentSessionMinutes === null ? "live now" : `${worker.currentSessionMinutes}m on shift`;
        return `${worker.name} • ${worker.projectName ?? "Unresolved project"} • ${duration}`;
      }),
      links: [{ label: "Open overview", href: "/overview" }, { label: "Open team", href: "/team" }],
      confidence: 0.74,
      source: "fallback",
    };
  }

  if (normalized.includes("payroll") || normalized.includes("unpaid")) {
    return {
      answer:
        `There are ${snapshot.unpaidHours.toFixed(2)} unpaid hours worth ` +
        `$${snapshot.unpaidAmount.toFixed(2)} in the current payroll preview.`,
      bullets: [
        `${snapshot.onSiteCount} workers are currently on site.`,
        `${snapshot.openTaskCount} tasks remain open across the org.`,
      ],
      links: [{ label: "Open payroll", href: "/payroll" }],
      confidence: 0.71,
      source: "fallback",
    };
  }

  if (projectRoute) {
    const project = snapshot.projects.find((item) => item.id === projectRoute.href.split("/").pop());
    const recentReport =
      snapshot.recentReports.find((report) => report.projectName.toLowerCase() === project?.name.toLowerCase()) ??
      null;

    return {
      answer:
        `${project?.name ?? "That project"} currently has ` +
        `${project?.onSiteWorkerCount ?? 0} worker${project?.onSiteWorkerCount === 1 ? "" : "s"} on site and ` +
        `${project?.openTaskCount ?? 0} open task${project?.openTaskCount === 1 ? "" : "s"}.`,
      bullets: uniqueList(
        [
          project ? `${project.weekMinutes} minutes logged this week.` : "",
          recentReport?.summary ?? "",
          project?.status ? `Status: ${project.status}.` : "",
        ],
        3,
      ),
      links: [projectRoute, { label: "Open timeline", href: "/timeline" }],
      confidence: 0.7,
      source: "fallback",
    };
  }

  if (normalized.includes("task")) {
    const busiestProject = [...snapshot.projects].sort((left, right) => {
      return right.openTaskCount - left.openTaskCount;
    })[0];

    return {
      answer: `${snapshot.openTaskCount} open tasks are active right now.`,
      bullets: busiestProject
        ? [`${busiestProject.name} carries the heaviest queue with ${busiestProject.openTaskCount} open tasks.`]
        : [],
      links: [{ label: "Open projects", href: "/projects" }, { label: "Open timeline", href: "/timeline" }],
      confidence: 0.68,
      source: "fallback",
    };
  }

  return {
    answer:
      `${snapshot.orgName} has ${snapshot.onSiteCount} workers on site, ` +
      `${snapshot.activeProjectCount} active projects, and ${snapshot.openTaskCount} open tasks right now.`,
    bullets: uniqueList(
      [
        snapshot.hasFinanceAccess
          ? `${snapshot.unpaidHours.toFixed(2)} unpaid hours remain in the payroll preview.`
          : "",
        snapshot.recentReports[0]?.summary ?? "No daily reports have been generated yet.",
      ],
      2,
    ),
    links: [
      { label: "Open overview", href: "/overview" },
      { label: "Open AI workspace", href: "/ai" },
    ],
    confidence: 0.6,
    source: "fallback",
  };
}

function buildVoiceFallback(
  transcript: string,
  snapshot: AssistantSnapshot,
): VoiceCommandResult {
  const normalized = transcript.trim().toLowerCase();
  const projectRoute = findProjectRoute(transcript, snapshot);

  if (!normalized) {
    return {
      transcript,
      normalized,
      intent: "unknown",
      answer: "I need a fuller command before I can route it.",
      actionLabel: null,
      route: null,
      confidence: 0.1,
      source: "fallback",
    };
  }

  if (normalized.includes("payroll")) {
    if (!snapshot.hasFinanceAccess) {
      return {
        transcript,
        normalized,
        intent: "unknown",
        answer: "Financial details are restricted for this account.",
        actionLabel: null,
        route: null,
        confidence: 0.78,
        source: "fallback",
      };
    }

    return {
      transcript,
      normalized,
      intent: "navigate",
      answer: "Opening payroll so you can review unpaid hours and confirm the next run.",
      actionLabel: "Open Payroll",
      route: "/payroll",
      confidence: 0.83,
      source: "fallback",
    };
  }

  if (normalized.includes("timeline")) {
    return {
      transcript,
      normalized,
      intent: "navigate",
      answer: "Opening the event ledger timeline.",
      actionLabel: "Open Timeline",
      route: "/timeline",
      confidence: 0.82,
      source: "fallback",
    };
  }

  if (normalized.includes("team") || normalized.includes("crew")) {
    return {
      transcript,
      normalized,
      intent: "navigate",
      answer: "Opening the team roster.",
      actionLabel: "Open Team",
      route: "/team",
      confidence: 0.78,
      source: "fallback",
    };
  }

  if (normalized.includes("report")) {
    return {
      transcript,
      normalized,
      intent: "report",
      answer: "Opening the AI workspace so you can generate or review daily reports.",
      actionLabel: "Open AI",
      route: "/ai",
      confidence: 0.79,
      source: "fallback",
    };
  }

  if (projectRoute) {
    return {
      transcript,
      normalized,
      intent: "navigate",
      answer: `Opening ${projectRoute.label.replace("Open ", "")}.`,
      actionLabel: projectRoute.label,
      route: projectRoute.href,
      confidence: 0.81,
      source: "fallback",
    };
  }

  const assistant = buildAssistantFallback(transcript, snapshot);

  return {
    transcript,
    normalized,
    intent: "assistant",
    answer: assistant.answer,
    actionLabel: assistant.links[0]?.label ?? null,
    route: assistant.links[0]?.href ?? null,
    confidence: assistant.confidence,
    source: "fallback",
  };
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  try {
    const parsed = JSON.parse(text.slice(firstBrace, lastBrace + 1)) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function tryAnthropicObject(
  system: string,
  prompt: string,
): Promise<Record<string, unknown> | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model = process.env.ANTHROPIC_MODEL;

  if (!apiKey || !model) {
    return null;
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 900,
        temperature: 0.2,
        system,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const text = (payload.content ?? [])
      .filter((item) => item.type === "text" && typeof item.text === "string")
      .map((item) => item.text as string)
      .join("\n");

    return extractJsonObject(text);
  } catch {
    return null;
  }
}

function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return uniqueList(value.filter((item): item is string => typeof item === "string"), 6);
}

function getStringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function getNumberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function getTodayInOrgTimeZone(): string {
  return dateFormatter.format(new Date());
}

export function formatOrgDateKey(value: string | Date): string {
  return dateFormatter.format(new Date(value));
}

export function coercePhotoAnalysis(value: unknown): PhotoAnalysisResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const source = (value as Record<string, unknown>).source;
  const normalizedSource =
    source === "anthropic" || source === "fallback" ? source : "fallback";

  return {
    summary: getStringValue((value as Record<string, unknown>).summary, ""),
    progressObservation: getStringValue(
      (value as Record<string, unknown>).progressObservation,
      "",
    ),
    safetyFlags: getStringArray((value as Record<string, unknown>).safetyFlags),
    qualityFlags: getStringArray((value as Record<string, unknown>).qualityFlags),
    followUps: getStringArray((value as Record<string, unknown>).followUps),
    tags: getStringArray((value as Record<string, unknown>).tags),
    confidence: getNumberValue((value as Record<string, unknown>).confidence, 0.4),
    source: normalizedSource,
  };
}

export function buildAssistantSnapshot(
  data: ManagerWorkspaceData,
  dailyReports: DailyReport[],
  options: { includeFinancials?: boolean } = {},
): AssistantSnapshot {
  const includeFinancials = options.includeFinancials ?? true;
  const sessions = buildManagerSessions(data);
  const projectSummaries = buildProjectSummaries(data, sessions, {
    includeFinancials,
  });
  const profileSummaries = buildProfileSummaries(data, sessions);
  const stats = getOverviewStats(data, sessions, projectSummaries, profileSummaries, {
    includeFinancials,
  });

  return {
    orgName: data.org.name,
    onSiteCount: stats.onSiteCount,
    activeProjectCount: stats.activeProjectCount,
    openTaskCount: stats.openTaskCount,
    hasFinanceAccess: includeFinancials,
    unpaidHours: stats.unpaidHours,
    unpaidAmount: stats.unpaidAmount,
    projects: projectSummaries.map((project) => ({
      id: project.id,
      name: project.name,
      status: project.status,
      onSiteWorkerCount: project.onSiteWorkerCount,
      openTaskCount: project.openTaskCount,
      weekMinutes: project.weekMinutes,
    })),
    liveWorkers: profileSummaries
      .filter((profile) => profile.isOnSite)
      .map((profile) => ({
        id: profile.id,
        name: profile.name,
        role: profile.role,
        projectName: profile.currentProjectName,
        currentSessionMinutes: profile.currentSessionMinutes,
      })),
    recentReports: dailyReports.slice(0, 8).map((report) => ({
      id: report.id,
      projectName:
        data.projects.find((project) => project.id === report.project_id)?.name ?? "All Projects",
      reportDate: report.report_date,
      summary: report.summary,
    })),
  };
}

export async function generateDailyReport(
  input: DailyReportInput,
): Promise<GeneratedDailyReport> {
  const fallback = buildDailyReportFallback(input);
  const anthropicObject = await tryAnthropicObject(
    "You write concise construction daily reports. Return JSON only.",
    [
      "Create a JSON object with keys:",
      "headline, summary, highlights, risks, nextActions, laborSignal, deliverySignal, confidence",
      "Keep arrays under 5 items and every string short.",
      `Project: ${input.projectName}`,
      `Date: ${input.reportDate}`,
      `Workers: ${input.workerNames.join(", ") || "None"}`,
      `Hours worked: ${input.hoursWorked.toFixed(2)}`,
      `Event count: ${input.eventCount}`,
      `Completed tasks: ${input.completedTasks.join(" | ") || "None"}`,
      `Open tasks: ${input.openTasks.join(" | ") || "None"}`,
      `Media captions: ${input.mediaCaptions.join(" | ") || "None"}`,
    ].join("\n"),
  );

  if (!anthropicObject) {
    return fallback;
  }

  return {
    headline: getStringValue(anthropicObject.headline, fallback.headline),
    summary: getStringValue(anthropicObject.summary, fallback.summary),
    highlights: getStringArray(anthropicObject.highlights).length
      ? getStringArray(anthropicObject.highlights)
      : fallback.highlights,
    risks: getStringArray(anthropicObject.risks),
    nextActions: getStringArray(anthropicObject.nextActions).length
      ? getStringArray(anthropicObject.nextActions)
      : fallback.nextActions,
    laborSignal: getStringValue(anthropicObject.laborSignal, fallback.laborSignal),
    deliverySignal: getStringValue(anthropicObject.deliverySignal, fallback.deliverySignal),
    confidence: roundNumber(getNumberValue(anthropicObject.confidence, 0.82)),
    source: "anthropic",
  };
}

export async function analyzePhotoEvidence(
  input: PhotoAnalysisInput,
): Promise<PhotoAnalysisResult> {
  const fallback = buildPhotoAnalysisFallback(input);
  const anthropicObject = await tryAnthropicObject(
    "You summarize field media for a construction manager. Return JSON only.",
    [
      "Create a JSON object with keys:",
      "summary, progressObservation, safetyFlags, qualityFlags, followUps, tags, confidence",
      "Use the metadata and project context below.",
      `Project: ${input.projectName}`,
      `Media type: ${input.mediaType}`,
      `Filename: ${input.filename}`,
      `Caption: ${input.caption || "None"}`,
      `Checkout media: ${input.isCheckout ? "yes" : "no"}`,
      `Related tasks: ${input.relatedTasks.join(" | ") || "None"}`,
      `Created at: ${input.createdAt}`,
    ].join("\n"),
  );

  if (!anthropicObject) {
    return fallback;
  }

  return {
    summary: getStringValue(anthropicObject.summary, fallback.summary),
    progressObservation: getStringValue(
      anthropicObject.progressObservation,
      fallback.progressObservation,
    ),
    safetyFlags: getStringArray(anthropicObject.safetyFlags),
    qualityFlags: getStringArray(anthropicObject.qualityFlags),
    followUps: getStringArray(anthropicObject.followUps).length
      ? getStringArray(anthropicObject.followUps)
      : fallback.followUps,
    tags: getStringArray(anthropicObject.tags),
    confidence: roundNumber(getNumberValue(anthropicObject.confidence, 0.79)),
    source: "anthropic",
  };
}

export async function answerManagerAssistant(
  question: string,
  snapshot: AssistantSnapshot,
): Promise<AssistantResult> {
  const fallback = buildAssistantFallback(question, snapshot);
  if (!snapshot.hasFinanceAccess && isFinancialQuestion(question.toLowerCase())) {
    return fallback;
  }

  const financialPromptLines = snapshot.hasFinanceAccess
    ? [
        `Unpaid hours: ${snapshot.unpaidHours.toFixed(2)}`,
        `Unpaid amount: ${snapshot.unpaidAmount.toFixed(2)}`,
      ]
    : [
        "Financial visibility: hidden for this user.",
        "Do not mention payroll, receipt totals, costs, unpaid hours, unpaid amounts, profit, or financial summaries.",
      ];
  const anthropicObject = await tryAnthropicObject(
    "You are a concise manager-side assistant for a construction workforce app. Return JSON only.",
    [
      "Create a JSON object with keys:",
      "answer, bullets, links, confidence",
      "links must be an array of objects with label and href.",
      `Question: ${question}`,
      `Org: ${snapshot.orgName}`,
      `On site count: ${snapshot.onSiteCount}`,
      `Active projects: ${snapshot.activeProjectCount}`,
      `Open tasks: ${snapshot.openTaskCount}`,
      ...financialPromptLines,
      `Projects: ${snapshot.projects.map((project) => `${project.name} (${project.onSiteWorkerCount} live, ${project.openTaskCount} open tasks)`).join(" | ")}`,
      `Live workers: ${snapshot.liveWorkers.map((worker) => `${worker.name} on ${worker.projectName ?? "unknown project"}`).join(" | ") || "None"}`,
      `Recent reports: ${snapshot.recentReports.map((report) => `${report.projectName} ${report.reportDate}: ${report.summary ?? "No summary"}`).join(" | ") || "None"}`,
    ].join("\n"),
  );

  if (!anthropicObject) {
    return fallback;
  }

  const rawLinks = Array.isArray(anthropicObject.links)
    ? anthropicObject.links
    : [];
  const links = rawLinks
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return null;
      }

      const record = item as Record<string, unknown>;
      const label = getStringValue(record.label, "");
      const href = getStringValue(record.href, "");

      if (!label || !href.startsWith("/")) {
        return null;
      }

      return { label, href };
    })
    .filter((item): item is { label: string; href: string } => Boolean(item))
    .slice(0, 3);

  return {
    answer: getStringValue(anthropicObject.answer, fallback.answer),
    bullets: getStringArray(anthropicObject.bullets),
    links: links.length > 0 ? links : fallback.links,
    confidence: roundNumber(getNumberValue(anthropicObject.confidence, 0.78)),
    source: "anthropic",
  };
}

export async function interpretVoiceCommand(
  transcript: string,
  snapshot: AssistantSnapshot,
): Promise<VoiceCommandResult> {
  const fallback = buildVoiceFallback(transcript, snapshot);
  const anthropicObject = await tryAnthropicObject(
    "You classify short manager voice commands for a construction dashboard. Return JSON only.",
    [
      "Create a JSON object with keys:",
      "intent, answer, actionLabel, route, confidence",
      "intent must be one of navigate, report, assistant, unknown.",
      `Transcript: ${transcript}`,
      `Available routes: /overview, /projects, /team, /timeline, /payroll, /settings, /ai`,
      `Project names: ${snapshot.projects.map((project) => project.name).join(" | ")}`,
    ].join("\n"),
  );

  if (!anthropicObject) {
    return fallback;
  }

  const intent = anthropicObject.intent;
  const normalizedIntent =
    intent === "navigate" || intent === "report" || intent === "assistant" || intent === "unknown"
      ? intent
      : fallback.intent;
  const route = getStringValue(anthropicObject.route, fallback.route ?? "");

  return {
    transcript,
    normalized: transcript.trim().toLowerCase(),
    intent: normalizedIntent,
    answer: getStringValue(anthropicObject.answer, fallback.answer),
    actionLabel: getStringValue(anthropicObject.actionLabel, fallback.actionLabel ?? "") || null,
    route: route.startsWith("/") ? route : fallback.route,
    confidence: roundNumber(getNumberValue(anthropicObject.confidence, 0.78)),
    source: "anthropic",
  };
}
