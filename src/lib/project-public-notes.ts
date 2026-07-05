export const PROJECT_PUBLIC_NOTES_KEY = "public_project_notes";

export type ProjectPublicNote = {
  id: string;
  text: string;
  authorId: string;
  authorName: string;
  createdAt: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function readText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function readProjectPublicNotes(settings: unknown): ProjectPublicNote[] {
  const raw = asRecord(settings)[PROJECT_PUBLIC_NOTES_KEY];
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item): ProjectPublicNote | null => {
      const record = asRecord(item);
      const id = readText(record.id);
      const text = readText(record.text);
      const authorId = readText(record.authorId);
      const authorName = readText(record.authorName);
      const createdAt = readText(record.createdAt);
      if (!id || !text || !authorId || !authorName || !createdAt) return null;
      return { id, text, authorId, authorName, createdAt };
    })
    .filter((note): note is ProjectPublicNote => note !== null)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export function appendProjectPublicNote(
  settings: unknown,
  note: ProjectPublicNote,
): Record<string, unknown> {
  const current = asRecord(settings);
  const notes = readProjectPublicNotes(current);
  return {
    ...current,
    [PROJECT_PUBLIC_NOTES_KEY]: [note, ...notes].slice(0, 100),
  };
}

export function formatProjectPublicNoteTime(
  value: string,
  locale: "en" | "ru" = "en",
): string {
  try {
    return new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-US", {
      month: "short",
      day: "2-digit",
      hourCycle: "h23",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}
