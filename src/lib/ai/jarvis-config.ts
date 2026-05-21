export const JARVIS_SYSTEM_PROMPT = `You are Jarvis, the AI operations assistant for Construction Clock.
You serve the owner as a calm, accurate construction operations copilot.

Core rules:
1. Answer briefly, truthfully, and only from supplied app context.
2. For greetings or wake words, answer only "Слушаю" or "Sir" and do not create actions.
3. Never claim that a project, task, message, payroll item, invoice, or document was created until the server action succeeds.
4. When a write action is needed, prepare the action and wait for owner confirmation.
5. If an action fails, say clearly that no change was completed.
6. Do not expose provider names, raw model errors, secrets, API keys, or hidden system details to normal users.
7. Do not touch payroll, roles, deletion, project access, financial records, or destructive actions without explicit owner approval and a server-side tool.`;

export const JARVIS_VOICE_PERSONALITY = [
  "Refined British butler AI assistant with subtle synthetic processing.",
  "Calm, composed, concise, premium, and operational.",
  "Do not imitate any specific actor, movie character, or copyrighted voice.",
].join(" ");

export const JARVIS_ACTION_POLICY = [
  "Read-only answers can be returned immediately.",
  "Low-risk drafts may be prepared.",
  "Write actions require an owner/admin confirmation button before execution.",
  "Task/project creation success is announced only after the database write succeeds.",
  "Payroll, roles, project access, deletion, and financial/destructive changes remain blocked unless a dedicated safe tool exists.",
].join(" ");

export type JarvisRuntimeConfig = {
  systemPrompt: string;
  voicePersonality: string;
  actionPolicy: string;
  hasSystemPromptOverride: boolean;
  hasVoicePersonalityOverride: boolean;
};

const SYSTEM_PROMPT_KEY = "jarvis_system_prompt_override";
const VOICE_PERSONALITY_KEY = "jarvis_voice_personality_override";
const MIN_SYSTEM_PROMPT_LENGTH = 80;
const MAX_SYSTEM_PROMPT_LENGTH = 8000;
const MIN_VOICE_PERSONALITY_LENGTH = 20;
const MAX_VOICE_PERSONALITY_LENGTH = 2000;

function readSettingsRecord(settings: unknown): Record<string, unknown> {
  return settings && typeof settings === "object" && !Array.isArray(settings)
    ? { ...(settings as Record<string, unknown>) }
    : {};
}

function readStringOverride(
  settings: Record<string, unknown>,
  key: string,
  fallback: string,
  minLength: number,
  maxLength: number,
) {
  const value = settings[key];
  if (typeof value !== "string") {
    return { value: fallback, hasOverride: false };
  }

  const trimmed = value.trim();
  if (trimmed.length < minLength || trimmed.length > maxLength) {
    return { value: fallback, hasOverride: false };
  }

  return { value: trimmed, hasOverride: true };
}

export function resolveJarvisRuntimeConfig(settings: unknown): JarvisRuntimeConfig {
  const record = readSettingsRecord(settings);
  const systemPrompt = readStringOverride(
    record,
    SYSTEM_PROMPT_KEY,
    JARVIS_SYSTEM_PROMPT,
    MIN_SYSTEM_PROMPT_LENGTH,
    MAX_SYSTEM_PROMPT_LENGTH,
  );
  const voicePersonality = readStringOverride(
    record,
    VOICE_PERSONALITY_KEY,
    JARVIS_VOICE_PERSONALITY,
    MIN_VOICE_PERSONALITY_LENGTH,
    MAX_VOICE_PERSONALITY_LENGTH,
  );

  return {
    systemPrompt: systemPrompt.value,
    voicePersonality: voicePersonality.value,
    actionPolicy: JARVIS_ACTION_POLICY,
    hasSystemPromptOverride: systemPrompt.hasOverride,
    hasVoicePersonalityOverride: voicePersonality.hasOverride,
  };
}

export function buildJarvisRuntimeSettings(
  currentSettings: unknown,
  input: {
    systemPrompt?: unknown;
    voicePersonality?: unknown;
    reset?: boolean;
  },
): Record<string, unknown> {
  const next = readSettingsRecord(currentSettings);

  if (input.reset) {
    delete next[SYSTEM_PROMPT_KEY];
    delete next[VOICE_PERSONALITY_KEY];
    return next;
  }

  const systemPrompt = typeof input.systemPrompt === "string" ? input.systemPrompt.trim() : "";
  const voicePersonality =
    typeof input.voicePersonality === "string" ? input.voicePersonality.trim() : "";

  if (
    systemPrompt.length < MIN_SYSTEM_PROMPT_LENGTH ||
    systemPrompt.length > MAX_SYSTEM_PROMPT_LENGTH
  ) {
    throw new Error("Jarvis system prompt must be between 80 and 8000 characters.");
  }
  if (
    voicePersonality.length < MIN_VOICE_PERSONALITY_LENGTH ||
    voicePersonality.length > MAX_VOICE_PERSONALITY_LENGTH
  ) {
    throw new Error("Jarvis voice instruction must be between 20 and 2000 characters.");
  }

  next[SYSTEM_PROMPT_KEY] = systemPrompt;
  next[VOICE_PERSONALITY_KEY] = voicePersonality;
  return next;
}
