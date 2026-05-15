import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

const WINDOW_MS = 10 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;
const MAX_FAILURES = 8;

type RateLimitRow = {
  key_hash: string;
  fail_count: number;
  first_failed_at: string | null;
  locked_until: string | null;
};

type MemoryState = {
  failCount: number;
  firstFailedAt: number;
  lockedUntil: number | null;
};

type RateLimitResult = {
  allowed: boolean;
  retryAfterSeconds?: number;
};

const memoryState = new Map<string, MemoryState>();

function nowMs(): number {
  return Date.now();
}

function secondsUntil(timestampMs: number): number {
  return Math.max(1, Math.ceil((timestampMs - nowMs()) / 1000));
}

function readRowLock(row: RateLimitRow | null): RateLimitResult | null {
  if (!row?.locked_until) return null;
  const lockedUntilMs = new Date(row.locked_until).getTime();
  if (!Number.isFinite(lockedUntilMs) || lockedUntilMs <= nowMs()) return null;
  return { allowed: false, retryAfterSeconds: secondsUntil(lockedUntilMs) };
}

function isTableMissing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    (error.message ?? "").toLowerCase().includes("pin_login_rate_limits")
  );
}

function getMemoryState(keyHash: string): MemoryState | null {
  const current = memoryState.get(keyHash);
  if (!current) return null;

  const now = nowMs();
  if (current.lockedUntil && current.lockedUntil > now) return current;
  if (current.firstFailedAt + WINDOW_MS > now) return current;

  memoryState.delete(keyHash);
  return null;
}

function checkMemoryRateLimit(keyHash: string): RateLimitResult {
  const current = getMemoryState(keyHash);
  if (!current?.lockedUntil || current.lockedUntil <= nowMs()) return { allowed: true };
  return { allowed: false, retryAfterSeconds: secondsUntil(current.lockedUntil) };
}

function recordMemoryFailure(keyHash: string) {
  const now = nowMs();
  const current = getMemoryState(keyHash);
  const nextCount = current ? current.failCount + 1 : 1;
  memoryState.set(keyHash, {
    failCount: nextCount,
    firstFailedAt: current?.firstFailedAt ?? now,
    lockedUntil: nextCount >= MAX_FAILURES ? now + LOCK_MS : null,
  });
}

function clearMemoryRateLimit(keyHash: string) {
  memoryState.delete(keyHash);
}

export function buildPinLoginRateLimitKey(args: {
  ipAddress: string;
  userAgent: string;
}): string {
  return createHash("sha256")
    .update(`${args.ipAddress.trim() || "unknown"}|${args.userAgent.slice(0, 180)}`)
    .digest("hex");
}

export async function checkPinLoginRateLimit(
  adminClient: SupabaseClient,
  keyHash: string,
): Promise<RateLimitResult> {
  const { data, error } = await adminClient
    .from("pin_login_rate_limits")
    .select("key_hash, fail_count, first_failed_at, locked_until")
    .eq("key_hash", keyHash)
    .maybeSingle<RateLimitRow>();

  if (isTableMissing(error)) return checkMemoryRateLimit(keyHash);
  if (error) throw new Error(error.message);

  const locked = readRowLock(data);
  return locked ?? { allowed: true };
}

export async function recordPinLoginFailure(
  adminClient: SupabaseClient,
  keyHash: string,
) {
  const now = new Date();
  const { data, error } = await adminClient
    .from("pin_login_rate_limits")
    .select("key_hash, fail_count, first_failed_at, locked_until")
    .eq("key_hash", keyHash)
    .maybeSingle<RateLimitRow>();

  if (isTableMissing(error)) {
    recordMemoryFailure(keyHash);
    return;
  }
  if (error) throw new Error(error.message);

  const firstFailedAtMs = data?.first_failed_at ? new Date(data.first_failed_at).getTime() : NaN;
  const insideWindow = Number.isFinite(firstFailedAtMs) && firstFailedAtMs + WINDOW_MS > now.getTime();
  const failCount = insideWindow ? (data?.fail_count ?? 0) + 1 : 1;
  const firstFailedAt = insideWindow && data?.first_failed_at ? data.first_failed_at : now.toISOString();
  const lockedUntil = failCount >= MAX_FAILURES ? new Date(now.getTime() + LOCK_MS).toISOString() : null;

  const { error: upsertError } = await adminClient
    .from("pin_login_rate_limits")
    .upsert(
      {
        key_hash: keyHash,
        fail_count: failCount,
        first_failed_at: firstFailedAt,
        locked_until: lockedUntil,
        updated_at: now.toISOString(),
      },
      { onConflict: "key_hash" },
    );

  if (isTableMissing(upsertError)) {
    recordMemoryFailure(keyHash);
    return;
  }
  if (upsertError) throw new Error(upsertError.message);
}

export async function clearPinLoginRateLimit(
  adminClient: SupabaseClient,
  keyHash: string,
) {
  const { error } = await adminClient
    .from("pin_login_rate_limits")
    .delete()
    .eq("key_hash", keyHash);

  if (isTableMissing(error)) {
    clearMemoryRateLimit(keyHash);
    return;
  }
  if (error) throw new Error(error.message);
}
