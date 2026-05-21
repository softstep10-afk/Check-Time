export type JarvisActionExecutionStatus =
  | "idle"
  | "prepared"
  | "awaiting_owner_confirmation"
  | "executing"
  | "succeeded"
  | "failed"
  | "unsupported";

export type JarvisDiagnosticRecord = {
  updatedAt: string;
  inputMode: "text" | "voice" | "action";
  userRequest: string;
  normalizedRequest: string;
  selectedIntent: string | null;
  preparedAction: unknown | null;
  executionStatus: JarvisActionExecutionStatus;
  result: string | null;
  error: string | null;
};

export const JARVIS_DIAGNOSTIC_STORAGE_KEY = "check-time.jarvis.latestDiagnostic";
export const JARVIS_DIAGNOSTIC_EVENT = "check-time:jarvis-diagnostic";

function sanitizeText(value: unknown, limit = 1200): string {
  return typeof value === "string"
    ? value.replace(/\b(undefined|null)\b/gi, "").replace(/\s+/g, " ").trim().slice(0, limit)
    : "";
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
    preparedAction: input.preparedAction ?? null,
    executionStatus: input.executionStatus ?? "idle",
    result: sanitizeText(input.result ?? "") || null,
    error: sanitizeText(input.error ?? "") || null,
  };
}

export function writeJarvisDiagnostic(input: Partial<JarvisDiagnosticRecord>): JarvisDiagnosticRecord {
  const record = buildJarvisDiagnostic(input);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(JARVIS_DIAGNOSTIC_STORAGE_KEY, JSON.stringify(record));
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
