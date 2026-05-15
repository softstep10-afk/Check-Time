import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import {
  buildPinLoginRateLimitKey,
  checkPinLoginRateLimit,
  clearPinLoginRateLimit,
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

describe("PIN login rate limit", () => {
  it("hashes the client identity deterministically", () => {
    const first = buildPinLoginRateLimitKey({
      ipAddress: "192.0.2.10",
      userAgent: "Unit Test Browser",
    });
    const second = buildPinLoginRateLimitKey({
      ipAddress: "192.0.2.10",
      userAgent: "Unit Test Browser",
    });

    expect(first).toBe(second);
    expect(first).toHaveLength(64);
    expect(first).not.toContain("192.0.2.10");
  });

  it("falls back safely before the migration is applied", async () => {
    const admin = missingTableClient() as never;
    const key = buildPinLoginRateLimitKey({
      ipAddress: "192.0.2.11",
      userAgent: `Unit Test Browser ${Date.now()}`,
    });

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
});
