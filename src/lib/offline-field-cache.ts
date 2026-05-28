export const OFFLINE_FIELD_CACHE_PREFIX = "cc_offline_field_cache:v1";
export const OFFLINE_FIELD_CACHE_MAX_CHARS = 1_500_000;

export type OfflineFieldCacheScope =
  | "worker-tasks"
  | "material-tasks"
  | "worker-projects"
  | "worker-project-detail"
  | "worker-task-detail"
  | "worker-messages";

export type OfflineFieldCacheActor = {
  actorId: string;
  orgId: string;
};

export type OfflineFieldSnapshot<T = unknown> = OfflineFieldCacheActor & {
  scope: OfflineFieldCacheScope;
  id: string | null;
  savedAt: string;
  payload: T;
};

export type OfflineFieldSnapshotMeta = Pick<
  OfflineFieldSnapshot,
  "actorId" | "orgId" | "scope" | "id" | "savedAt"
>;

const SECRET_KEY_PATTERN =
  /(^|_)(pin|pin_hash|token|secret|password|authorization|access_token|refresh_token|signed_url|signedurl|public_url|publicurl)(_|$)/i;

function encodePart(value: string | null | undefined): string {
  return encodeURIComponent(value || "__all__");
}

export function buildOfflineCacheKey(
  actorId: string,
  orgId: string,
  scope: OfflineFieldCacheScope,
  id?: string | null,
): string {
  return [
    OFFLINE_FIELD_CACHE_PREFIX,
    encodePart(orgId),
    encodePart(actorId),
    encodePart(scope),
    encodePart(id),
  ].join(":");
}

function scrubForOfflineCache(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (key, nestedValue) => {
      if (SECRET_KEY_PATTERN.test(key)) return undefined;
      return nestedValue;
    }),
  );
}

function readStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  return window.localStorage ?? null;
}

export function saveOfflineSnapshot<T>(
  actor: OfflineFieldCacheActor,
  scope: OfflineFieldCacheScope,
  payload: T,
  id?: string | null,
): boolean {
  const storage = readStorage();
  if (!storage) return false;
  try {
    const snapshot: OfflineFieldSnapshot = {
      actorId: actor.actorId,
      orgId: actor.orgId,
      scope,
      id: id ?? null,
      savedAt: new Date().toISOString(),
      payload: scrubForOfflineCache(payload),
    };
    const text = JSON.stringify(snapshot);
    if (text.length > OFFLINE_FIELD_CACHE_MAX_CHARS) return false;
    storage.setItem(buildOfflineCacheKey(actor.actorId, actor.orgId, scope, id), text);
    return true;
  } catch {
    return false;
  }
}

export function loadOfflineSnapshot<T = unknown>(
  actor: OfflineFieldCacheActor,
  scope: OfflineFieldCacheScope,
  id?: string | null,
): OfflineFieldSnapshot<T> | null {
  const storage = readStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(buildOfflineCacheKey(actor.actorId, actor.orgId, scope, id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OfflineFieldSnapshot<T>>;
    if (
      parsed.actorId !== actor.actorId ||
      parsed.orgId !== actor.orgId ||
      parsed.scope !== scope ||
      (parsed.id ?? null) !== (id ?? null) ||
      typeof parsed.savedAt !== "string" ||
      !("payload" in parsed)
    ) {
      return null;
    }
    return parsed as OfflineFieldSnapshot<T>;
  } catch {
    return null;
  }
}

export function getOfflineSnapshotMeta(
  actor: OfflineFieldCacheActor,
  scope: OfflineFieldCacheScope,
  id?: string | null,
): OfflineFieldSnapshotMeta | null {
  const snapshot = loadOfflineSnapshot(actor, scope, id);
  if (!snapshot) return null;
  return {
    actorId: snapshot.actorId,
    orgId: snapshot.orgId,
    scope: snapshot.scope,
    id: snapshot.id,
    savedAt: snapshot.savedAt,
  };
}

export function clearOfflineSnapshotsForActor(actorId: string): number {
  const storage = readStorage();
  if (!storage) return 0;
  const encodedActorId = encodePart(actorId);
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key) continue;
    if (key.startsWith(`${OFFLINE_FIELD_CACHE_PREFIX}:`) && key.includes(`:${encodedActorId}:`)) {
      keys.push(key);
    }
  }
  for (const key of keys) {
    storage.removeItem(key);
  }
  return keys.length;
}

export function formatOfflineSnapshotTime(savedAt: string, locale: string): string {
  const date = new Date(savedAt);
  if (!Number.isFinite(date.getTime())) return savedAt;
  return new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
