import "server-only";

import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

export const PAID_API_ROUTES = [
  "/api/ai/assistant",
  "/api/ai/voice",
  "/api/ai/voice-command",
  "/api/ai/daily-report",
  "/api/ai/photo-analysis",
  "/api/media/transcode",
  "/api/manager/projects/geocode",
  "/api/worker/jarvis",
] as const;

export const PAID_API_PROVIDERS = [
  "gemini",
  "openai",
  "anthropic",
  "google_tts",
  "mux",
  "google_geocoding",
] as const;

export type PaidApiRoute = (typeof PAID_API_ROUTES)[number];
export type PaidApiProvider = (typeof PAID_API_PROVIDERS)[number];

type PaidApiBurstLimit = {
  limit: number;
  windowSeconds: number;
};

type PaidApiProviderLimit = {
  dailyLimit: number;
};

type PaidApiLimitConfig = {
  routes: Record<PaidApiRoute, PaidApiBurstLimit>;
  providers: Record<PaidApiProvider, PaidApiProviderLimit>;
};

// Provisional defaults for L0.5 task 4b. Keep this block easy to review/edit.
export const PAID_API_LIMIT_DEFAULTS: PaidApiLimitConfig = {
  routes: {
    "/api/ai/assistant": { limit: 20, windowSeconds: 60 },
    "/api/ai/voice": { limit: 12, windowSeconds: 60 },
    "/api/ai/voice-command": { limit: 30, windowSeconds: 60 },
    "/api/ai/daily-report": { limit: 10, windowSeconds: 5 * 60 },
    "/api/ai/photo-analysis": { limit: 20, windowSeconds: 5 * 60 },
    "/api/media/transcode": { limit: 12, windowSeconds: 5 * 60 },
    "/api/manager/projects/geocode": { limit: 40, windowSeconds: 5 * 60 },
    "/api/worker/jarvis": { limit: 12, windowSeconds: 60 },
  },
  providers: {
    gemini: { dailyLimit: 600 },
    openai: { dailyLimit: 200 },
    anthropic: { dailyLimit: 100 },
    google_tts: { dailyLimit: 300 },
    mux: { dailyLimit: 60 },
    google_geocoding: { dailyLimit: 500 },
  },
};

type PaidApiBucket = "burst" | "daily";

type PaidApiUsageRow = {
  key_hash: string;
  bucket: PaidApiBucket;
  route: string;
  provider: string;
  usage_day: string;
  request_count: number;
  window_started_at: string | null;
  locked_until: string | null;
  updated_at: string;
};

type MemoryUsageState = {
  requestCount: number;
  windowStartedAt: number;
  lockedUntil: number | null;
  usageDay: string;
};

type UsagePolicy = {
  bucket: PaidApiBucket;
  keyHash: string;
  route: string;
  provider: PaidApiProvider;
  usageDay: string;
  limit: number;
  windowMs: number;
  retryUntilMs: number;
  windowStartedAtMs: number;
};

export type PaidApiLimitAllowedResult = {
  allowed: true;
};

export type PaidApiLimitDeniedResult = {
  allowed: false;
  bucket: PaidApiBucket;
  route: PaidApiRoute;
  provider: PaidApiProvider;
  retryAfterSeconds: number;
  limit: number;
};

export type PaidApiLimitResult = PaidApiLimitAllowedResult | PaidApiLimitDeniedResult;

export type PaidApiLimitRequest = {
  adminClient?: SupabaseClient | null;
  orgId: string;
  profileId: string;
  route: PaidApiRoute;
  provider: PaidApiProvider;
  now?: Date;
};

const memoryState = new Map<string, MemoryUsageState>();
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export class PaidApiLimitError extends Error {
  readonly result: PaidApiLimitDeniedResult;

  constructor(result: PaidApiLimitDeniedResult) {
    super("Paid API limit exceeded.");
    this.name = "PaidApiLimitError";
    this.result = result;
  }
}

export function isPaidApiLimitError(error: unknown): error is PaidApiLimitError {
  return error instanceof PaidApiLimitError;
}

