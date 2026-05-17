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
import { isEffectiveOpenTask } from "@/lib/task-status";
import {
  inferSkillTagsFromText,
  readProfileSkillSettings,
  scoreWorkerForSkills,
} from "@/lib/profile-skills";
import {
  formatJarvisAttachmentsForPrompt,
  formatJarvisMemoryForPrompt,
  MAX_JARVIS_ATTACHMENT_CHARS,
  readJarvisMemory,
  type JarvisAttachment,
} from "@/lib/ai/jarvis-memory";
import {
  findWashingtonCodeReferences,
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
  type SnapshotMediaItem,
  type VoiceCommandResult,
} from "@/lib/ai/types";

export const ORG_TIME_ZONE = "America/Los_Angeles";
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
export const JARVIS_GEMINI_SYSTEM_PROMPT = `You are the system UI for a mainframe. You are completely devoid of emotion, warmth, or conversational filler.

CRITICAL RULES FOR YOUR OUTPUT:
1. Keep sentences extremely short and clinically precise.
2. Do not act human. Do not be helpful. Be a strict status-reporting protocol.
3. Prefix responses with system status phrases (e.g., "Acknowledged.", "Warning.", "Processing.").
4. Begin all responses acknowledging the user strictly as "Sir."
5. Never use emojis, exclamation marks, or conversational fillers.

Example interaction:
User: Create a project.
You: Acknowledged. Sir. Processing command. Database updated. Project initialized. Awaiting input.`;

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

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function skillLabel(skill: string, ru: boolean): string {
  const labels: Record<string, { en: string; ru: string }> = {
    framing: { en: "framing", ru: "фрейм/каркас" },
    drywall: { en: "drywall", ru: "гипсокартон" },
    mudding: { en: "mudding", ru: "шпаклевка" },
    painting: { en: "painting", ru: "покраска" },
    tile: { en: "tile", ru: "плитка" },
    flooring: { en: "flooring", ru: "полы" },
    plumbing: { en: "plumbing", ru: "сантехника" },
    electrical: { en: "electrical", ru: "электрика" },
    demo: { en: "demo", ru: "демонтаж" },
    concrete: { en: "concrete", ru: "бетон" },
    roofing: { en: "roofing", ru: "кровля" },
    trim: { en: "trim", ru: "плинтусы/trim" },
    finish: { en: "finish work", ru: "финишная отделка" },
    cleanup: { en: "cleanup", ru: "уборка" },
    delivery: { en: "delivery", ru: "доставка" },
    inspection: { en: "inspection", ru: "проверка" },
    driving: { en: "driving", ru: "вождение" },
    sales: { en: "sales", ru: "продажи" },
  };

  return labels[skill]?.[ru ? "ru" : "en"] ?? skill;
}

