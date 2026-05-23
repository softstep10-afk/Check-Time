const SENSITIVE_KEY_PATTERN =
  /(?:pin|password|token|secret|credential|authorization|cookie|service[_-]?role|api[_-]?key|access[_-]?token|refresh[_-]?token|database[_-]?url|postgres[_-]?url|signed[_-]?url)/i;

const SIGNED_URL_PATTERN =
  /https?:\/\/[^\s"'<>]*(?:token|signature|sig|X-Amz-Signature|X-Amz-Credential|X-Amz-Security-Token|access_token|refresh_token)[^\s"'<>]*/gi;
const DB_URL_PATTERN = /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s"'<>]+/gi;
const AUTH_HEADER_PATTERN = /\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_=.-]+/g;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const ENV_KEY_NAMES = [
  "SUPABASE" + "_SERVICE_ROLE_KEY",
  "DATABASE" + "_URL",
  "POSTGRES" + "_URL",
  "OPENAI" + "_API_KEY",
  "ANTHROPIC" + "_API_KEY",
  "GEMINI" + "_API_KEY",
  "GOOGLE_GENERATIVE_AI" + "_API_KEY",
];
const ENV_ASSIGNMENT_PATTERN = new RegExp(
  `\\b(?:${ENV_KEY_NAMES.join("|")})\\s*[:=]\\s*[^,\\s}]+`,
  "gi",
);
const GENERIC_SECRET_ASSIGNMENT_PATTERN =
  /\b(pin|password|token|access_token|refresh_token|secret|api_key)\s*([:=])\s*[^,\s}]+/gi;
const QUERY_SECRET_PATTERN =
  /([?&](?:token|access_token|refresh_token|signature|sig|X-Amz-Signature|X-Amz-Credential|X-Amz-Security-Token)=)[^&\s"'<>]+/gi;

export function redactText(value: string): string {
  return value
    .replace(SIGNED_URL_PATTERN, "[REDACTED_URL]")
    .replace(DB_URL_PATTERN, "[REDACTED_URL]")
    .replace(ENV_ASSIGNMENT_PATTERN, (match) => {
      const separator = match.includes("=") ? "=" : ":";
      return `${match.split(separator)[0]}${separator}[REDACTED]`;
    })
    .replace(AUTH_HEADER_PATTERN, "[REDACTED_AUTH]")
    .replace(GENERIC_SECRET_ASSIGNMENT_PATTERN, "$1$2[REDACTED]")
    .replace(JWT_PATTERN, "[REDACTED_JWT]")
    .replace(QUERY_SECRET_PATTERN, "$1[REDACTED]");
}

export function redactSensitive(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[REDACTED_DEPTH]";
  if (typeof value === "string") return redactText(value);
  if (typeof value === "number" || typeof value === "boolean" || value == null) {
    return value;
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactText(value.message),
    };
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item, depth + 1));
  }
  if (typeof value === "object") {
    const safe: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      safe[key] = SENSITIVE_KEY_PATTERN.test(key)
        ? "[REDACTED]"
        : redactSensitive(item, depth + 1);
    }
    return safe;
  }
  return String(value);
}

export function safeErrorForLog(error: unknown): unknown {
  return redactSensitive(error);
}

export function safeClientErrorMessage(
  error: unknown,
  fallback = "Internal server error",
): string {
  if (process.env.NODE_ENV === "production") return fallback;
  const message = error instanceof Error ? error.message : String(error);
  return redactText(message) || fallback;
}
