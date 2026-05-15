import type { Organization, Profile } from "@/types/database";

export type JarvisMemorySource = "manual" | "chat";

export interface JarvisMemoryRule {
  id: string;
  text: string;
  createdAt: string;
  createdBy: string | null;
  source: JarvisMemorySource;
}

export interface JarvisAttachment {
  filename: string;
  mimeType: string | null;
  content: string | null;
  dataUrl: string | null;
}

export const JARVIS_MEMORY_SETTINGS_KEY = "jarvis_memory";
export const MAX_JARVIS_MEMORY_RULES = 80;
export const MAX_JARVIS_ATTACHMENT_CHARS = 14_000;
export const MAX_JARVIS_IMAGE_DATA_URL_CHARS = 6_500_000;

const JARVIS_IMAGE_MIME_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const JARVIS_FILE_MIME_TYPES = new Set([
  ...JARVIS_IMAGE_MIME_TYPES,
  "application/pdf",
]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeMemoryText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function makeMemoryId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `mem_${crypto.randomUUID()}`;
  }

  return `mem_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function isJarvisMemoryWriter(profile: Pick<Profile, "role">): boolean {
  return profile.role === "owner" || profile.role === "admin";
}

export function readJarvisMemory(settings: unknown): JarvisMemoryRule[] {
  const raw = asRecord(settings)[JARVIS_MEMORY_SETTINGS_KEY];
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item): JarvisMemoryRule | null => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const record = item as Record<string, unknown>;
      const text = typeof record.text === "string" ? normalizeMemoryText(record.text) : "";
      if (!text) return null;

      const source = record.source === "manual" || record.source === "chat" ? record.source : "manual";
      return {
        id: typeof record.id === "string" && record.id ? record.id : makeMemoryId(),
        text,
        createdAt:
          typeof record.createdAt === "string" && record.createdAt
            ? record.createdAt
            : new Date(0).toISOString(),
        createdBy:
          typeof record.createdBy === "string" && record.createdBy
            ? record.createdBy
            : null,
        source,
      };
    })
    .filter((item): item is JarvisMemoryRule => Boolean(item))
    .slice(0, MAX_JARVIS_MEMORY_RULES);
}

export function writeJarvisMemorySettings(
  settings: unknown,
  memory: JarvisMemoryRule[],
): Record<string, unknown> {
  return {
    ...asRecord(settings),
    [JARVIS_MEMORY_SETTINGS_KEY]: memory
      .map((rule) => ({
        id: rule.id,
        text: normalizeMemoryText(rule.text),
        createdAt: rule.createdAt,
        createdBy: rule.createdBy,
        source: rule.source,
      }))
      .filter((rule) => rule.text)
      .slice(0, MAX_JARVIS_MEMORY_RULES),
  };
}

export function appendJarvisMemoryRule(args: {
  org: Pick<Organization, "settings">;
  text: string;
  createdBy: string | null;
  source: JarvisMemorySource;
  now?: string;
}): { settings: Record<string, unknown>; rule: JarvisMemoryRule; memory: JarvisMemoryRule[] } {
  const normalized = normalizeMemoryText(args.text);
  const current = readJarvisMemory(args.org.settings);
  const duplicate = current.find((rule) => rule.text.toLowerCase() === normalized.toLowerCase());

  if (duplicate) {
    return {
      settings: writeJarvisMemorySettings(args.org.settings, current),
      rule: duplicate,
      memory: current,
    };
  }

  const rule: JarvisMemoryRule = {
    id: makeMemoryId(),
    text: normalized,
    createdAt: args.now ?? new Date().toISOString(),
    createdBy: args.createdBy,
    source: args.source,
  };
  const memory = [rule, ...current].slice(0, MAX_JARVIS_MEMORY_RULES);

  return {
    settings: writeJarvisMemorySettings(args.org.settings, memory),
    rule,
    memory,
  };
}

export function removeJarvisMemoryRule(
  settings: unknown,
  id: string,
): { settings: Record<string, unknown>; memory: JarvisMemoryRule[] } {
  const memory = readJarvisMemory(settings).filter((rule) => rule.id !== id);
  return {
    settings: writeJarvisMemorySettings(settings, memory),
    memory,
  };
}

export function detectJarvisMemoryInstruction(input: string): string | null {
  const text = input.trim();
  const patterns = [
    /^(?:запомни|запомнить|сохрани правило|сохрани|правило)\s*[:\-—]\s*(.+)$/i,
    /^(?:remember|save rule|save this|rule)\s*[:\-—]\s*(.+)$/i,
    /(?:запомни|remember)\s+(?:что|that)\s+(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const rule = match?.[1] ? normalizeMemoryText(match[1]) : "";
    if (rule.length >= 6) return rule;
  }

  return null;
}

export function normalizeJarvisAttachments(value: unknown): JarvisAttachment[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item): JarvisAttachment | null => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const record = item as Record<string, unknown>;
      const filename = typeof record.filename === "string" ? record.filename.trim() : "";
      if (!filename) return null;
      const mimeType = typeof record.mimeType === "string" && record.mimeType.trim()
        ? record.mimeType.trim()
        : null;
      const content = typeof record.content === "string" && record.content.trim()
        ? record.content.slice(0, MAX_JARVIS_ATTACHMENT_CHARS)
        : null;
      const dataUrl = normalizeJarvisDataUrl(record.dataUrl, mimeType);

      return { filename, mimeType, content, dataUrl };
    })
    .filter((item): item is JarvisAttachment => Boolean(item))
    .slice(0, 5);
}

function normalizeJarvisDataUrl(value: unknown, mimeType: string | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_JARVIS_IMAGE_DATA_URL_CHARS) return null;
  if (!mimeType || !JARVIS_FILE_MIME_TYPES.has(mimeType.toLowerCase())) return null;
  const prefix = `data:${mimeType.toLowerCase()};base64,`;
  if (!trimmed.toLowerCase().startsWith(prefix)) return null;
  return trimmed;
}

export function hasJarvisImageData(attachments: JarvisAttachment[]): boolean {
  return attachments.some((item) => Boolean(item.dataUrl));
}

export function formatJarvisMemoryForPrompt(memory: JarvisMemoryRule[]): string {
  if (memory.length === 0) return "No saved owner rules yet.";

  return memory
    .slice(0, 30)
    .map((rule, index) => `${index + 1}. ${rule.text}`)
    .join("\n");
}

export function formatJarvisAttachmentsForPrompt(attachments: JarvisAttachment[]): string {
  if (attachments.length === 0) return "No attached files.";

  return attachments
    .map((item, index) => {
      const header = `${index + 1}. ${item.filename}${item.mimeType ? ` (${item.mimeType})` : ""}`;
      const excerpt = item.content
        ? item.content.slice(0, MAX_JARVIS_ATTACHMENT_CHARS)
        : item.dataUrl
          ? item.mimeType?.toLowerCase() === "application/pdf"
            ? "PDF data is supplied to the model for direct document reading."
            : "Image data is supplied to the multimodal model for direct visual inspection."
          : "No readable text content was provided for this file.";
      return `${header}\n${excerpt}`;
    })
    .join("\n\n");
}