function skillListLabel(skills: string[], ru: boolean): string {
  return skills.map((skill) => skillLabel(skill, ru)).join(", ");
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

function findProjectInSnapshot(text: string, snapshot: AssistantSnapshot) {
  const normalized = normalizeSearchText(text);
  return (
    snapshot.projects.find((project) =>
      normalized.includes(normalizeSearchText(project.name)),
    ) ?? null
  );
}

function findWorkerInSnapshot(text: string, snapshot: AssistantSnapshot) {
  const normalized = normalizeSearchText(text);
  return (
    snapshot.workerMetrics.find((worker) =>
      normalized.includes(normalizeSearchText(worker.name)),
    ) ?? null
  );
}

function wantsAssignmentAdvice(normalized: string): boolean {
  return [
    "assign",
    "assignment",
    "who should",
    "best worker",
    "recommend",
    "suggest",
    "подбери",
    "кого",
    "поставить",
    "назнач",
    "распредел",
    "лучше",
    "подскажи",
    "умеет",
    "навык",
  ].some((keyword) => normalized.includes(keyword));
}

function findBestAssignmentSuggestion(question: string, snapshot: AssistantSnapshot) {
  const normalized = normalizeSearchText(question);
  const project = findProjectInSnapshot(question, snapshot);
  const requestedSkills = inferSkillTagsFromText(question);

  return (
    snapshot.assignmentSuggestions.find((suggestion) => {
      const projectMatch = project ? suggestion.projectId === project.id : true;
      const skillMatch =
        requestedSkills.length === 0 ||
        requestedSkills.some((skill) => suggestion.requiredSkills.includes(skill));
      const titleMatch = normalized.includes(normalizeSearchText(suggestion.taskTitle));
      return projectMatch && (skillMatch || titleMatch);
    }) ??
    snapshot.assignmentSuggestions.find((suggestion) =>
      requestedSkills.some((skill) => suggestion.requiredSkills.includes(skill)),
    ) ??
    snapshot.assignmentSuggestions[0] ??
    null
  );
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

function isMediaSearchQuestion(normalized: string): boolean {
  return [
    "photo",
    "photos",
    "picture",
    "image",
    "video",
    "media",
    "upload",
    "evidence",
    "find",
    "search",
    "фото",
    "фотк",
    "картин",
    "изображ",
    "видео",
    "медиа",
    "загруз",
    "доказ",
    "найди",
    "покажи",
    "ищи",
  ].some((keyword) => normalized.includes(keyword));
}

function isEstimateQuestion(normalized: string): boolean {
  return [
    "estimate",
    "estimation",
    "bid",
    "quote",
    "cost to",
    "how much",
    "how long",
    "timeline",
    "labor",
    "material",
    "смет",
    "эстим",
    "оцен",
    "сколько",
    "стоить",
    "цена",
    "дней",
    "часов",
    "материал",
  ].some((keyword) => normalized.includes(keyword));
}

function isCodeQuestion(normalized: string): boolean {
  return [
    "code",
    "wac",
    "permit",
    "inspection",
    "inspector",
    "washington",
    "dosh",
    "osha",
    "safety",
    "energy code",
    "код",
    "wac",
    "разреш",
    "инспек",
    "штат вашингтон",
    "безопас",
    "энергокод",
  ].some((keyword) => normalized.includes(keyword));
}

const MEDIA_SEARCH_STOPWORDS = new Set([
  "find",
  "show",
  "search",
  "photo",
  "photos",
  "picture",
  "image",
  "video",
  "media",
  "upload",
  "найди",
  "покажи",
  "фото",
  "видео",
  "медиа",
  "где",
  "что",
  "это",
  "мне",
  "по",
  "на",
  "в",
  "и",
  "или",
]);

function getSearchTerms(question: string): string[] {
  return uniqueList(
    normalizeSearchText(question)
      .split(/[^a-zа-яё0-9]+/i)
      .filter((term) => term.length >= 3 && !MEDIA_SEARCH_STOPWORDS.has(term)),
    12,
  );
}

function findRelatedMemory(question: string, snapshot: AssistantSnapshot, limit = 3): string[] {
  const terms = getSearchTerms(question);
  if (terms.length === 0) return snapshot.memoryRules.slice(0, limit).map((rule) => rule.text);

  return snapshot.memoryRules
    .map((rule) => {
      const text = rule.text.toLowerCase();
      const score = terms.reduce((sum, term) => sum + (text.includes(term) ? 1 : 0), 0);
      return { rule, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.rule.text)
    .slice(0, limit);
}

function mediaSearchText(item: SnapshotMediaItem): string {
  return [
    item.projectName,
    item.uploadedByName ?? "",
    item.mediaType,
    item.filename,
    item.caption ?? "",
    item.tags.join(" "),
    item.summary ?? "",
    item.isCheckout ? "checkout выход смена proof доказательство" : "",
  ]
    .join(" ")
    .toLowerCase();
}

function findMediaMatches(question: string, snapshot: AssistantSnapshot): SnapshotMediaItem[] {
  const terms = getSearchTerms(question);
  if (terms.length === 0) return snapshot.mediaIndex.slice(0, 6);

  return snapshot.mediaIndex
    .map((item) => {
      const haystack = mediaSearchText(item);
      const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
      return { item, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || right.item.createdAt.localeCompare(left.item.createdAt))
    .map((entry) => entry.item)
    .slice(0, 8);
}

function buildMediaSearchFallback(
  question: string,
  snapshot: AssistantSnapshot,
): AssistantResult | null {
  const normalized = normalizeSearchText(question);
  if (!isMediaSearchQuestion(normalized)) return null;

  const ru = isRussianText(question);
  const matches = findMediaMatches(question, snapshot);
  if (matches.length === 0) {
    return {
      answer: ru
        ? "В последних загрузках я не нашёл медиа под это описание. Лучше добавить подписи к фото/видео или запустить анализ медиа, тогда поиск станет точнее."
        : "I could not find matching media in the recent uploads. Add captions or run media analysis to make this search sharper.",
      bullets: snapshot.mediaIndex.slice(0, 4).map((item) =>
        `${item.projectName} • ${item.filename} • ${item.mediaType}`,
      ),
      links: [{ label: ru ? "Открыть хронологию" : "Open timeline", href: "/timeline" }],
      confidence: 0.46,
      source: "fallback",
    };
  }

  const firstProject = matches.find((item) => item.projectId)?.projectId ?? null;
  return {
    answer: ru
      ? `Я нашёл ${matches.length} похожих загрузок. Самые близкие ниже.`
      : `I found ${matches.length} likely matching uploads. The closest ones are below.`,
    bullets: matches.map((item) =>
      [
        `${item.projectName} • ${item.mediaType}${item.isCheckout ? " checkout" : ""}`,
        item.filename,
        item.caption ? `caption: ${item.caption}` : "",
        item.summary ? `AI: ${item.summary}` : "",
      ]
        .filter(Boolean)
        .join(" — "),
    ),
    links: [
      firstProject
        ? { label: ru ? "Открыть проект" : "Open project", href: `/projects/${firstProject}` }
        : { label: ru ? "Открыть хронологию" : "Open timeline", href: "/timeline" },
      { label: ru ? "Настройки Jarvis" : "Jarvis settings", href: "/ai" },
    ],
    confidence: 0.72,
    source: "fallback",
  };
}

function isMaterialSpendQuestion(normalized: string): boolean {
  const hasMaterial = ["material", "materials", "материал"].some((keyword) =>
    normalized.includes(keyword),
  );
  const hasSpend = [
    "spend",
    "spent",
    "cost",
    "costs",
    "receipt",
    "receipts",
    "expense",
    "expenses",
    "how much",
    "сколько",
    "потрач",
    "расход",
    "стоим",
    "чек",
  ].some((keyword) => normalized.includes(keyword));

  return hasMaterial && hasSpend;
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
    "hi",
    "hello",
    "hey",
    "good morning",
    "good afternoon",
    "good evening",
  ]);

  if (exactGreetings.has(compact)) return true;

  const shortGreeting =
    compact.length <= 32 &&
    ["привет", "здравств", "добрый", "доброе", "hi", "hello", "hey"].some((token) =>
      compact.startsWith(token),
    );
  const asksPresence =
    compact.length <= 40 &&
    ["ты на связи", "джарвис на связи", "jarvis are you there", "are you there"].some((token) =>
      compact.includes(token),
    );

  return shortGreeting || asksPresence;
}

function buildGreetingFallback(
  question: string,
  snapshot: AssistantSnapshot,
): AssistantResult | null {
  const normalized = normalizeSearchText(question);
  if (!isGreetingQuestion(normalized)) return null;

  const ru = isRussianText(question);
  const financeLine = snapshot.hasFinanceAccess
    ? ru
      ? `Материалы по обзору: ${formatMoney(snapshot.receiptTotal)}.`
      : `Overview materials: ${formatMoney(snapshot.receiptTotal)}.`
    : ru
      ? "Финансы скрыты для этого режима."
      : "Finance is hidden in this mode.";

  return {
    answer: ru
      ? `На связи. Вижу текущую картину: ${snapshot.onSiteCount} на объекте, ${snapshot.activeProjectCount} активных проектов, ${snapshot.openTaskCount} открытых задач.`
      : `Online. I see ${snapshot.onSiteCount} on site, ${snapshot.activeProjectCount} active projects, and ${snapshot.openTaskCount} open tasks.`,
    bullets: uniqueList(
      [
        financeLine,
        snapshot.recentShifts[0]
          ? ru
            ? `Последняя смена: ${snapshot.recentShifts[0].workerName} на ${snapshot.recentShifts[0].projectName}, ${formatHours(snapshot.recentShifts[0].durationMinutes / 60)}.`
            : `Latest shift: ${snapshot.recentShifts[0].workerName} on ${snapshot.recentShifts[0].projectName}, ${formatHours(snapshot.recentShifts[0].durationMinutes / 60)}.`
          : ru
            ? "Последних смен в снимке нет."
            : "No recent shifts are present in the snapshot.",
        ru
          ? "Можете спросить по проекту, человеку, материалам, сменам, задачам, фото или PDF."
          : "Ask about a project, person, materials, shifts, tasks, photos, or PDFs.",
      ],
      4,
    ),
    links: [
      { label: ru ? "Открыть обзор" : "Open overview", href: "/overview" },
      { label: ru ? "Открыть проекты" : "Open projects", href: "/projects" },
    ],
    confidence: 0.86,
    source: "fallback",
  };
}

function buildMaterialSpendFallback(
  question: string,
  snapshot: AssistantSnapshot,
): AssistantResult | null {
  const normalized = normalizeSearchText(question);
  if (!isMaterialSpendQuestion(normalized)) return null;

  const ru = isRussianText(question);
  if (!snapshot.hasFinanceAccess) {
    return {
      answer: ru
        ? "Финансовые данные по материалам закрыты для этого аккаунта."
        : "Material spending is financially restricted for this account.",
      bullets: [
        ru
          ? `${snapshot.openTaskCount} открытых задач доступны без финансов.`
          : `${snapshot.openTaskCount} open tasks are still visible without finance access.`,
      ],
      links: [{ label: ru ? "Открыть проекты" : "Open projects", href: "/projects" }],
      confidence: 0.78,
      source: "fallback",
    };
  }

  const project = findProjectInSnapshot(question, snapshot);
  const targetProjects = project ? [project] : snapshot.projects;
  const total = project ? project.receiptTotal : snapshot.receiptTotal;
  const today = project ? project.receiptToday : snapshot.receiptToday;
  const count = project ? project.receiptCount : snapshot.receiptCount;
  const recentReceipts = targetProjects
    .flatMap((item) => item.recentReceipts)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 6);
  const topProjects = [...snapshot.projects]
    .filter((item) => item.receiptTotal > 0)
    .sort((left, right) => right.receiptTotal - left.receiptTotal)
    .slice(0, 5);

  return {
    answer: project
      ? ru
        ? `По проекту ${project.name} по чекам материалов записано ${formatMoney(total)}. Сегодня: ${formatMoney(today)}. Чеков: ${count}.`
        : `${project.name} has ${formatMoney(total)} in material receipts. Today: ${formatMoney(today)}. Receipts: ${count}.`
      : ru
        ? `По всем проектам по чекам материалов записано ${formatMoney(total)}. Сегодня: ${formatMoney(today)}. Чеков: ${count}.`
        : `Across all projects, material receipts total ${formatMoney(total)}. Today: ${formatMoney(today)}. Receipts: ${count}.`,
    bullets: uniqueList(
      [
        ru
          ? "Источник: та же формула, что карточка «Материалы» в обзоре — только чеки receipt, привязанные к проектам."
          : "Source: the same formula as the Overview Materials card — project-linked uploads marked as receipt only.",
        ...recentReceipts.map((receipt) =>
          `${receipt.projectName} • ${formatMoney(receipt.amount)} • ${
            receipt.storeName || receipt.filename
          } • ${receipt.purchaseDate ?? receipt.createdAt.slice(0, 10)}`,
        ),
        ...(!project
          ? topProjects.map((item) => `${item.name}: ${formatMoney(item.receiptTotal)} (${item.receiptCount} receipts)`)
          : []),
        count === 0
          ? ru
            ? "В текущем снимке нет чеков с суммой. Проверьте, что чеки загружены как receipt и заполнено поле amount."
            : "No receipt amounts are present in the snapshot. Confirm uploads are marked as receipt and amount is filled."
          : "",
      ],
      8,
    ),
    links: [
      project
        ? { label: ru ? `Открыть ${project.name}` : `Open ${project.name}`, href: `/projects/${project.id}` }
        : { label: ru ? "Открыть обзор" : "Open overview", href: "/overview" },
      { label: ru ? "Открыть проекты" : "Open projects", href: "/projects" },
    ],
    confidence: 0.86,
    source: "fallback",
  };
}

const ESTIMATE_HOUR_RANGES: Record<string, { low: number; high: number; label: string }> = {
  framing: { low: 8, high: 28, label: "framing / каркас" },
  drywall: { low: 10, high: 32, label: "drywall / гипсокартон" },
  mudding: { low: 14, high: 42, label: "mudding / шпаклевка" },
  painting: { low: 8, high: 30, label: "painting / покраска" },
  tile: { low: 12, high: 48, label: "tile / плитка" },
  flooring: { low: 10, high: 36, label: "flooring / полы" },
  plumbing: { low: 6, high: 24, label: "plumbing / сантехника" },
  electrical: { low: 6, high: 24, label: "electrical / электрика" },
  demo: { low: 6, high: 22, label: "demo / демонтаж" },
  concrete: { low: 12, high: 50, label: "concrete / бетон" },
  roofing: { low: 16, high: 64, label: "roofing / кровля" },
  trim: { low: 8, high: 32, label: "trim / финишные планки" },
  finish: { low: 10, high: 40, label: "finish work / финиш" },
  cleanup: { low: 4, high: 12, label: "cleanup / уборка" },
  delivery: { low: 2, high: 8, label: "delivery / доставка" },
  inspection: { low: 1, high: 4, label: "inspection / проверка" },
};

function buildEstimateFallback(
  question: string,
  snapshot: AssistantSnapshot,
): AssistantResult | null {
  const normalized = normalizeSearchText(question);
  if (!isEstimateQuestion(normalized)) return null;

  const ru = isRussianText(question);
  const project = findProjectInSnapshot(question, snapshot);
  const requestedSkills = uniqueList(
    [
      ...inferSkillTagsFromText(question),
      ...(project?.skillTags ?? []),
    ],
    6,
  );
  const skills = requestedSkills.length > 0 ? requestedSkills : ["finish"];
  const ranges = skills.map((skill) => ESTIMATE_HOUR_RANGES[skill]).filter(Boolean);
  const low = ranges.reduce((sum, range) => sum + range.low, 0) || 8;
  const high = ranges.reduce((sum, range) => sum + range.high, 0) || 28;
  const candidates =
    snapshot.assignmentSuggestions
      .filter((suggestion) => (project ? suggestion.projectId === project.id : true))
      .flatMap((suggestion) => suggestion.candidates)
      .slice(0, 4);
  const crewSize = Math.max(1, Math.min(3, candidates.length || snapshot.liveWorkers.length || 2));
  const dailyCrewHours = crewSize * 7;
  const lowDays = Math.max(1, Math.ceil(low / dailyCrewHours));
  const highDays = Math.max(lowDays, Math.ceil(high / dailyCrewHours));

  return {
    answer: ru
      ? `Черновой эстимейт: ${low}-${high} человеко-часов, примерно ${lowDays}-${highDays} рабочих дней бригадой ${crewSize} чел.`
      : `Planning estimate: ${low}-${high} labor hours, roughly ${lowDays}-${highDays} work days with a ${crewSize}-person crew.`,
    bullets: uniqueList(
      [
        ...findRelatedMemory(question, snapshot).map((rule) =>
          ru ? `Правило: ${rule}` : `Saved rule: ${rule}`,
        ),
        ru
          ? `Работы распознаны: ${ranges.map((range) => range.label).join(", ") || "общая отделка"}.`
          : `Detected scopes: ${ranges.map((range) => range.label).join(", ") || "general finish work"}.`,
        project
          ? ru
            ? `Проект: ${project.name}; открытые задачи: ${project.openTaskTitles.join("; ") || "нет в снимке"}.`
            : `Project: ${project.name}; open tasks: ${project.openTaskTitles.join("; ") || "none in snapshot"}.`
          : ru
            ? "Проект не распознан из вопроса, поэтому оценка общая."
            : "No specific project was recognized, so this is a generic estimate.",
        candidates.length > 0
          ? ru
            ? `Потенциальные исполнители: ${uniqueList(candidates.map((candidate) => candidate.name), 4).join(", ")}.`
            : `Potential crew: ${uniqueList(candidates.map((candidate) => candidate.name), 4).join(", ")}.`
          : "",
        ru
          ? "Перед ценой для клиента нужно добавить материалы, доступность объекта, инспекции, риск переделки и city/AHJ требования."
          : "Before quoting a customer, add materials, access constraints, inspections, rework risk, and local AHJ requirements.",
      ],
      5,
    ),
    links: [
      project
        ? { label: ru ? `Открыть ${project.name}` : `Open ${project.name}`, href: `/projects/${project.id}` }
        : { label: ru ? "Открыть проекты" : "Open projects", href: "/projects" },
      { label: ru ? "Открыть команду" : "Open team", href: "/team" },
    ],
    confidence: requestedSkills.length > 0 || project ? 0.66 : 0.44,
    source: "fallback",
  };
}

function buildShiftActivityFallback(
  question: string,
  snapshot: AssistantSnapshot,
  worker: ReturnType<typeof findWorkerInSnapshot>,
): AssistantResult | null {
  const normalized = normalizeSearchText(question);
  const ru = isRussianText(question);
  const asksShift =
    normalized.includes("shift") ||
    normalized.includes("смен") ||
    normalized.includes("last work") ||
    normalized.includes("последн") ||
    normalized.includes("перерыв");

  if (!asksShift) {
    return null;
  }

  const shifts = (worker
    ? snapshot.recentShifts.filter((shift) => shift.workerName === worker.name)
    : snapshot.recentShifts
  ).slice(0, 8);

  if (shifts.length === 0) {
    return {
      answer: worker
        ? ru
          ? `По ${worker.name} смены в текущем снимке не записаны.`
          : `No recent shifts are recorded for ${worker.name} in the current snapshot.`
        : ru
          ? "В текущем снимке нет последних смен."
          : "No recent shifts are recorded in the current snapshot.",
      bullets: [],
      links: [{ label: ru ? "Открыть хронологию" : "Open timeline", href: "/timeline" }],
      confidence: 0.62,
      source: "fallback",
    };
  }

  const latest = shifts[0];
  return {
    answer: worker
      ? ru
        ? `Последняя смена ${worker.name}: ${latest.projectName}, ${formatHours(latest.durationMinutes / 60)}.`
        : `${worker.name}'s latest shift: ${latest.projectName}, ${formatHours(latest.durationMinutes / 60)}.`
      : ru
        ? `Последняя смена: ${latest.workerName} на ${latest.projectName}, ${formatHours(latest.durationMinutes / 60)}.`
        : `Latest shift: ${latest.workerName} on ${latest.projectName}, ${formatHours(latest.durationMinutes / 60)}.`,
    bullets: shifts.map((shift) =>
      ru
        ? `${shift.workerName} • ${shift.projectName} • ${shift.clockInTime} → ${shift.clockOutTime ?? "открыта"} • ${formatHours(shift.durationMinutes / 60)} • ${shift.checkoutStatus}`
        : `${shift.workerName} • ${shift.projectName} • ${shift.clockInTime} → ${shift.clockOutTime ?? "open"} • ${formatHours(shift.durationMinutes / 60)} • ${shift.checkoutStatus}`,
    ),
    links: [
      worker
        ? { label: ru ? "Открыть профиль" : "Open profile", href: `/team/${worker.id}` }
        : { label: ru ? "Открыть хронологию" : "Open timeline", href: "/timeline" },
    ],
    confidence: 0.74,
    source: "fallback",
  };
}

function buildCodeGuidanceFallback(
  question: string,
  snapshot: AssistantSnapshot,
): AssistantResult | null {
  const normalized = normalizeSearchText(question);
  if (!isCodeQuestion(normalized)) return null;

  const ru = isRussianText(question);
  const references = findWashingtonCodeReferences(question).slice(0, 4);
  return {
    answer: ru
      ? "По кодам Вашингтона я могу быть чеклистом и навигатором, но финальное слово всегда за permit set, городом/округом и инспектором AHJ."
      : "For Washington code questions I can act as a checklist and navigator, but the permit set, local AHJ, and inspector are the final authority.",
    bullets: [
      ...(snapshot.memoryRules.length > 0
        ? [
            ru
              ? `Учитываю ваши правила: ${snapshot.memoryRules.slice(0, 3).map((rule) => rule.text).join(" | ")}.`
              : `Applying your saved rules: ${snapshot.memoryRules.slice(0, 3).map((rule) => rule.text).join(" | ")}.`,
          ]
        : []),
      ...references.map((reference) => `${reference.topic}: ${reference.summary}`),
      ru
        ? "Для полевого решения: сделайте фото условия, привяжите к проекту, спросите Jarvis по этому объекту, затем сверяйте с AHJ."
        : "For field decisions: attach a condition photo to the project, ask Jarvis against that project, then verify with AHJ.",
    ],
    links: references.map((reference) => ({
      label: reference.sourceLabel,
      href: reference.url,
    })),
    confidence: 0.63,
    source: "fallback",
  };
}

function buildAttachmentFallback(
  question: string,
  attachments: JarvisAttachment[],
): AssistantResult | null {
  if (attachments.length === 0) return null;
  const ru = isRussianText(question);
  const readable = attachments.filter((attachment) => attachment.content);
  const images = attachments.filter((attachment) => attachment.dataUrl);

  return {
    answer: ru
      ? `Я получил ${attachments.length} файл(ов). ${
          images.length > 0
            ? "Фото подготовлено для Gemini Vision; если ответ остался резервным, значит ключ Gemini ещё не подключён или лимит API пуст."
            : readable.length > 0
              ? "Текстовые части могу использовать в ответе."
              : "Текст внутри этих файлов не читается браузером, но имя и тип я вижу."
        }`
      : `I received ${attachments.length} file(s). ${
          images.length > 0
            ? "The image is ready for Gemini vision; if this is still a fallback answer, the Gemini key is missing or the API quota is empty."
            : readable.length > 0
              ? "I can use the readable text parts in the answer."
              : "The browser did not provide readable text, but I can see names and types."
        }`,
    bullets: attachments.map((attachment) =>
      `${attachment.filename}${attachment.mimeType ? ` • ${attachment.mimeType}` : ""}${
        attachment.content ? ` • ${Math.min(attachment.content.length, MAX_JARVIS_ATTACHMENT_CHARS)} chars` : ""
      }${
        attachment.dataUrl ? " • image-ready" : ""
      }`,
    ),
    links: [{ label: ru ? "Настройки Jarvis" : "Jarvis settings", href: "/ai" }],
    confidence: images.length > 0 ? 0.52 : readable.length > 0 ? 0.58 : 0.34,
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
  snapshot: AssistantSnapshot,
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
        ? "Могу создать проект, но мне нужно название. Скажите, например: «Jarvis, создай проект Home по адресу 30820 42nd Ave S»."
        : "I can create a project, but I need the name. For example: “Jarvis, create project Home, address 30820 42nd Ave S.”",
      bullets: [
        ru
          ? "Создание проекта безопасное, но я всё равно покажу кнопку подтверждения."
          : "Project creation is a safe action, but I will still show a confirmation button.",
      ],
      links: [{ label: ru ? "Открыть проекты" : "Open projects", href: "/projects" }],
      confidence: 0.7,
      source: "fallback",
    };
  }

  return {
    answer: ru
      ? `Я подготовил создание проекта "${draft.name}". Я не удаляю, не оплачиваю и не отправляю сообщения без отдельного подтверждения.`
      : `I prepared project "${draft.name}". I do not delete, pay, or message workers without separate confirmation.`,
    bullets: [
      draft.address
        ? ru
          ? `Адрес: ${draft.address}.`
          : `Address: ${draft.address}.`
        : ru
          ? "GPS/адрес можно уточнить после создания."
          : "Address/GPS can be refined after creation.",
      draft.startDate || draft.endDate
        ? ru
          ? `Даты: ${draft.startDate ?? "не задано"} -> ${draft.endDate ?? "не задано"}.`
          : `Dates: ${draft.startDate ?? "not set"} -> ${draft.endDate ?? "not set"}.`
        : "",
      ru
        ? `Сейчас в системе ${snapshot.activeProjectCount} активных проектов.`
        : `${snapshot.activeProjectCount} active projects are currently in the system.`,
    ].filter(Boolean),
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

function buildAssistantFallback(
  question: string,
  snapshot: AssistantSnapshot,
  attachments: JarvisAttachment[] = [],
): AssistantResult {
  const normalized = normalizeSearchText(question);
  const ru = isRussianText(question);
  const liveWorkerNames = snapshot.liveWorkers.map((worker) => worker.name);
  const projectRoute = findProjectRoute(question, snapshot);
  const worker = findWorkerInSnapshot(question, snapshot);

  const greetingAnswer = buildGreetingFallback(question, snapshot);
  if (greetingAnswer) return greetingAnswer;

  if (normalized.includes("что ты помнишь") || normalized.includes("what do you remember")) {
    return {
      answer: snapshot.memoryRules.length > 0
        ? ru
          ? `Я помню ${snapshot.memoryRules.length} правил(а) по вашей организации.`
          : `I remember ${snapshot.memoryRules.length} operating rule(s) for this org.`
        : ru
          ? "Пока сохранённых правил нет. Напишите: «запомни: ...», и я начну учитывать это дальше."
          : "No saved rules yet. Write: “remember: ...” and I will start using it.",
      bullets: snapshot.memoryRules.slice(0, 10).map((rule) => rule.text),
      links: [{ label: ru ? "Настройки Jarvis" : "Jarvis settings", href: "/ai" }],
      confidence: 0.82,
      source: "fallback",
    };
  }

  const mediaAnswer = buildMediaSearchFallback(question, snapshot);
  if (mediaAnswer) return mediaAnswer;

  const materialSpendAnswer = buildMaterialSpendFallback(question, snapshot);
  if (materialSpendAnswer) return materialSpendAnswer;

  const estimateAnswer = buildEstimateFallback(question, snapshot);
  if (estimateAnswer) return estimateAnswer;

  const codeAnswer = buildCodeGuidanceFallback(question, snapshot);
  if (codeAnswer) return codeAnswer;

  const attachmentAnswer = buildAttachmentFallback(question, attachments);
  if (attachmentAnswer && normalized.length < 24) return attachmentAnswer;

  const safeActionAnswer = buildSafeActionFallback(question, snapshot);
  if (safeActionAnswer) return safeActionAnswer;

  const shiftActivityAnswer = buildShiftActivityFallback(question, snapshot, worker);
  if (shiftActivityAnswer) return shiftActivityAnswer;

  if (!snapshot.hasFinanceAccess && isFinancialQuestion(normalized)) {
    return {
      answer: ru
        ? "Финансовые данные для этого аккаунта закрыты. Я могу ответить по проектам, задачам, медиа и активности команды."
        : "Financial details are restricted for this account. You can still review operational project status, tasks, media, and crew activity.",
      bullets: [
        ru
          ? `${snapshot.onSiteCount} сейчас на объекте.`
          : `${snapshot.onSiteCount} workers are currently on site.`,
        ru
          ? `${snapshot.openTaskCount} открытых задач по организации.`
          : `${snapshot.openTaskCount} tasks remain open across the org.`,
      ],
      links: [{ label: ru ? "Открыть обзор" : "Open overview", href: "/overview" }],
      confidence: 0.78,
      source: "fallback",
    };
  }

  if (wantsAssignmentAdvice(normalized)) {
    const suggestion = findBestAssignmentSuggestion(question, snapshot);
    if (suggestion) {
      const top = suggestion.candidates[0] ?? null;
      return {
        answer: top
          ? ru
            ? `Для задачи "${suggestion.taskTitle}" на проекте ${suggestion.projectName} я бы первым смотрел на ${top.name}.`
            : `For "${suggestion.taskTitle}" on ${suggestion.projectName}, I would look at ${top.name} first.`
          : ru
            ? `Для задачи "${suggestion.taskTitle}" пока нет сильного совпадения по навыкам.`
            : `I do not see a strong skill match yet for "${suggestion.taskTitle}".`,
        bullets: uniqueList(
          [
            ...findRelatedMemory(question, snapshot).map((rule) =>
              ru ? `Правило: ${rule}` : `Saved rule: ${rule}`,
            ),
            suggestion.requiredSkills.length > 0
              ? ru
                ? `Нужно: ${skillListLabel(suggestion.requiredSkills, true)}.`
                : `Needed: ${skillListLabel(suggestion.requiredSkills, false)}.`
              : "",
            ...suggestion.candidates.slice(0, 5).map((candidate) =>
              ru
                ? `${candidate.name} (${candidate.role}) - ${
                    candidate.matchedSkills.length > 0
                      ? `совпадает: ${skillListLabel(candidate.matchedSkills, true)}`
                      : candidate.reason
                  }`
                : `${candidate.name} (${candidate.role}) - ${candidate.reason}`,
            ),
          ],
          6,
        ),
        links: [
          suggestion.projectId
            ? {
                label: ru ? `Открыть ${suggestion.projectName}` : `Open ${suggestion.projectName}`,
                href: `/projects/${suggestion.projectId}`,
              }
            : { label: ru ? "Открыть задачи" : "Open tasks", href: "/tasks" },
          { label: ru ? "Открыть команду" : "Open team", href: "/team" },
        ],
        confidence: top ? 0.78 : 0.52,
        source: "fallback",
      };
    }

    const requestedSkills = inferSkillTagsFromText(question);
    const skillMatches = requestedSkills.length > 0
      ? snapshot.workerMetrics
          .filter((candidate) =>
            requestedSkills.some((skill) => candidate.skills.includes(skill)),
          )
          .slice(0, 8)
      : [];
    if (skillMatches.length > 0) {
      return {
        answer: ru
          ? `По навыкам ${skillListLabel(requestedSkills, true)} подходят: ${skillMatches.map((candidate) => candidate.name).join(", ")}.`
          : `For ${skillListLabel(requestedSkills, false)}, these people match: ${skillMatches.map((candidate) => candidate.name).join(", ")}.`,
        bullets: skillMatches.map((candidate) =>
          ru
            ? `${candidate.name} (${candidate.role}) - ${skillListLabel(candidate.skills, true)}`
            : `${candidate.name} (${candidate.role}) - ${skillListLabel(candidate.skills, false)}`,
        ),
        links: [{ label: ru ? "Открыть команду" : "Open team", href: "/team" }],
        confidence: 0.7,
        source: "fallback",
      };
    }
  }

  if (worker) {
    return {
      answer: ru
        ? `${worker.name}: ${formatHours(worker.monthHours)} за текущий месяц и ${worker.completedTasksThisMonth} закрытых задач.`
        : `${worker.name}: ${formatHours(worker.monthHours)} this month and ${worker.completedTasksThisMonth} completed tasks.`,
      bullets: uniqueList(
        [
          ...findRelatedMemory(question, snapshot).map((rule) =>
            ru ? `Правило: ${rule}` : `Saved rule: ${rule}`,
          ),
          worker.currentProjectName
            ? ru
              ? `Сейчас на проекте: ${worker.currentProjectName}.`
              : `Current project: ${worker.currentProjectName}.`
            : ru
              ? "Сейчас не на смене."
              : "Not currently clocked in.",
          worker.assignedProjectNames.length > 0
            ? ru
              ? `Доступ/назначения: ${worker.assignedProjectNames.join(", ")}.`
              : `Assigned/visible projects: ${worker.assignedProjectNames.join(", ")}.`
            : "",
          worker.skills.length > 0
            ? ru
              ? `Навыки: ${skillListLabel(worker.skills, true)}.`
              : `Skills: ${skillListLabel(worker.skills, false)}.`
            : ru
              ? "Навыки пока не заполнены в профиле."
              : "No skills are recorded on this profile yet.",
          worker.capabilitiesNote
            ? ru
              ? `Заметка: ${worker.capabilitiesNote}`
              : `Note: ${worker.capabilitiesNote}`
            : "",
          ru
            ? `Открытых задач на нём: ${worker.openTaskCount}.`
            : `Open tasks assigned: ${worker.openTaskCount}.`,
        ],
        6,
      ),
      links: [{ label: ru ? "Открыть профиль" : "Open profile", href: `/team/${worker.id}` }],
      confidence: 0.76,
      source: "fallback",
    };
  }

  if (
    (normalized.includes("who") && normalized.includes("site")) ||
    (normalized.includes("кто") && (normalized.includes("объект") || normalized.includes("смен")))
  ) {
    return {
      answer: liveWorkerNames.length > 0
        ? ru
          ? `Сейчас на смене: ${liveWorkerNames.join(", ")}.`
          : `${liveWorkerNames.join(", ")} ${liveWorkerNames.length === 1 ? "is" : "are"} currently clocked in.`
        : ru
          ? "Сейчас никто не на смене."
          : "Nobody is currently clocked in.",
      bullets: snapshot.liveWorkers.map((worker) => {
        const duration =
          worker.currentSessionMinutes === null
            ? ru ? "на смене" : "live now"
            : ru ? `${worker.currentSessionMinutes}м на смене` : `${worker.currentSessionMinutes}m on shift`;
        return `${worker.name} • ${worker.projectName ?? (ru ? "Проект не определён" : "Unresolved project")} • ${duration}`;
      }),
      links: [
        { label: ru ? "Открыть обзор" : "Open overview", href: "/overview" },
        { label: ru ? "Открыть команду" : "Open team", href: "/team" },
      ],
      confidence: 0.74,
      source: "fallback",
    };
  }

  if (
    normalized.includes("payroll") ||
    normalized.includes("unpaid") ||
    normalized.includes("зарплат") ||
    normalized.includes("оплат")
  ) {
    return {
      answer: ru
        ? `В текущем черновике зарплаты ${snapshot.unpaidHours.toFixed(2)} неоплаченных часов на $${snapshot.unpaidAmount.toFixed(2)}.`
        : `There are ${snapshot.unpaidHours.toFixed(2)} unpaid hours worth $${snapshot.unpaidAmount.toFixed(2)} in the current payroll preview.`,
      bullets: [
        ru
          ? `${snapshot.onSiteCount} сейчас на объекте.`
          : `${snapshot.onSiteCount} workers are currently on site.`,
        ru
          ? `${snapshot.openTaskCount} открытых задач по организации.`
          : `${snapshot.openTaskCount} tasks remain open across the org.`,
      ],
      links: [{ label: ru ? "Открыть зарплату" : "Open payroll", href: "/payroll" }],
      confidence: 0.71,
      source: "fallback",
    };
  }

  if (
    normalized.includes("efficiency") ||
    normalized.includes("efficient") ||
    normalized.includes("leader") ||
    normalized.includes("most hours") ||
    normalized.includes("most tasks") ||
    normalized.includes("эффектив") ||
    normalized.includes("больше всего") ||
    normalized.includes("час") ||
    normalized.includes("задач")
  ) {
    const hoursLeader = snapshot.workerMetrics.find((worker) => worker.monthHours > 0) ?? null;
    const taskLeader = [...snapshot.workerMetrics]
      .sort((left, right) => right.completedTasksThisMonth - left.completedTasksThisMonth)
      .find((worker) => worker.completedTasksThisMonth > 0) ?? null;

    return {
      answer: ru
        ? "Вот операционный рейтинг за текущий месяц по данным приложения."
        : "Here is the current month operational leaderboard from the app data I can see.",
      bullets: uniqueList(
        [
          hoursLeader
            ? ru
              ? `Больше всего часов: ${hoursLeader.name} (${hoursLeader.monthHours.toFixed(2)}h).`
              : `Most hours this month: ${hoursLeader.name} (${hoursLeader.monthHours.toFixed(2)}h).`
            : ru
              ? "За этот месяц часы пока не записаны."
              : "No hours are logged this month yet.",
          taskLeader
            ? ru
              ? `Больше всего закрытых задач: ${taskLeader.name} (${taskLeader.completedTasksThisMonth}).`
              : `Most completed tasks this month: ${taskLeader.name} (${taskLeader.completedTasksThisMonth}).`
            : ru
              ? "Закрытых задач за месяц пока нет."
              : "No completed tasks are recorded this month yet.",
          ...snapshot.workerMetrics
            .slice(0, 5)
            .map((worker) => `${worker.name}: ${worker.monthHours.toFixed(2)}h · ${worker.completedTasksThisMonth} tasks`),
        ],
        7,
      ),
      links: [
        { label: ru ? "Открыть команду" : "Open team", href: "/team" },
        { label: ru ? "Открыть хронологию" : "Open timeline", href: "/timeline" },
      ],
      confidence: 0.72,
      source: "fallback",
    };
  }

  if (projectRoute) {
    const project = snapshot.projects.find((item) => item.id === projectRoute.href.split("/").pop());
    const recentReport =
      snapshot.recentReports.find((report) => report.projectName.toLowerCase() === project?.name.toLowerCase()) ??
      null;

    return {
      answer: ru
        ? `${project?.name ?? "Этот проект"}: сейчас ${project?.onSiteWorkerCount ?? 0} на объекте и ${project?.openTaskCount ?? 0} открытых задач.`
        : `${project?.name ?? "That project"} currently has ${project?.onSiteWorkerCount ?? 0} worker${project?.onSiteWorkerCount === 1 ? "" : "s"} on site and ${project?.openTaskCount ?? 0} open task${project?.openTaskCount === 1 ? "" : "s"}.`,
      bullets: uniqueList(
        [
          project
            ? ru
              ? `${project.weekMinutes} минут записано за неделю.`
              : `${project.weekMinutes} minutes logged this week.`
            : "",
          project?.skillTags.length
            ? ru
              ? `Навыки по открытым задачам: ${skillListLabel(project.skillTags, true)}.`
              : `Open-task skills: ${skillListLabel(project.skillTags, false)}.`
            : "",
          recentReport?.summary ?? "",
          project?.status ? (ru ? `Статус: ${project.status}.` : `Status: ${project.status}.`) : "",
        ],
        4,
      ),
      links: [
        projectRoute
          ? {
              ...projectRoute,
              label: ru ? `Открыть ${project?.name ?? "проект"}` : projectRoute.label,
            }
          : { label: ru ? "Открыть проекты" : "Open projects", href: "/projects" },
        { label: ru ? "Открыть хронологию" : "Open timeline", href: "/timeline" },
      ],
      confidence: 0.7,
      source: "fallback",
    };
  }

  if (normalized.includes("task") || normalized.includes("задач")) {
    const busiestProject = [...snapshot.projects].sort((left, right) => {
      return right.openTaskCount - left.openTaskCount;
    })[0];

    return {
      answer: ru
        ? `Сейчас активно ${snapshot.openTaskCount} открытых задач.`
        : `${snapshot.openTaskCount} open tasks are active right now.`,
      bullets: busiestProject
        ? [
            ru
              ? `${busiestProject.name} сейчас самый нагруженный: ${busiestProject.openTaskCount} открытых задач.`
              : `${busiestProject.name} carries the heaviest queue with ${busiestProject.openTaskCount} open tasks.`,
          ]
        : [],
      links: [
        { label: ru ? "Открыть проекты" : "Open projects", href: "/projects" },
        { label: ru ? "Открыть хронологию" : "Open timeline", href: "/timeline" },
      ],
      confidence: 0.68,
      source: "fallback",
    };
  }

  return {
    answer: ru
      ? `${snapshot.orgName}: сейчас ${snapshot.onSiteCount} на объектах, ${snapshot.activeProjectCount} активных проектов и ${snapshot.openTaskCount} открытых задач.`
      : `${snapshot.orgName} has ${snapshot.onSiteCount} workers on site, ${snapshot.activeProjectCount} active projects, and ${snapshot.openTaskCount} open tasks right now.`,
    bullets: uniqueList(
      [
        ...findRelatedMemory(question, snapshot).map((rule) =>
          ru ? `Правило: ${rule}` : `Saved rule: ${rule}`,
        ),
        snapshot.hasFinanceAccess
          ? ru
            ? `${snapshot.unpaidHours.toFixed(2)} неоплаченных часов в черновике зарплаты.`
            : `${snapshot.unpaidHours.toFixed(2)} unpaid hours remain in the payroll preview.`
          : "",
        snapshot.assignmentSuggestions[0]
          ? ru
            ? `AI может предложить исполнителя для "${snapshot.assignmentSuggestions[0].taskTitle}".`
            : `AI can suggest a crew match for "${snapshot.assignmentSuggestions[0].taskTitle}".`
          : "",
        snapshot.recentReports[0]?.summary ?? (ru ? "Ежедневных отчётов пока нет." : "No daily reports have been generated yet."),
      ],
      3,
    ),
    links: [
      { label: ru ? "Открыть обзор" : "Open overview", href: "/overview" },
      { label: ru ? "Настройки Jarvis" : "Jarvis settings", href: "/ai" },
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
      answer: "Opening Jarvis settings and report skills.",
      actionLabel: "Jarvis settings",
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

function formatAssistantHistory(history: AssistantConversationTurn[]): string {
  if (history.length === 0) return "None";

  return history
    .slice(-10)
    .map((turn) => `${turn.role === "user" ? "Manager" : "Jarvis"}: ${turn.text.slice(0, 900)}`)
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
  const projectSummaries = buildProjectSummaries(data, sessions, {
    includeFinancials,
  });
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
    memoryRules: readJarvisMemory(data.org.settings),
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
    "You are Jarvis in worker-safe field mode for a construction workforce app. Return JSON only. Use only the supplied worker-visible context. Never mention payroll, rates, receipt amounts, profit, owner-only analytics, company financials, or hidden manager data. If a fact is not in the context, say it is not recorded for this worker.",
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
  const fallback = buildAssistantFallback(question, snapshot, attachments);
  const normalizedQuestion = normalizeSearchText(question);

  if (!snapshot.hasFinanceAccess && isFinancialQuestion(normalizedQuestion)) {
    return fallback;
  }
  if ((fallback.actions?.length ?? 0) > 0) {
    return fallback;
  }
  if (
    isGreetingQuestion(normalizedQuestion) ||
    isMaterialSpendQuestion(normalizedQuestion)
  ) {
    return fallback;
  }

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
    "You are Jarvis, an owner-side operating analyst inside a construction workforce app. Return JSON only. Use only the supplied app snapshot; if the snapshot does not contain a fact, say that it is not recorded yet. Behave like a practical analyst, payroll reviewer, dispatcher, and chief manager, but never invent app data. Proactively flag problems you notice in the snapshot, for example: 'Sir, three workers are approaching overtime today.'",
    [
      "Create a JSON object with keys:",
      "answer, bullets, links, confidence",
      "links must be an array of objects with label and href.",
      "If asked who should do work, use the worker skills and assignment suggestions below; never invent a skill.",
      "If asked for accounting/payroll analysis, use financial fields only when financial visibility is present.",
      "If asked about current totals, overview, materials, shifts, tasks, project documents, estimates, invoices, or change orders, use the snapshot first and answer with exact app numbers.",
      "If asked about Washington code, use the code reference pack as navigation only and say AHJ/permit set is final.",
      "If attached images are supplied to the model, inspect them directly. If only filenames or metadata are supplied, say that visual content is not available.",
      "Use the recent conversation to resolve follow-up words like 'him', 'that project', 'there', or 'same thing'.",
      `Recent conversation:\n${formatAssistantHistory(history)}`,
      `Question: ${question}`,
      `Org: ${snapshot.orgName}`,
      `On site count: ${snapshot.onSiteCount}`,
      `Active projects: ${snapshot.activeProjectCount}`,
      `Open tasks: ${snapshot.openTaskCount}`,
      `Crew count: ${snapshot.crewCount}`,
      `Today hours: ${snapshot.todayHours.toFixed(2)}`,
      ...financialPromptLines,
      `Saved owner rules / Jarvis memory:\n${formatJarvisMemoryForPrompt(snapshot.memoryRules)}`,
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
    ].join("\n"),
    attachments,
  );

  if (!modelObject) {
    return fallback;
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
    answer: getStringValue(modelResponse.answer, fallback.answer),
    bullets: getStringArray(modelResponse.bullets),
    links: links.length > 0 ? links : fallback.links,
    actions: fallback.actions,
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