export function paidApiLimitResponse(result: PaidApiLimitDeniedResult): NextResponse {
  return NextResponse.json(
    {
      error: "Too many paid API requests. Try again later.",
      code: "paid_api_limit_exceeded",
      bucket: result.bucket,
      route: result.route,
      provider: result.provider,
      retryAfterSeconds: result.retryAfterSeconds,
    },
    {
      status: 429,
      headers: { "Retry-After": String(result.retryAfterSeconds) },
    },
  );
}

export function isPaidApiProvider(value: string): value is PaidApiProvider {
  return (PAID_API_PROVIDERS as readonly string[]).includes(value);
}

function isPaidApiRoute(value: string): value is PaidApiRoute {
  return (PAID_API_ROUTES as readonly string[]).includes(value);
}

function cloneLimitDefaults(): PaidApiLimitConfig {
  return {
    routes: Object.fromEntries(
      Object.entries(PAID_API_LIMIT_DEFAULTS.routes).map(([route, policy]) => [
        route,
        { ...policy },
      ]),
    ) as Record<PaidApiRoute, PaidApiBurstLimit>,
    providers: Object.fromEntries(
      Object.entries(PAID_API_LIMIT_DEFAULTS.providers).map(([provider, policy]) => [
        provider,
        { ...policy },
      ]),
    ) as Record<PaidApiProvider, PaidApiProviderLimit>,
  };
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readPositiveInteger(value: unknown): number | null {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return null;
  return Math.floor(numberValue);
}

function mergeLimitOverrides(config: PaidApiLimitConfig, value: unknown) {
  const root = readRecord(value);
  if (!root) return;

  const routes = readRecord(root.routes ?? root.burst);
  if (routes) {
    for (const [route, rawPolicy] of Object.entries(routes)) {
      if (!isPaidApiRoute(route)) continue;
      const policy = readRecord(rawPolicy);
      if (!policy) continue;

      const limit =
        readPositiveInteger(policy.limit) ??
        readPositiveInteger(policy.burstLimit) ??
        config.routes[route].limit;
      const windowSeconds =
        readPositiveInteger(policy.windowSeconds) ??
        readPositiveInteger(policy.burstWindowSeconds) ??
        config.routes[route].windowSeconds;

      config.routes[route] = { limit, windowSeconds };
    }
  }

  const providers = readRecord(root.providers ?? root.daily);
  if (providers) {
    for (const [provider, rawPolicy] of Object.entries(providers)) {
      if (!isPaidApiProvider(provider)) continue;
      const policy = readRecord(rawPolicy);
      const dailyLimit =
        readPositiveInteger(rawPolicy) ??
        readPositiveInteger(policy?.dailyLimit) ??
        readPositiveInteger(policy?.limit) ??
        config.providers[provider].dailyLimit;

      config.providers[provider] = { dailyLimit };
    }
  }
}

function readEnvLimitOverrides(): unknown {
  const raw = process.env.PAID_API_LIMITS_JSON;
  if (!raw?.trim()) return null;

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function isTableMissingOrUnreachable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const message = (error.message ?? "").toLowerCase();
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    message.includes("paid_api_usage") ||
    message.includes("schema cache") ||
    message.includes("relation") ||
    message.includes("network")
  );
}

async function readAppSettingsLimitOverrides(
  adminClient: SupabaseClient | null | undefined,
): Promise<unknown> {
  if (!adminClient) return null;

  try {
    const { data, error } = await adminClient
      .from("app_settings")
      .select("settings")
      .eq("id", 1)
      .maybeSingle<{ settings: Record<string, unknown> | null }>();

    if (error) return null;
    return data?.settings?.paid_api_limits ?? null;
  } catch {
    return null;
  }
}

async function resolveLimitConfig(
  adminClient: SupabaseClient | null | undefined,
): Promise<PaidApiLimitConfig> {
  const config = cloneLimitDefaults();
  mergeLimitOverrides(config, readEnvLimitOverrides());
  mergeLimitOverrides(config, await readAppSettingsLimitOverrides(adminClient));
  return config;
}

function nowMs(): number {
  return Date.now();
}

function secondsUntil(timestampMs: number): number {
  return Math.max(1, Math.ceil((timestampMs - nowMs()) / 1000));
}

