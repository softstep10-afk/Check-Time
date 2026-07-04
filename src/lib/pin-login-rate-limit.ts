import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

// --- Per-client policy ------------------------------------------------------
// Buckets a single caller (keyed on a trusted client IP). Absorbs an individual
// user fat-fingering their PIN a few times before a longer cool-down.
const PER_KEY_WINDOW_MS = 10 * 60 * 1000;
const PER_KEY_LOCK_MS = 15 * 60 * 1000;
const PER_KEY_MAX_FAILURES = 8;

// --- Global endpoint circuit-breaker (audit S-H1 #2) ------------------------
// Even if an attacker rotates source IPs to dodge the per-client bucket above,
// this coarse counter throttles the pin-login endpoint AS A WHOLE. It counts
// only FAILED attempts (a correct PIN clears the caller's per-client bucket but
// never touches this global one) inside a short rolling window, then trips a
// brief endpoint-wide cool-down.
//
// Tuning rationale:
//  - 100 failures / 5 min (~20 wrong PINs per minute across the ENTIRE company)
//    sits far above any realistic shift-start burst of mistyped PINs — wrong
//    entries are rare, successful logins never count, and the window fully
//    resets every 5 minutes — yet far below brute-force throughput.
//  - When tripped we lock for only 60s: this is a circuit breaker, not a
//    punishment, so a legitimate user is never stranded for long. The endpoint
//    re-opens and an attacker is forced into a slow ~100-guess-per-window drip,
//    which makes even the 10k legacy 4-digit space slow and the new 1M 6-digit
//    space effectively infeasible.
const GLOBAL_WINDOW_MS = 5 * 60 * 1000;
const GLOBAL_LOCK_MS = 60 * 1000;
export const PIN_LOGIN_GLOBAL_MAX_FAILURES = 100;

// Fixed bucket shared by every request. A real client IP can never collide with
// this literal, so the per-client and global buckets stay disjoint.
const GLOBAL_KEY_HASH = createHash("sha256")
  .update("pin-login|__global-endpoint__")
  .digest("hex");

type RateLimitPolicy = {
  windowMs: number;
  lockMs: number;
  maxFailures: number;
};

const PER_KEY_POLICY: RateLimitPolicy = {
  windowMs: PER_KEY_WINDOW_MS,
  lockMs: PER_KEY_LOCK_MS,
  maxFailures: PER_KEY_MAX_FAILURES,
};

const GLOBAL_POLICY: RateLimitPolicy = {
  windowMs: GLOBAL_WINDOW_MS,
  lockMs: GLOBAL_LOCK_MS,
  maxFailures: PIN_LOGIN_GLOBAL_MAX_FAILURES,
};

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

function getMemoryState(keyHash: string, policy: RateLimitPolicy): MemoryState | null {
  const current = memoryState.get(keyHash);
  if (!current) return null;

  const now = nowMs();
  if (current.lockedUntil && current.lockedUntil > now) return current;
  if (current.firstFailedAt + policy.windowMs > now) return current;

  memoryState.delete(keyHash);
  return null;
}

function checkMemoryRateLimit(keyHash: string, policy: RateLimitPolicy): RateLimitResult {
  const current = getMemoryState(keyHash, policy);
  if (!current?.lockedUntil || current.lockedUntil <= nowMs()) return { allowed: true };
  return { allowed: false, retryAfterSeconds: secondsUntil(current.lockedUntil) };
}

function recordMemoryFailure(keyHash: string, policy: RateLimitPolicy) {
  const now = nowMs();
  const current = getMemoryState(keyHash, policy);
  const nextCount = current ? current.failCount + 1 : 1;
  memoryState.set(keyHash, {
    failCount: nextCount,
    firstFailedAt: current?.firstFailedAt ?? now,
    lockedUntil: nextCount >= policy.maxFailures ? now + policy.lockMs : null,
  });
}

function clearMemoryRateLimit(keyHash: string) {
  memoryState.delete(keyHash);
}

async function checkRateLimit(
  adminClient: SupabaseClient,
  keyHash: string,
  policy: RateLimitPolicy,
): Promise<RateLimitResult> {
  const { data, error } = await adminClient
    .from("pin_login_rate_limits")
    .select("key_hash, fail_count, first_failed_at, locked_until")
    .eq("key_hash", keyHash)
    .maybeSingle<RateLimitRow>();

  if (isTableMissing(error)) return checkMemoryRateLimit(keyHash, policy);
  if (error) throw new Error(error.message);

  const locked = readRowLock(data);
  return locked ?? { allowed: true };
}

async function recordFailure(
  adminClient: SupabaseClient,
  keyHash: string,
  policy: RateLimitPolicy,
) {
  const now = new Date();
  const { data, error } = await adminClient
    .from("pin_login_rate_limits")
    .select("key_hash, fail_count, first_failed_at, locked_until")
    .eq("key_hash", keyHash)
    .maybeSingle<RateLimitRow>();

  if (isTableMissing(error)) {
    recordMemoryFailure(keyHash, policy);
    return;
  }
  if (error) throw new Error(error.message);

  const firstFailedAtMs = data?.first_failed_at ? new Date(data.first_failed_at).getTime() : NaN;
  const insideWindow = Number.isFinite(firstFailedAtMs) && firstFailedAtMs + policy.windowMs > now.getTime();
  const failCount = insideWindow ? (data?.fail_count ?? 0) + 1 : 1;
  const firstFailedAt = insideWindow && data?.first_failed_at ? data.first_failed_at : now.toISOString();
  const lockedUntil = failCount >= policy.maxFailures ? new Date(now.getTime() + policy.lockMs).toISOString() : null;

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
    recordMemoryFailure(keyHash, policy);
    return;
  }
  if (upsertError) throw new Error(upsertError.message);
}

// Bucket key for a single caller. Derived from the trusted client IP ONLY —
// deliberately no User-Agent, which is fully client-controlled and would let an
// attacker mint a fresh bucket per request just by rotating the header.
export function buildPinLoginRateLimitKey(args: { ipAddress: string }): string {
  return createHash("sha256")
    .update(`pin-login|${args.ipAddress.trim() || "unknown"}`)
    .digest("hex");
}

export function checkPinLoginRateLimit(
  adminClient: SupabaseClient,
  keyHash: string,
): Promise<RateLimitResult> {
  return checkRateLimit(adminClient, keyHash, PER_KEY_POLICY);
}

export function recordPinLoginFailure(
  adminClient: SupabaseClient,
  keyHash: string,
): Promise<void> {
  return recordFailure(adminClient, keyHash, PER_KEY_POLICY);
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

// Global endpoint circuit-breaker: shared across all callers, never cleared on
// success (only decays with its window), so IP rotation cannot evade it.
export function checkGlobalPinLoginRateLimit(
  adminClient: SupabaseClient,
): Promise<RateLimitResult> {
  return checkRateLimit(adminClient, GLOBAL_KEY_HASH, GLOBAL_POLICY);
}

export function recordGlobalPinLoginFailure(
  adminClient: SupabaseClient,
): Promise<void> {
  return recordFailure(adminClient, GLOBAL_KEY_HASH, GLOBAL_POLICY);
}
