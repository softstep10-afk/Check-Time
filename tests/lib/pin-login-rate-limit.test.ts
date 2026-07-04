import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import {
  buildPinLoginRateLimitKey,
  checkGlobalPinLoginRateLimit,
  checkPinLoginRateLimit,
  clearPinLoginRateLimit,
  PIN_LOGIN_GLOBAL_MAX_FAILURES,
  recordGlobalPinLoginFailure,
  recordPinLoginFailure,
} from "@/lib/pin-login-rate-limit";

function missingTableClient() {
  return {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                async maybeSingle() {
                  return {
                    data: null,
                    error: {
                      code: "PGRST205",
                      message: "Could not find pin_login_rate_limits",
                    },
                  };
                },
              };
            },
          };
        },
        delete() {
          return {
            async eq() {
              return {
                error: {
                  code: "PGRST205",
                  message: "Could not find pin_login_rate_limits",
                },
              };
            },
          };
        },
      };
    },
  };
}

// Stateful in-memory stand-in for the pin_login_rate_limits table. Each call
// gets its own store, so tests stay isolated (unlike the module's memory
// fallback, which is shared across a run).
function statefulClient() {
  const rows = new Map<string, Record<string, unknown>>();
  return {
    from() {
      return {
        select() {
          return {
            eq(_column: string, value: string) {
              return {
                async maybeSingle() {
                  return { data: rows.get(value) ?? null, error: null };
                },
              };
            },
          };
        },
        upsert(row: { key_hash: string }) {
          rows.set(row.key_hash, row);
          return Promise.resolve({ error: null });
        },
        delete() {
          return {
            async eq(_column: string, value: string) {
              rows.delete(value);
              return { error: null };
            },
          };
        },
      };
    },
  };
}

describe("PIN login rate limit", () => {
  it("keys only on the client IP and never on the User-Agent", () => {
    const key = buildPinLoginRateLimitKey({ ipAddress: "192.0.2.10" });
    const same = buildPinLoginRateLimitKey({ ipAddress: "192.0.2.10" });
    const different = buildPinLoginRateLimitKey({ ipAddress: "198.51.100.7" });

    // Same IP always yields the same bucket. The signature no longer accepts a
    // User-Agent, so a rotating UA header can no longer mint a fresh bucket.
    expect(key).toBe(same);
    expect(key).not.toBe(different);
    expect(key).toHaveLength(64);
    expect(key).not.toContain("192.0.2.10");
  });

  it("falls back safely before the migration is applied", async () => {
    const admin = missingTableClient() as never;
    const key = buildPinLoginRateLimitKey({ ipAddress: `192.0.2.${Date.now() % 250}` });

    await expect(checkPinLoginRateLimit(admin, key)).resolves.toEqual({ allowed: true });
    for (let index = 0; index < 8; index += 1) {
      await recordPinLoginFailure(admin, key);
    }

    const locked = await checkPinLoginRateLimit(admin, key);
    expect(locked.allowed).toBe(false);
    expect(locked.retryAfterSeconds).toBeGreaterThan(0);

    await clearPinLoginRateLimit(admin, key);
    await expect(checkPinLoginRateLimit(admin, key)).resolves.toEqual({ allowed: true });
  });

  it("trips the global endpoint ceiling regardless of which client keys failed", async () => {
    const admin = statefulClient() as never;

    await expect(checkGlobalPinLoginRateLimit(admin)).resolves.toEqual({ allowed: true });

    // Simulate an attacker rotating IPs (each recordPinLoginFailure targets a
    // different per-client key) while each miss also hits the shared global one.
    for (let index = 0; index < PIN_LOGIN_GLOBAL_MAX_FAILURES; index += 1) {
      const rotatingKey = buildPinLoginRateLimitKey({ ipAddress: `203.0.113.${index}` });
      await recordPinLoginFailure(admin, rotatingKey);
      await recordGlobalPinLoginFailure(admin);
    }

    const blocked = await checkGlobalPinLoginRateLimit(admin);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);

    // A fresh per-client bucket is still individually allowed — proving the
    // block above came from the global ceiling, not the per-client key.
    const freshKey = buildPinLoginRateLimitKey({ ipAddress: "203.0.113.250" });
    await expect(checkPinLoginRateLimit(admin, freshKey)).resolves.toEqual({ allowed: true });
  });
});
