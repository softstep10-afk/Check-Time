import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { readTrustedClientIp } from "@/lib/server/request-ip";
import { buildPinLoginRateLimitKey } from "@/lib/pin-login-rate-limit";

function source(headers: Record<string, string>, ip?: string) {
  const lower = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ip,
    headers: {
      get: (name: string) => lower.get(name.toLowerCase()) ?? null,
    },
  };
}

describe("readTrustedClientIp", () => {
  it("takes the RIGHTMOST x-forwarded-for hop, not the spoofable first token", () => {
    // Attacker prepends a fake IP; Vercel appends the real connecting IP last.
    const ip = readTrustedClientIp(
      source({ "x-forwarded-for": "1.2.3.4, 203.0.113.99" }),
    );
    expect(ip).toBe("203.0.113.99");
    expect(ip).not.toBe("1.2.3.4");
  });

  it("does NOT create a fresh rate-limit bucket when the first XFF token is spoofed", () => {
    const realIp = "203.0.113.99";
    const honest = buildPinLoginRateLimitKey({
      ipAddress: readTrustedClientIp(source({ "x-forwarded-for": realIp })),
    });
    const spoofedA = buildPinLoginRateLimitKey({
      ipAddress: readTrustedClientIp(
        source({ "x-forwarded-for": `9.9.9.9, ${realIp}` }),
      ),
    });
    const spoofedB = buildPinLoginRateLimitKey({
      ipAddress: readTrustedClientIp(
        source({ "x-forwarded-for": `8.8.8.8, ${realIp}` }),
      ),
    });

    // All three resolve to the same bucket: rotating the prepended token cannot
    // evade the limiter.
    expect(spoofedA).toBe(honest);
    expect(spoofedB).toBe(honest);
  });

  it("prefers the runtime ip, then x-real-ip, over x-forwarded-for", () => {
    expect(
      readTrustedClientIp(source({ "x-forwarded-for": "1.1.1.1" }, "203.0.113.5")),
    ).toBe("203.0.113.5");
    expect(
      readTrustedClientIp(
        source({ "x-real-ip": "203.0.113.6", "x-forwarded-for": "1.1.1.1, 2.2.2.2" }),
      ),
    ).toBe("203.0.113.6");
  });

  it("falls back to a stable literal when no source header is present", () => {
    expect(readTrustedClientIp(source({}))).toBe("unknown");
  });
});
