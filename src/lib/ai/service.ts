import type { DailyReport } from "@/types/database";
import type { ManagerWorkspaceData } from "@/lib/manager-types";
import type { WorkerShellData } from "@/lib/worker-types";
import { GoogleGenerativeAI, type Part } from "@google/generative-ai";
import {
  buildManagerSessions,
  buildProfileSummaries,
  buildProjectSummaries,
  getOverviewStats,
} from "@/lib/manager-utils";
import { getActiveOperationalProjects } from "@/lib/archive-utils";
import { isEffectiveOpenTask } from "@/lib/task-status";
import {
  inferSkillTagsFromText,
  readProfileSkillSettings,
  scoreWorkerForSkills,
} from "@/lib/profile-skills";
import {
  formatJarvisAttachmentsForPrompt,
  type JarvisAttachment,
} from "@/lib/ai/jarvis-memory";
import {
  WASHINGTON_CODE_REFERENCES,
} from "@/lib/ai/washington-code-knowledge";
import {
  readProjectEstimations,
  readProjectMaterialSpec,
} from "@/lib/project-planning";
import { getDisplayOrgName } from "@/lib/brand";
import {
  type AssistantAction,
  type AssistantResult,
  type AssistantLink,
  type AssistantConversationTurn,
  type AssistantSnapshot,
  type DailyReportInput,
  type GeneratedDailyReport,
  type PhotoAnalysisInput,
  type PhotoAnalysisResult,
  type VoiceCommandResult,
} from "@/lib/ai/types";

export const ORG_TIME_ZONE = "America/Los_Angeles";
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
export const JARVIS_GEMINI_SYSTEM_PROMPT = `You are Jarvis, the system assistant for Construction Clock.
RULES:
1. Answer extremely briefly and accurately. No filler words.
2. If the user greets you, simply say "Сэр" or "Слушаю". Do not invent data.
3. If data is provided in the prompt, answer the user's specific question about it. If no data is provided, do not hallucinate numbers.`;

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

function isRussianText(value: string): boolean {
  return /[а-яё]/i.test(value);
}

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase();
}

function formatHours(value: number): string {
  return `${roundNumber(value).toFixed(2)}h`;
}

function monthWindow(now = new Date()): { start: string; end: string } {
  const start = new Date(now);
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
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
  const normalized = normalizeSearchText(text);

  for (const project of snapshot.projects) {
    if (normalized.includes(normalizeSearchText(project.name))) {
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
    "material",
    "materials",
    "reimbursement",
    "paid",
    "gross",
    "net",
    "зарплат",
    "деньг",
    "оплат",
    "ставк",
    "чек",
    "материал",
    "расход",
    "стоим",
    "прибыл",
    "долг",
  ].some((keyword) => normalized.includes(keyword));
}

function isGreetingQuestion(normalized: string): boolean {
  const compact = normalized
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!compact) return false;

  const exactGreetings = new Set([
    "привет",
    "здравствуй",
    "здравствуйте",
    "доброе утро",
    "добрый день",
    "добрый вечер",
    "джарвис",
    "jarvis",
    "hi",
    "hello",
    "hey",
    "good morning",
    "good afternoon",
    "good evening",
  ]);

  if (exactGreetings.has(compact)) return true;

  const hasCommandIntent = [
    "сколько",
    "покажи",
    "открой",
    "создай",
    "создать",
    "добавь",
    "добавить",
    "запомни",
    "найди",
    "проверь",
    "how much",
    "show",
    "open",
    "create",
    "add",
    "remember",
    "find",
    "check",
  ].some((token) => compact.includes(token));
  if (hasCommandIntent) return false;

  const shortGreeting =
    compact.length <= 32 &&
    ["привет", "здравств", "добрый", "доброе", "джарвис", "jarvis", "hi", "hello", "hey"].some((token) =>
      compact.startsWith(token),
    );
  const asksPresence =
    compact.length <= 40 &&
    ["ты на связи", "джарвис на связи", "jarvis are you there", "are you there"].some((token) =>
      compact.includes(token),
    );

  return shortGreeting || asksPresence;
}

function isSimpleGreetingQuestion(question: string): boolean {
  const compact = question
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  return compact.length > 0 && compact.length < 15 && isGreetingQuestion(compact);
}

export function buildJarvisWakeResponse(question: string): AssistantResult | null {
  const normalized = normalizeSearchText(question);
  if (!isGreetingQuestion(normalized)) return null;

  return {
    answer: isRussianText(question) ? "Слушаю" : "Sir",
    bullets: [],
    links: [],
    confidence: 0.86,
    source: "fallback",
  };
}

type JarvisCreateProjectPayload = Extract<AssistantAction, { kind: "create_project" }>["payload"];

