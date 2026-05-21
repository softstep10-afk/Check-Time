export type JarvisActionExecutionStatus =
  | "idle"
  | "prepared"
  | "awaiting_owner_confirmation"
  | "executing"
  | "succeeded"
  | "failed"
  | "unsupported"
  | "blocked";

export type JarvisDiagnosticRecord = {
  updatedAt: string;
  inputMode: "text" | "voice" | "action";
  userRequest: string;
  normalizedRequest: string;
  selectedIntent: string | null;
  preparedAction: unknown | null;
  executionStatus: JarvisActionExecutionStatus;
  dataSourcesUsed: string[];
  matchedWorker: string | null;
  matchedProject: string | null;
  executionEndpoint: string | null;
  resultId: string | null;
  providerModel: string | null;
  result: string | null;
  error: string | null;
};

export const JARVIS_DIAGNOSTIC_STORAGE_KEY = "check-time.jarvis.latestDiagnostic";
export const JARVIS_DIAGNOSTIC_HISTORY_KEY = "check-time.jarvis.diagnosticHistory";
export const JARVIS_DIAGNOSTIC_EVENT = "check-time:jarvis-diagnostic";
const MAX_JARVIS_DIAGNOSTIC_HISTORY = 20;

function sanitizeText(value: unknown, limit = 1200): string {
  return typeof value === "string"
    ? value
        .replace(/\b(undefined|null)\b/gi, "")
        .replace(/\b(?:sk|AIza|xoxb|ghp)_[A-Za-z0-9_\-]+/g, "[redacted]")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, limit)
    : "";
}

function sanitizeTextArray(value: unknown, limit = 12): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => sanitizeText(item, 80))
    .filter(Boolean)
    .slice(0, limit);
}

function sanitizeDiagnosticPayload(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[redacted-depth]";
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return sanitizeText(value, 600);
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeDiagnosticPayload(item, depth + 1));
  }
  if (typeof value !== "object") return null;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (/key|token|secret|password|credential|authorization|cookie|env/i.test(key)) {
      out[key] = "[redacted]";
      continue;
    }
    out[key] = sanitizeDiagnosticPayload(item, depth + 1);
  }
  return out;
}

export function buildJarvisDiagnostic(
  input: Partial<JarvisDiagnosticRecord>,
): JarvisDiagnosticRecord {
  const userRequest = sanitizeText(input.userRequest);
  return {
    updatedAt: input.updatedAt ?? new Date().toISOString(),
    inputMode: input.inputMode ?? "text",
    userRequest,
    normalizedRequest: sanitizeText(input.normalizedRequest || userRequest.toLowerCase()),
    selectedIntent: sanitizeText(input.selectedIntent ?? "") || null,
    preparedAction: sanitizeDiagnosticPayload(input.preparedAction ?? null),
    executionStatus: input.executionStatus ?? "idle",
    dataSourcesUsed: sanitizeTextArray(input.dataSourcesUsed),
    matchedWorker: sanitizeText(input.matchedWorker ?? "") || null,
    matchedProject: sanitizeText(input.matchedProject ?? "") || null,
    executionEndpoint: sanitizeText(input.executionEndpoint ?? "") || null,
    resultId: sanitizeText(input.resultId ?? "") || null,
    providerModel: sanitizeText(input.providerModel ?? "") || null,
    result: sanitizeText(input.result ?? "") || null,
    error: sanitizeText(input.error ?? "") || null,
  };
}

export function writeJarvisDiagnostic(input: Partial<JarvisDiagnosticRecord>): JarvisDiagnosticRecord {
  const record = buildJarvisDiagnostic(input);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(JARVIS_DIAGNOSTIC_STORAGE_KEY, JSON.stringify(record));
      const history = readJarvisDiagnosticHistory();
      window.localStorage.setItem(
        JARVIS_DIAGNOSTIC_HISTORY_KEY,
        JSON.stringify([record, ...history.filter((item) => item.updatedAt !== record.updatedAt)].slice(0, MAX_JARVIS_DIAGNOSTIC_HISTORY)),
      );
      window.dispatchEvent(new CustomEvent(JARVIS_DIAGNOSTIC_EVENT, { detail: record }));
    } catch {
      // Diagnostics are optional and must never block the assistant.
    }
  }
  return record;
}

export function readJarvisDiagnostic(): JarvisDiagnosticRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(JARVIS_DIAGNOSTIC_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<JarvisDiagnosticRecord>;
    return buildJarvisDiagnostic(parsed);
  } catch {
    return null;
  }
}

export function readJarvisDiagnosticHistory(): JarvisDiagnosticRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(JARVIS_DIAGNOSTIC_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => buildJarvisDiagnostic(item as Partial<JarvisDiagnosticRecord>))
      .slice(0, MAX_JARVIS_DIAGNOSTIC_HISTORY);
  } catch {
    return [];
  }
}