function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function utcDayStartMs(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`);
}

function nextUtcDayStartMs(day: string): number {
  return utcDayStartMs(day) + ONE_DAY_MS;
}

function hashKey(parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

function buildBurstPolicy(args: PaidApiLimitRequest, limit: PaidApiBurstLimit, day: string): UsagePolicy {
  const now = args.now ?? new Date();
  const nowTime = now.getTime();
  return {
    bucket: "burst",
    keyHash: hashKey([
      "paid-api",
      "burst",
      args.orgId,
      args.profileId,
      args.route,
      args.provider,
      day,
    ]),
    route: args.route,
    provider: args.provider,
    usageDay: day,
    limit: limit.limit,
    windowMs: limit.windowSeconds * 1000,
    retryUntilMs: nowTime + limit.windowSeconds * 1000,
    windowStartedAtMs: nowTime,
  };
}

function buildDailyPolicy(args: PaidApiLimitRequest, limit: PaidApiProviderLimit, day: string): UsagePolicy {
  const dayStartMs = utcDayStartMs(day);
  return {
    bucket: "daily",
    keyHash: hashKey(["paid-api", "daily", args.orgId, args.provider, day]),
    route: "__all__",
    provider: args.provider,
    usageDay: day,
    limit: limit.dailyLimit,
    windowMs: ONE_DAY_MS,
    retryUntilMs: nextUtcDayStartMs(day),
    windowStartedAtMs: dayStartMs,
  };
}

function isRowLocked(row: PaidApiUsageRow | null, nowTime: number, usageDay: string): number | null {
  if (!row?.locked_until || row.usage_day !== usageDay) return null;
  const lockedUntilMs = new Date(row.locked_until).getTime();
  if (!Number.isFinite(lockedUntilMs) || lockedUntilMs <= nowTime) return null;
  return lockedUntilMs;
}

function rowInsideWindow(row: PaidApiUsageRow | null, policy: UsagePolicy, nowTime: number): boolean {
  if (!row || row.usage_day !== policy.usageDay) return false;
  const startedAtMs = row.window_started_at ? new Date(row.window_started_at).getTime() : NaN;
  if (!Number.isFinite(startedAtMs)) return false;
  if (policy.bucket === "daily") return true;
  return startedAtMs + policy.windowMs > nowTime;
}

function deniedResult(
  route: PaidApiRoute,
  policy: UsagePolicy,
  retryUntilMs: number,
): PaidApiLimitDeniedResult {
  return {
    allowed: false,
    bucket: policy.bucket,
    route,
    provider: policy.provider,
    retryAfterSeconds: secondsUntil(retryUntilMs),
    limit: policy.limit,
  };
}

function getMemoryState(keyHash: string, policy: UsagePolicy, nowTime: number): MemoryUsageState | null {
  const current = memoryState.get(keyHash);
  if (!current || current.usageDay !== policy.usageDay) {
    if (current) memoryState.delete(keyHash);
    return null;
  }
  if (current.lockedUntil && current.lockedUntil > nowTime) return current;
  if (current.windowStartedAt + policy.windowMs > nowTime) return current;

  memoryState.delete(keyHash);
  return null;
}

function consumeMemoryBucket(route: PaidApiRoute, policy: UsagePolicy, nowTime: number): PaidApiLimitResult {
  const current = getMemoryState(policy.keyHash, policy, nowTime);
  if (current?.lockedUntil && current.lockedUntil > nowTime) {
    return deniedResult(route, policy, current.lockedUntil);
  }

  if (current && current.requestCount >= policy.limit) {
    const lockedUntil = policy.bucket === "daily"
      ? policy.retryUntilMs
      : current.windowStartedAt + policy.windowMs;
    memoryState.set(policy.keyHash, { ...current, lockedUntil });
    return deniedResult(route, policy, lockedUntil);
  }

  memoryState.set(policy.keyHash, {
    requestCount: (current?.requestCount ?? 0) + 1,
    windowStartedAt: current?.windowStartedAt ?? policy.windowStartedAtMs,
    lockedUntil: null,
    usageDay: policy.usageDay,
  });
  return { allowed: true };
}

async function upsertUsageRow(
  adminClient: SupabaseClient,
  policy: UsagePolicy,
  requestCount: number,
  lockedUntilMs: number | null,
) {
  return adminClient
    .from("paid_api_usage")
    .upsert(
      {
        key_hash: policy.keyHash,
        bucket: policy.bucket,
        route: policy.route,
        provider: policy.provider,
        usage_day: policy.usageDay,
        request_count: requestCount,
        window_started_at: new Date(policy.windowStartedAtMs).toISOString(),
        locked_until: lockedUntilMs ? new Date(lockedUntilMs).toISOString() : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key_hash" },
    );
}

async function consumeTableBucket(
  adminClient: SupabaseClient,
  route: PaidApiRoute,
  policy: UsagePolicy,
  nowTime: number,
): Promise<PaidApiLimitResult> {
  try {
    const { data, error } = await adminClient
      .from("paid_api_usage")
      .select("key_hash, bucket, route, provider, usage_day, request_count, window_started_at, locked_until, updated_at")
      .eq("key_hash", policy.keyHash)
      .maybeSingle<PaidApiUsageRow>();

    if (isTableMissingOrUnreachable(error)) {
      return consumeMemoryBucket(route, policy, nowTime);
    }
    if (error) {
      return consumeMemoryBucket(route, policy, nowTime);
    }

    const lockedUntilMs = isRowLocked(data, nowTime, policy.usageDay);
    if (lockedUntilMs) {
      return deniedResult(route, policy, lockedUntilMs);
    }

    const insideWindow = rowInsideWindow(data, policy, nowTime);
    const currentCount = insideWindow ? data?.request_count ?? 0 : 0;
    const windowStartedAtMs = insideWindow && data?.window_started_at
      ? new Date(data.window_started_at).getTime()
      : policy.windowStartedAtMs;
    const retryUntilMs = policy.bucket === "daily"
      ? policy.retryUntilMs
      : windowStartedAtMs + policy.windowMs;

    if (currentCount >= policy.limit) {
      const { error: lockError } = await upsertUsageRow(
        adminClient,
        { ...policy, windowStartedAtMs },
        currentCount,
        retryUntilMs,
      );
      if (isTableMissingOrUnreachable(lockError) || lockError) {
        return consumeMemoryBucket(route, policy, nowTime);
      }
      return deniedResult(route, policy, retryUntilMs);
    }

    const { error: upsertError } = await upsertUsageRow(
      adminClient,
      { ...policy, windowStartedAtMs },
      currentCount + 1,
      null,
    );
    if (isTableMissingOrUnreachable(upsertError) || upsertError) {
      return consumeMemoryBucket(route, policy, nowTime);
    }

    return { allowed: true };
  } catch {
    return consumeMemoryBucket(route, policy, nowTime);
  }
}

async function consumeBucket(args: {
  adminClient?: SupabaseClient | null;
  route: PaidApiRoute;
  policy: UsagePolicy;
  nowTime: number;
}): Promise<PaidApiLimitResult> {
  if (!args.adminClient) {
    return consumeMemoryBucket(args.route, args.policy, args.nowTime);
  }
  return consumeTableBucket(args.adminClient, args.route, args.policy, args.nowTime);
}

export async function consumePaidApiLimit(args: PaidApiLimitRequest): Promise<PaidApiLimitResult> {
  const now = args.now ?? new Date();
  const nowTime = now.getTime();
  const day = utcDay(now);
  const config = await resolveLimitConfig(args.adminClient);

  const burstResult = await consumeBucket({
    adminClient: args.adminClient,
    route: args.route,
    policy: buildBurstPolicy(args, config.routes[args.route], day),
    nowTime,
  });
  if (!burstResult.allowed) return burstResult;

  const dailyResult = await consumeBucket({
    adminClient: args.adminClient,
    route: args.route,
    policy: buildDailyPolicy(args, config.providers[args.provider], day),
    nowTime,
  });
  if (!dailyResult.allowed) return dailyResult;

  return { allowed: true };
}

export async function assertPaidApiLimit(args: PaidApiLimitRequest): Promise<void> {
  const result = await consumePaidApiLimit(args);
  if (!result.allowed) {
    throw new PaidApiLimitError(result);
  }
}

export function createPaidApiLimitGuard(args: Omit<PaidApiLimitRequest, "provider">) {
  return async (provider: string): Promise<void> => {
    if (!isPaidApiProvider(provider)) return;
    await assertPaidApiLimit({ ...args, provider });
  };
}