function extractProjectDraftFromCommand(question: string): JarvisCreateProjectPayload | null {
  const patterns = [
    /(?:создай|создать|добавь|добавить)\s+(?:новый\s+)?проект(?:\s+(?:с\s+названием|под\s+названием|по\s+имени))?\s+(.+)/i,
    /(?:create|add)\s+(?:a\s+)?(?:new\s+)?project(?:\s+(?:called|named))?\s+(.+)/i,
  ];
  const match = patterns.map((pattern) => question.match(pattern)).find(Boolean);
  if (!match?.[1]) return null;

  const dateMatches = [...question.matchAll(/\b(20\d{2}-\d{2}-\d{2})\b/g)].map((item) => item[1]);
  const addressMatch = question.match(/(?:по\s+адресу|адрес|address)\s*[:\-]?\s*([^,.;]+(?:,\s*[^,.;]+)?)/i);
  const rawName = match[1]
    .replace(/(?:по\s+адресу|адрес|address)\s*[:\-]?.*$/i, "")
    .replace(/\b(?:с|от|from|start|начало|дедлайн|deadline)\b.*$/i, "")
    .replace(/^["'«]+|["'»]+$/g, "")
    .trim();
  const name = rawName.slice(0, 80).trim();
  if (name.length < 2) return null;

  return {
    name,
    address: addressMatch?.[1]?.trim() || null,
    notes: question.trim().slice(0, 500),
    startDate: dateMatches[0] ?? null,
    endDate: dateMatches[1] ?? null,
  };
}

function buildSafeActionFallback(
  question: string,
): AssistantResult | null {
  const normalized = normalizeSearchText(question);
  const ru = isRussianText(question);
  const wantsCreateProject =
    normalized.includes("создай проект") ||
    normalized.includes("создать проект") ||
    normalized.includes("добавь проект") ||
    normalized.includes("добавить проект") ||
    normalized.includes("create project") ||
    normalized.includes("add project");

  if (!wantsCreateProject) return null;

  const draft = extractProjectDraftFromCommand(question);
  if (!draft) {
    return {
      answer: ru
        ? "Требуется название проекта."
        : "Project name required.",
      bullets: [],
      links: [{ label: ru ? "Открыть проекты" : "Open projects", href: "/projects" }],
      confidence: 0.7,
      source: "fallback",
    };
  }

  return {
    answer: ru ? "В процессе." : "Processing.",
    bullets: [],
    links: [{ label: ru ? "Открыть проекты" : "Open projects", href: "/projects" }],
    actions: [
      {
        kind: "create_project",
        label: ru ? `Создать "${draft.name}"` : `Create "${draft.name}"`,
        payload: draft,
      },
    ],
    confidence: 0.82,
    source: "fallback",
  };
}

function buildFinanceRestrictedFallback(question: string): AssistantResult {
  const ru = isRussianText(question);

  return {
    answer: ru
      ? "Доступ к финансовым данным запрещён."
      : "Financial access is restricted.",
    bullets: [],
    links: [],
    confidence: 0.9,
    source: "fallback",
  };
}

function buildGeminiUnavailableFallback(question: string): AssistantResult {
  const ru = isRussianText(question);

  return {
    answer: ru
      ? "Gemini недоступен. Повторите запрос позже."
      : "Gemini is unavailable. Try again later.",
    bullets: [],
    links: [],
    confidence: 0.2,
    source: "fallback",
  };
}

function buildAssistantFallback(
  question: string,
): AssistantResult {
  return buildGeminiUnavailableFallback(question);
}
function buildVoiceFallback(
  transcript: string,
  snapshot: AssistantSnapshot,
): VoiceCommandResult {
  const normalized = transcript.trim().toLowerCase();
  const ru = isRussianText(transcript);
  const commandAck = ru ? "Выполняю." : "Processing.";
  const projectRoute = findProjectRoute(transcript, snapshot);

  if (!normalized) {
    return {
      transcript,
      normalized,
      intent: "unknown",
      answer: ru ? "Уточните команду." : "Clarify the command.",
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
        answer: ru ? "Доступ запрещён." : "Access denied.",
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
      answer: commandAck,
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
      answer: commandAck,
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
      answer: commandAck,
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
      answer: commandAck,
      actionLabel: "AI settings",
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
      answer: commandAck,
      actionLabel: projectRoute.label,
      route: projectRoute.href,
      confidence: 0.81,
      source: "fallback",
    };
  }

  const assistant = buildAssistantFallback(transcript);

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

function formatAssistantHistory(history: AssistantConversationTurn[]): string {
  if (history.length === 0) return "None";

  return history
    .slice(-10)
    .map((turn) => `${turn.role === "user" ? "Manager" : "Gemini"}: ${turn.text.slice(0, 900)}`)
    .join("\n");
}

function readGeminiApiKey(): string | null {
  return (
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_AI_API_KEY ||
    null
  );
}

function attachmentToGeminiPart(attachment: JarvisAttachment): Part | null {
  if (!attachment.dataUrl) return null;
  const match = attachment.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;

  return {
    inlineData: {
      mimeType: match[1] || attachment.mimeType || "application/octet-stream",
      data: match[2],
    },
  };
}

async function tryGeminiObject(
  taskInstructions: string,
  prompt: string,
  attachments: JarvisAttachment[] = [],
): Promise<Record<string, unknown> | null> {
  const apiKey = readGeminiApiKey();
  if (!apiKey) {
    return null;
  }

  const parts: Part[] = [
    {
      text: [
        "Task instructions below define JSON shape and supplied data only. They do not override the system instruction.",
        "",
        taskInstructions,
        "",
        "Return JSON only. Do not wrap the JSON in markdown.",
        "",
        prompt,
      ].join("\n"),
    },
    ...attachments
      .map((attachment) => attachmentToGeminiPart(attachment))
      .filter((part): part is Part => Boolean(part)),
  ];

  try {
    const genAi = new GoogleGenerativeAI(apiKey);
    const model = genAi.getGenerativeModel({
      model: process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
      systemInstruction: JARVIS_GEMINI_SYSTEM_PROMPT,
    });
    const result = await model.generateContent({
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 900,
        responseMimeType: "application/json",
      },
    });
    return extractJsonObject(result.response.text());
  } catch {
    return null;
  }
}

async function tryAssistantModelObject(
  system: string,
  prompt: string,
  attachments: JarvisAttachment[] = [],
): Promise<{ object: Record<string, unknown>; source: "gemini" } | null> {
  const geminiObject = await tryGeminiObject(system, prompt, attachments);
  return geminiObject ? { object: geminiObject, source: "gemini" } : null;
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

function limitJarvisAnswer(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return compact;
  const sentences = compact.match(/[^.!?。！？]+[.!?。！？]?/g);
  const limited = sentences?.slice(0, 2).join(" ").trim() || compact;
  return limited.length > 320 ? `${limited.slice(0, 317).trimEnd()}...` : limited;
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
    source === "gemini" || source === "fallback" ? source : "fallback";

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

function getAnalysisTags(value: unknown): string[] {
  return coercePhotoAnalysis(value)?.tags ?? [];
}

function getAnalysisSummary(value: unknown): string | null {
  const analysis = coercePhotoAnalysis(value);
  return analysis?.summary || analysis?.progressObservation || null;
}

export function buildAssistantSnapshot(
  data: ManagerWorkspaceData,
  dailyReports: DailyReport[],
  options: { includeFinancials?: boolean } = {},
): AssistantSnapshot {
  const includeFinancials = options.includeFinancials ?? true;
  const sessions = buildManagerSessions(data);
  const rawProjectSummaries = buildProjectSummaries(data, sessions, {
    includeFinancials,
  });
  const projectSummaries = getActiveOperationalProjects(rawProjectSummaries);
  const profileSummaries = buildProfileSummaries(data, sessions);
  const stats = getOverviewStats(data, sessions, projectSummaries, profileSummaries, {
    includeFinancials,
  });
  const { start: monthStart, end: monthEnd } = monthWindow();
  const monthMinutesByProfile = new Map<string, number>();
  for (const session of sessions) {
    if (session.clockInTime < monthStart || session.clockInTime >= monthEnd) continue;
    monthMinutesByProfile.set(
      session.profileId,
      (monthMinutesByProfile.get(session.profileId) ?? 0) + session.durationMinutes,
    );
  }
  const completedTasksByProfile = new Map<string, number>();
  for (const task of data.tasks) {
    if (!task.completed_by || !task.completed_at) continue;
    if (task.completed_at < monthStart || task.completed_at >= monthEnd) continue;
    if (task.status !== "done") continue;
    completedTasksByProfile.set(
      task.completed_by,
      (completedTasksByProfile.get(task.completed_by) ?? 0) + 1,
    );
  }
  const projectById = new Map(data.projects.map((project) => [project.id, project]));
  const profileById = new Map(data.profiles.map((profile) => [profile.id, profile]));
  const profileSummaryById = new Map(profileSummaries.map((profile) => [profile.id, profile]));
  const openTasks = data.tasks
    .filter((task) => isEffectiveOpenTask(task))
    .slice(0, 60);
  const openTaskCountByProfile = new Map<string, number>();
  const taskSkillsById = new Map<string, string[]>();
  for (const task of openTasks) {
    if (task.assigned_to) {
      openTaskCountByProfile.set(
        task.assigned_to,
        (openTaskCountByProfile.get(task.assigned_to) ?? 0) + 1,
      );
    }
    const project = task.project_id ? projectById.get(task.project_id) : null;
    taskSkillsById.set(
      task.id,
      uniqueList(
        inferSkillTagsFromText(
          [
            task.title,
            task.description ?? "",
            project?.name ?? "",
            project?.notes ?? "",
          ].join(" "),
        ),
        8,
      ),
    );
  }
  const skillsByProjectId = new Map<string, string[]>();
  const openTaskTitlesByProjectId = new Map<string, string[]>();
  for (const task of openTasks) {
    if (!task.project_id) continue;
    skillsByProjectId.set(
      task.project_id,
      uniqueList([
        ...(skillsByProjectId.get(task.project_id) ?? []),
        ...(taskSkillsById.get(task.id) ?? []),
      ], 10),
    );
    openTaskTitlesByProjectId.set(
      task.project_id,
      uniqueList([
        ...(openTaskTitlesByProjectId.get(task.project_id) ?? []),
        task.title,
      ], 6),
    );
  }
  const fieldProfiles = data.profiles.filter(
    (profile) =>
      profile.is_active &&
      !profile.deleted_at &&
      ["worker", "supervisor", "driver", "subcontractor", "sales"].includes(profile.role),
  );
  const assignmentSuggestions = openTasks
    .map((task) => {
      const requiredSkills = taskSkillsById.get(task.id) ?? [];
      if (requiredSkills.length === 0) return null;
      const candidates = fieldProfiles
        .map((profile) => scoreWorkerForSkills(profile, requiredSkills))
        .filter((candidate) => candidate.score > 0)
        .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
        .slice(0, 5)
        .map((candidate) => ({
          workerId: candidate.profileId,
          name: candidate.name,
          role: candidate.role,
          skills: candidate.skills,
          matchedSkills: candidate.matchedSkills,
          score: roundNumber(candidate.score),
          reason:
            candidate.matchedSkills.length > 0
              ? `matches ${candidate.matchedSkills.join(", ")}`
              : candidate.note
                ? "has relevant profile notes"
                : "role fit",
        }));
      const project = task.project_id ? projectById.get(task.project_id) : null;
      return {
        taskId: task.id,
        taskTitle: task.title,
        projectId: task.project_id,
        projectName: project?.name ?? "Unlinked",
        requiredSkills,
        candidates,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .slice(0, 20);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayStartIso = todayStart.toISOString();
  const receiptTotalsByProject = new Map<
    string,
    {
      total: number;
      today: number;
      count: number;
      recent: Array<{
        id: string;
        projectId: string | null;
        projectName: string;
        amount: number;
        storeName: string | null;
        filename: string;
        createdAt: string;
        purchaseDate: string | null;
      }>;
    }
  >();
  let receiptToday = 0;
  let receiptCount = 0;

  if (includeFinancials) {
    for (const item of data.media) {
      if (item.deleted_at || !item.project_id) continue;
      const meta = item.metadata as Record<string, unknown> | null;
      if (meta?.category !== "receipt") continue;
      const amount = Number(meta.amount ?? 0);
      if (!Number.isFinite(amount) || amount <= 0) continue;

      const project = projectById.get(item.project_id);
      const receipt = {
        id: item.id,
        projectId: item.project_id,
        projectName: project?.name ?? "Unknown project",
        amount: roundNumber(amount),
        storeName: typeof meta.store_name === "string" && meta.store_name.trim() ? meta.store_name : null,
        filename: item.filename ?? item.storage_path.split("/").pop() ?? item.storage_path,
        createdAt: item.created_at,
        purchaseDate:
          typeof meta.purchase_date === "string" && meta.purchase_date.trim()
            ? meta.purchase_date
            : null,
      };
      receiptCount += 1;
      const purchaseTime = receipt.purchaseDate
        ? new Date(`${receipt.purchaseDate}T12:00:00`).getTime()
        : Number.NaN;
      const isTodayReceipt =
        item.created_at >= todayStartIso ||
        (Number.isFinite(purchaseTime) && purchaseTime >= todayStart.getTime());
      if (isTodayReceipt) {
        receiptToday += amount;
      }
      const current = receiptTotalsByProject.get(item.project_id) ?? {
        total: 0,
        today: 0,
        count: 0,
        recent: [],
      };
      current.total += amount;
      current.count += 1;
      if (isTodayReceipt) {
        current.today += amount;
      }
      current.recent.push(receipt);
      current.recent.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
      current.recent = current.recent.slice(0, 8);
      receiptTotalsByProject.set(item.project_id, current);
    }
  }
  const recentShifts = sessions
    .slice(0, 40)
    .map((session) => ({
      id: session.id,
      workerName: session.profileName,
      workerRole: session.profileRole,
      projectName: session.projectName,
      clockInTime: session.clockInTime,
      clockOutTime: session.clockOutTime,
      durationMinutes: session.durationMinutes,
      checkoutStatus: session.checkoutStatus,
      checkoutNote: session.checkoutNote,
      isOpen: session.isOpen,
    }));
  const recentPayrollRuns = includeFinancials
    ? data.payrollRuns.slice(0, 12).map((run) => ({
        id: run.id,
        periodStart: run.period_start,
        periodEnd: run.period_end,
        status: run.status,
        workerCount:
          typeof run.metadata.workers_count === "number"
            ? run.metadata.workers_count
            : typeof run.metadata.workerCount === "number"
              ? run.metadata.workerCount
              : 0,
        totalAmount: roundNumber(run.total_amount),
        paidAt: run.confirmed_at,
      }))
    : [];

  return {
    orgName: getDisplayOrgName(data.org.name),
    onSiteCount: stats.onSiteCount,
    activeProjectCount: stats.activeProjectCount,
    openTaskCount: stats.openTaskCount,
    crewCount: stats.crewCount,
    todayHours: stats.todayHours,
    hasFinanceAccess: includeFinancials,
    unpaidHours: stats.unpaidHours,
    unpaidAmount: stats.unpaidAmount,
    receiptTotal: includeFinancials ? roundNumber(stats.receiptTotal) : 0,
    receiptToday: includeFinancials ? roundNumber(receiptToday) : 0,
    receiptCount: includeFinancials ? receiptCount : 0,
    projects: projectSummaries.map((project) => {
      const receiptStats = receiptTotalsByProject.get(project.id);
      return {
        id: project.id,
        name: project.name,
        status: project.status,
        address: project.address,
        notes: project.notes,
        startDate: project.start_date,
        endDate: project.end_date,
        onSiteWorkerCount: project.onSiteWorkerCount,
        openTaskCount: project.openTaskCount,
        weekMinutes: project.weekMinutes,
        skillTags: skillsByProjectId.get(project.id) ?? [],
        openTaskTitles: openTaskTitlesByProjectId.get(project.id) ?? [],
        receiptTotal: includeFinancials ? roundNumber(project.receiptTotal) : 0,
        receiptToday: includeFinancials ? roundNumber(receiptStats?.today ?? 0) : 0,
        receiptCount: includeFinancials ? receiptStats?.count ?? 0 : 0,
        recentReceipts: includeFinancials ? receiptStats?.recent ?? [] : [],
        materialSpec: readProjectMaterialSpec(project.settings)
          .slice(0, 40)
          .map((item) => ({
            name: item.name,
            quantity: item.quantity,
            unit: item.unit,
            supplier: item.supplier,
            link: item.link,
            note: item.note,
          })),
        estimates: includeFinancials
          ? readProjectEstimations(project.settings)
              .slice(0, 20)
              .map((estimate) => ({
                title: estimate.title,
                documentType: estimate.documentType,
                status: estimate.status,
                description: estimate.description,
                clientPrice: roundNumber(estimate.clientPrice),
                internalCost: roundNumber(estimate.internalCost),
                materialCost: roundNumber(estimate.materialCost),
                margin: 0,
                workItems: estimate.items
                  .slice(0, 12)
                  .map((item) => `${item.title}: ${item.quantity} ${item.unit}, $${item.totalPrice}`),
                attachmentNames: estimate.attachments.slice(0, 10).map((attachment) => attachment.name),
                attachmentCount: estimate.attachments.length,
              }))
          : [],
      };
    }),
    liveWorkers: profileSummaries
      .filter((profile) => profile.isOnSite)
      .map((profile) => ({
        id: profile.id,
        name: profile.name,
        role: profile.role,
        projectName: profile.currentProjectName,
        currentSessionMinutes: profile.currentSessionMinutes,
      })),
    workerMetrics: data.profiles
      .filter((profile) => profile.is_active && !profile.deleted_at)
      .map((profile) => {
        const skillSettings = readProfileSkillSettings(profile.settings);
        const summary = profileSummaryById.get(profile.id);
        return {
          id: profile.id,
          name: profile.name,
          role: profile.role,
          monthHours: roundNumber((monthMinutesByProfile.get(profile.id) ?? 0) / 60),
          completedTasksThisMonth: completedTasksByProfile.get(profile.id) ?? 0,
          openTaskCount: openTaskCountByProfile.get(profile.id) ?? 0,
          currentProjectName: summary?.currentProjectName ?? null,
          assignedProjectNames: summary?.assignedProjectNames ?? [],
          skills: skillSettings.skills,
          capabilitiesNote: skillSettings.note || null,
        };
      })
      .sort((left, right) => right.monthHours - left.monthHours || right.completedTasksThisMonth - left.completedTasksThisMonth)
      .slice(0, 12),
    openTasks: openTasks.slice(0, 30).map((task) => ({
      id: task.id,
      title: task.title,
      projectId: task.project_id,
      projectName: task.project_id
        ? projectById.get(task.project_id)?.name ?? "Unknown project"
        : "Unlinked",
      priority: task.priority,
      dueDate: task.due_date,
      assignedToName: task.assigned_to
        ? profileById.get(task.assigned_to)?.name ?? "Unknown worker"
        : null,
      skillTags: taskSkillsById.get(task.id) ?? [],
    })),
    assignmentSuggestions,
    mediaIndex: data.media
      .filter((item) => !item.deleted_at)
      .slice(0, 120)
      .map((item) => {
        const project = item.project_id ? projectById.get(item.project_id) : null;
        const uploader = item.uploaded_by ? profileById.get(item.uploaded_by) : null;
        const summary = getAnalysisSummary(item.ai_analysis);
        const tags = uniqueList(
          [
            ...getAnalysisTags(item.ai_analysis),
            ...inferSkillTagsFromText(
              [
                item.filename ?? "",
                item.caption ?? "",
                project?.name ?? "",
                project?.notes ?? "",
                summary ?? "",
              ].join(" "),
            ),
            item.is_checkout ? "checkout" : "",
          ],
          10,
        );

        return {
          id: item.id,
          projectId: item.project_id,
          projectName: project?.name ?? "Unlinked",
          uploadedByName: uploader?.name ?? null,
          mediaType: item.media_type,
          filename: item.filename ?? item.storage_path.split("/").pop() ?? item.storage_path,
          caption: item.caption,
          isCheckout: item.is_checkout,
          createdAt: item.created_at,
          tags,
          summary,
        };
      }),
    memoryRules: [],
    codeReferences: WASHINGTON_CODE_REFERENCES.map((reference) => ({
      topic: reference.topic,
      summary: reference.summary,
      sourceLabel: reference.sourceLabel,
      url: reference.url,
    })),
    recentReports: dailyReports.slice(0, 8).map((report) => ({
      id: report.id,
      projectName:
        data.projects.find((project) => project.id === report.project_id)?.name ?? "All Projects",
      reportDate: report.report_date,
      summary: report.summary,
    })),
    recentShifts,
    recentPayrollRuns,
  };
}

export async function generateDailyReport(
  input: DailyReportInput,
): Promise<GeneratedDailyReport> {
  const fallback = buildDailyReportFallback(input);
  const geminiObject = await tryGeminiObject(
    "Generate a concise construction daily report object. Return JSON only.",
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

  if (!geminiObject) {
    return fallback;
  }

  return {
    headline: getStringValue(geminiObject.headline, fallback.headline),
    summary: getStringValue(geminiObject.summary, fallback.summary),
    highlights: getStringArray(geminiObject.highlights).length
      ? getStringArray(geminiObject.highlights)
      : fallback.highlights,
    risks: getStringArray(geminiObject.risks),
    nextActions: getStringArray(geminiObject.nextActions).length
      ? getStringArray(geminiObject.nextActions)
      : fallback.nextActions,
    laborSignal: getStringValue(geminiObject.laborSignal, fallback.laborSignal),
    deliverySignal: getStringValue(geminiObject.deliverySignal, fallback.deliverySignal),
    confidence: roundNumber(getNumberValue(geminiObject.confidence, 0.82)),
    source: "gemini",
  };
}

export async function analyzePhotoEvidence(
  input: PhotoAnalysisInput,
): Promise<PhotoAnalysisResult> {
  const fallback = buildPhotoAnalysisFallback(input);
  const geminiObject = await tryGeminiObject(
    "Generate a field media analysis object for a construction manager. Return JSON only.",
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

  if (!geminiObject) {
    return fallback;
  }

  return {
    summary: getStringValue(geminiObject.summary, fallback.summary),
    progressObservation: getStringValue(
      geminiObject.progressObservation,
      fallback.progressObservation,
    ),
    safetyFlags: getStringArray(geminiObject.safetyFlags),
    qualityFlags: getStringArray(geminiObject.qualityFlags),
    followUps: getStringArray(geminiObject.followUps).length
      ? getStringArray(geminiObject.followUps)
      : fallback.followUps,
    tags: getStringArray(geminiObject.tags),
    confidence: roundNumber(getNumberValue(geminiObject.confidence, 0.79)),
    source: "gemini",
  };
}

function buildWorkerJarvisFallback(question: string, shell: WorkerShellData): AssistantResult {
  const ru = isRussianText(question) || shell.profile.language !== "en";
  const normalized = normalizeSearchText(question);
  const currentProject = shell.clockState.currentProjectName;
  const openTasks = shell.tasks.filter((task) => task.status !== "done" && task.status !== "cancelled");
  const matchingProject =
    shell.projects.find((project) => normalized.includes(normalizeSearchText(project.name))) ??
    (shell.clockState.currentProjectId
      ? shell.projects.find((project) => project.id === shell.clockState.currentProjectId)
      : null);
  const projectMaterials = matchingProject
    ? readProjectMaterialSpec(matchingProject.settings).slice(0, 8)
    : [];

  if (normalized.includes("material") || normalized.includes("материал")) {
    return {
      answer: matchingProject
        ? ru
          ? `По проекту ${matchingProject.name} вижу ${projectMaterials.length} позиций материалов.`
          : `${matchingProject.name} has ${projectMaterials.length} material spec items visible to you.`
        : ru
          ? "Выберите или назовите проект, и я покажу видимый список материалов."
          : "Name a project and I will show the visible material list.",
      bullets:
        projectMaterials.length > 0
          ? projectMaterials.map((item) =>
              [item.name, item.quantity, item.unit, item.supplier].filter(Boolean).join(" "),
            )
          : [ru ? "Материалы пока не записаны для этого проекта." : "No material spec is recorded for this project yet."],
      links: matchingProject ? [{ label: matchingProject.name, href: `/project/${matchingProject.id}` }] : [],
      confidence: 0.74,
      source: "fallback",
    };
  }

  if (normalized.includes("task") || normalized.includes("задач")) {
    return {
      answer: ru
        ? `У тебя ${openTasks.length} открытых видимых задач.`
        : `You have ${openTasks.length} visible open tasks.`,
      bullets: openTasks.slice(0, 6).map((task) =>
        `${task.projectName ?? (ru ? "Без проекта" : "No project")}: ${task.title} (${task.status})`,
      ),
      links: [{ label: ru ? "Открыть задачи" : "Open tasks", href: "/my-tasks" }],
      confidence: 0.76,
      source: "fallback",
    };
  }

  if (normalized.includes("shift") || normalized.includes("смен")) {
    return {
      answer: shell.clockState.isClockedIn
        ? ru
          ? `Ты сейчас на смене${currentProject ? ` на проекте ${currentProject}` : ""}.`
          : `You are currently clocked in${currentProject ? ` on ${currentProject}` : ""}.`
        : ru
          ? "Ты сейчас не на смене."
          : "You are not currently clocked in.",
      bullets: shell.sessions.slice(0, 4).map((session) =>
        `${session.projectName}: ${formatHours(session.durationMinutes / 60)}${session.clockOutTime ? "" : ru ? " сейчас" : " live"}`,
      ),
      links: [{ label: ru ? "Открыть смену" : "Open clock", href: "/clock" }],
      confidence: 0.72,
      source: "fallback",
    };
  }

  return {
    answer: ru
      ? "Я вижу только твои проекты, задачи, материалы и твои смены. Финансы, ставки и зарплату рабочему режиму Jarvis не показываю."
      : "I can see only your projects, tasks, materials, and your own shifts. Finance, rates, and payroll are hidden in worker Jarvis mode.",
    bullets: [
      ru
        ? `${shell.projects.length} видимых проектов`
        : `${shell.projects.length} visible projects`,
      ru
        ? `${openTasks.length} открытых задач`
        : `${openTasks.length} open tasks`,
      shell.clockState.isClockedIn
        ? ru
          ? `Сейчас на объекте: ${currentProject ?? "проект не записан"}`
          : `Currently on site: ${currentProject ?? "project not recorded"}`
        : ru
          ? "Сейчас не на смене"
          : "Not clocked in right now",
    ],
    links: [
      { label: ru ? "Мои задачи" : "My tasks", href: "/my-tasks" },
      { label: ru ? "Мои проекты" : "My projects", href: "/my-projects" },
    ],
    confidence: 0.68,
    source: "fallback",
  };
}

export async function answerWorkerAssistant(
  question: string,
  shell: WorkerShellData,
): Promise<AssistantResult> {
  const fallback = buildWorkerJarvisFallback(question, shell);
  const materialLines = shell.projects.flatMap((project) =>
    readProjectMaterialSpec(project.settings)
      .slice(0, 12)
      .map((item) =>
        `${project.name}: ${item.name} ${item.quantity} ${item.unit}${item.supplier ? ` from ${item.supplier}` : ""}${item.note ? ` note ${item.note}` : ""}`,
      ),
  );

  const modelObject = await tryGeminiObject(
    "Generate a worker-safe field response object. Return JSON only. Use only the supplied worker-visible context. Never mention payroll, rates, receipt amounts, profit, owner-only analytics, company financials, or hidden manager data. If a fact is not in the context, say it is not recorded for this worker.",
    [
      "Create a JSON object with keys: answer, bullets, links, confidence.",
      "links must be an array of objects with label and href.",
      `Worker: ${shell.profile.name} (${shell.profile.role})`,
      `Current shift: ${shell.clockState.isClockedIn ? `live on ${shell.clockState.currentProjectName ?? "unknown project"}` : "not clocked in"}`,
      `Visible projects: ${shell.projects.map((project) => `${project.name}, address ${project.address ?? "none"}, status ${project.status}`).join(" | ") || "none"}`,
      `Visible tasks: ${shell.tasks.slice(0, 50).map((task) => `${task.projectName ?? "No project"}: ${task.title}, status ${task.status}, priority ${task.priority}`).join(" | ") || "none"}`,
      `Visible materials: ${materialLines.join(" | ") || "none"}`,
      `Recent own uploads: ${shell.media.slice(0, 20).map((item) => `${item.projectName ?? "No project"} ${item.media_type} ${item.filename}, caption ${item.caption ?? "none"}`).join(" | ") || "none"}`,
      `Recent own shifts: ${shell.sessions.slice(0, 12).map((session) => `${session.projectName}: ${session.clockInTime} to ${session.clockOutTime ?? "live"}, ${session.durationMinutes} minutes`).join(" | ") || "none"}`,
      `Question: ${question}`,
    ].join("\n"),
  );

  if (!modelObject) {
    return fallback;
  }

  const rawLinks = Array.isArray(modelObject.links) ? modelObject.links : [];
  const links = rawLinks
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const record = item as Record<string, unknown>;
      const label = getStringValue(record.label, "");
      const href = getStringValue(record.href, "");
      if (!label || !href.startsWith("/")) return null;
      return { label, href };
    })
    .filter((item): item is AssistantLink => Boolean(item))
    .slice(0, 3);

  return {
    answer: getStringValue(modelObject.answer, fallback.answer),
    bullets: getStringArray(modelObject.bullets),
    links: links.length > 0 ? links : fallback.links,
    confidence: roundNumber(getNumberValue(modelObject.confidence, 0.72)),
    source: "gemini",
  };
}

export async function answerManagerAssistant(
  question: string,
  snapshot: AssistantSnapshot,
  options: { attachments?: JarvisAttachment[]; history?: AssistantConversationTurn[] } = {},
): Promise<AssistantResult> {
  const attachments = options.attachments ?? [];
  const history = options.history ?? [];
  const normalizedQuestion = normalizeSearchText(question);

  if (!snapshot.hasFinanceAccess && isFinancialQuestion(normalizedQuestion)) {
    return buildFinanceRestrictedFallback(question);
  }

  const safeActionAnswer = buildSafeActionFallback(question);
  if (safeActionAnswer) {
    return safeActionAnswer;
  }

  const unavailable = buildGeminiUnavailableFallback(question);
  const includeWorkspaceSnapshot = !isSimpleGreetingQuestion(question);
  const financialPromptLines = snapshot.hasFinanceAccess
    ? [
        `Unpaid hours: ${snapshot.unpaidHours.toFixed(2)}`,
        `Unpaid amount: ${snapshot.unpaidAmount.toFixed(2)}`,
        `Material receipts total: ${snapshot.receiptTotal.toFixed(2)}`,
        `Material receipts today: ${snapshot.receiptToday.toFixed(2)}`,
        `Receipt count: ${snapshot.receiptCount}`,
      ]
    : [
        "Financial visibility: hidden for this user.",
        "Do not mention payroll, receipt totals, costs, unpaid hours, unpaid amounts, profit, or financial summaries.",
      ];
  const modelObject = await tryAssistantModelObject(
    [
      "Return JSON only.",
      includeWorkspaceSnapshot
        ? "Use only the supplied app snapshot. If the snapshot does not contain a fact, say it is not recorded."
        : "No workspace snapshot is provided for this greeting. Do not mention app data, workers, hours, projects, payroll, materials, or numbers.",
      "Do not proactively summarize data. Do not volunteer numbers, hours, payroll, workers, or project statistics unless the user directly asks.",
      "For greetings or wake words, keep bullets and links empty.",
      "For command acknowledgements, keep bullets empty unless an explicit confirmation action is required.",
      "Never invent app data.",
    ].join(" "),
    [
      "Create a JSON object with keys:",
      "answer, bullets, links, confidence",
      "links must be an array of objects with label and href.",
      `Question: ${question}`,
      ...(!includeWorkspaceSnapshot
        ? [
            "Workspace snapshot: not provided for this turn.",
          ]
        : [
      "If asked who should do work, use the worker skills and assignment suggestions below; never invent a skill.",
      "If asked for accounting/payroll analysis, use financial fields only when financial visibility is present.",
      "If asked about current totals, overview, materials, shifts, tasks, project documents, estimates, invoices, or change orders, use the snapshot first and answer with exact app numbers.",
      "If asked about Washington code, use the code reference pack as navigation only and say AHJ/permit set is final.",
      "If attached images are supplied to the model, inspect them directly. If only filenames or metadata are supplied, say that visual content is not available.",
      "Use the recent conversation to resolve follow-up words like 'him', 'that project', 'there', or 'same thing'.",
      `Recent conversation:\n${formatAssistantHistory(history)}`,
      `Org: ${snapshot.orgName}`,
      `On site count: ${snapshot.onSiteCount}`,
      `Active projects: ${snapshot.activeProjectCount}`,
      `Open tasks: ${snapshot.openTaskCount}`,
      `Crew count: ${snapshot.crewCount}`,
      `Today hours: ${snapshot.todayHours.toFixed(2)}`,
      ...financialPromptLines,
      `Attached files:\n${formatJarvisAttachmentsForPrompt(attachments)}`,
      `Projects: ${snapshot.projects.map((project) => `${project.name} (${project.status}, address: ${project.address ?? "none"}, dates: ${project.startDate ?? "none"} to ${project.endDate ?? "none"}, ${project.onSiteWorkerCount} live, ${project.openTaskCount} open tasks, receipts: ${snapshot.hasFinanceAccess ? `total $${project.receiptTotal.toFixed(2)}, today $${project.receiptToday.toFixed(2)}, count ${project.receiptCount}` : "hidden"}, skills: ${project.skillTags.join(", ") || "none"}, tasks: ${project.openTaskTitles.join("; ") || "none"}, materials: ${project.materialSpec.map((item) => `${item.name} ${item.quantity} ${item.unit}${item.supplier ? ` from ${item.supplier}` : ""}${item.note ? ` note ${item.note}` : ""}`).join("; ") || "none"}, documents: ${snapshot.hasFinanceAccess ? project.estimates.map((estimate) => `${estimate.documentType} ${estimate.title} ${estimate.status}; files ${estimate.attachmentNames.join(", ") || "none"}; notes ${estimate.description || "none"}`).join("; ") || "none" : "hidden"}, notes: ${project.notes ?? "none"})`).join(" | ")}`,
      `Live workers: ${snapshot.liveWorkers.map((worker) => `${worker.name} on ${worker.projectName ?? "unknown project"}`).join(" | ") || "None"}`,
      `Current month worker metrics: ${snapshot.workerMetrics.map((worker) => `${worker.name} (${worker.role}): ${worker.monthHours.toFixed(2)}h, ${worker.completedTasksThisMonth} completed tasks, ${worker.openTaskCount} open assigned, skills: ${worker.skills.join(", ") || "none"}, note: ${worker.capabilitiesNote ?? "none"}`).join(" | ") || "None"}`,
      `Open tasks: ${snapshot.openTasks.map((task) => `${task.title} on ${task.projectName}, priority ${task.priority}, assigned ${task.assignedToName ?? "unassigned"}, skills ${task.skillTags.join(", ") || "unknown"}`).join(" | ") || "None"}`,
      `Assignment suggestions: ${snapshot.assignmentSuggestions.map((suggestion) => `${suggestion.taskTitle} on ${suggestion.projectName}, needs ${suggestion.requiredSkills.join(", ")}, candidates ${suggestion.candidates.map((candidate) => `${candidate.name} (${candidate.reason})`).join("; ") || "none"}`).join(" | ") || "None"}`,
      `Recent shifts: ${snapshot.recentShifts.map((shift) => `${shift.workerName} (${shift.workerRole}) on ${shift.projectName}, ${shift.clockInTime} to ${shift.clockOutTime ?? "open"}, ${formatHours(shift.durationMinutes / 60)}, checkout ${shift.checkoutStatus}${shift.checkoutNote ? `, note ${shift.checkoutNote}` : ""}`).join(" | ") || "None"}`,
      `Recent payroll runs: ${snapshot.hasFinanceAccess ? snapshot.recentPayrollRuns.map((run) => `${run.periodStart} to ${run.periodEnd}, ${run.status}, workers ${run.workerCount}, total $${run.totalAmount.toFixed(2)}, paid ${run.paidAt ?? "not paid"}`).join(" | ") || "None" : "hidden"}`,
      `Recent media index: ${snapshot.mediaIndex.slice(0, 40).map((item) => `${item.projectName} ${item.mediaType} ${item.filename}, caption ${item.caption ?? "none"}, tags ${item.tags.join(", ") || "none"}, summary ${item.summary ?? "none"}, uploader ${item.uploadedByName ?? "unknown"}`).join(" | ") || "None"}`,
      `Washington code reference pack: ${snapshot.codeReferences.map((reference) => `${reference.topic}: ${reference.summary} (${reference.url})`).join(" | ")}`,
      `Recent reports: ${snapshot.recentReports.map((report) => `${report.projectName} ${report.reportDate}: ${report.summary ?? "No summary"}`).join(" | ") || "None"}`,
          ]),
    ].join("\n"),
    attachments,
  );

  if (!modelObject) {
    return unavailable;
  }

  const modelResponse = modelObject.object;

  const rawLinks = Array.isArray(modelResponse.links)
    ? modelResponse.links
    : [];
  const links = rawLinks
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return null;
      }

      const record = item as Record<string, unknown>;
      const label = getStringValue(record.label, "");
      const href = getStringValue(record.href, "");

      if (!label || (!href.startsWith("/") && !href.startsWith("https://"))) {
        return null;
      }

      return { label, href };
    })
    .filter((item): item is { label: string; href: string } => Boolean(item))
    .slice(0, 3);

  return {
    answer: limitJarvisAnswer(getStringValue(modelResponse.answer, unavailable.answer)),
    bullets: getStringArray(modelResponse.bullets).slice(0, 2),
    links,
    confidence: roundNumber(getNumberValue(modelResponse.confidence, 0.78)),
    source: modelObject.source,
  };
}

export async function interpretVoiceCommand(
  transcript: string,
  snapshot: AssistantSnapshot,
): Promise<VoiceCommandResult> {
  const fallback = buildVoiceFallback(transcript, snapshot);
  const geminiObject = await tryGeminiObject(
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

  if (!geminiObject) {
    return fallback;
  }

  const intent = geminiObject.intent;
  const normalizedIntent =
    intent === "navigate" || intent === "report" || intent === "assistant" || intent === "unknown"
      ? intent
      : fallback.intent;
  const route = getStringValue(geminiObject.route, fallback.route ?? "");

  return {
    transcript,
    normalized: transcript.trim().toLowerCase(),
    intent: normalizedIntent,
    answer: getStringValue(geminiObject.answer, fallback.answer),
    actionLabel: getStringValue(geminiObject.actionLabel, fallback.actionLabel ?? "") || null,
    route: route.startsWith("/") ? route : fallback.route,
    confidence: roundNumber(getNumberValue(geminiObject.confidence, 0.78)),
    source: "gemini",
  };
}
