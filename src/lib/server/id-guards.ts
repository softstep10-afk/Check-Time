const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type IdGuardResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; status: 400 };

export function readUuid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return UUID_PATTERN.test(trimmed) ? trimmed : null;
}

export function readRequiredUuid(
  value: unknown,
  label = "id",
): IdGuardResult<string> {
  const id = readUuid(value);
  if (!id) {
    return { ok: false, error: `Invalid ${label}.`, status: 400 };
  }
  return { ok: true, value: id };
}

export function readOptionalUuid(
  value: unknown,
  label = "id",
): IdGuardResult<string | null> {
  if (value == null) return { ok: true, value: null };
  if (typeof value === "string" && !value.trim()) {
    return { ok: true, value: null };
  }
  const id = readUuid(value);
  if (!id) {
    return { ok: false, error: `Invalid ${label}.`, status: 400 };
  }
  return { ok: true, value: id };
}

export function readUuidArray(
  value: unknown,
  {
    label = "ids",
    limit = 100,
  }: {
    label?: string;
    limit?: number;
  } = {},
): IdGuardResult<string[]> {
  if (!Array.isArray(value)) return { ok: true, value: [] };

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) continue;
    const id = readUuid(item);
    if (!id) {
      return { ok: false, error: `Invalid ${label}.`, status: 400 };
    }
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
    if (ids.length >= limit) break;
  }

  return { ok: true, value: ids };
}
