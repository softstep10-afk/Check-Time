import { afterEach, describe, expect, it, vi } from "vitest";

const ENV_KEYS = [
  "NODE_ENV",
  "NEXT_PUBLIC_AUTH_BYPASS",
  "NEXT_PUBLIC_AUTH_BYPASS_ALLOW_NON_PRODUCTION",
  "NEXT_PUBLIC_VERCEL_ENV",
  "VERCEL",
  "VERCEL_ENV",
] as const;

const originalEnv = new Map<string, string | undefined>(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

const mutableEnv = process.env as Record<string, string | undefined>;

function setEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const key of ENV_KEYS) {
    delete mutableEnv[key];
  }
  for (const [key, value] of Object.entries(values)) {
    mutableEnv[key] = value;
  }
}

function restoreEnv() {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) {
      delete mutableEnv[key];
    } else {
      mutableEnv[key] = value;
    }
  }
}

async function readAuthBypassEnabled(
  values: Partial<Record<(typeof ENV_KEYS)[number], string>>,
) {
  vi.resetModules();
  setEnv(values);
  const mod = await import("@/lib/auth-bypass");
  return mod.AUTH_BYPASS_ENABLED;
}

afterEach(() => {
  vi.resetModules();
  restoreEnv();
});

describe("auth bypass production gate", () => {
  it("keeps anonymous demo owner disabled in Vercel production even when public bypass flags are present", async () => {
    await expect(
      readAuthBypassEnabled({
        NODE_ENV: "production",
        NEXT_PUBLIC_AUTH_BYPASS: "true",
        NEXT_PUBLIC_AUTH_BYPASS_ALLOW_NON_PRODUCTION: "true",
        VERCEL: "1",
        VERCEL_ENV: "production",
      }),
    ).resolves.toBe(false);
  });

  it("requires real auth in production builds by default", async () => {
    await expect(
      readAuthBypassEnabled({
        NODE_ENV: "production",
        NEXT_PUBLIC_AUTH_BYPASS: "true",
      }),
    ).resolves.toBe(false);
  });

  it("allows local development preview only behind the explicit bypass flag", async () => {
    await expect(
      readAuthBypassEnabled({
        NODE_ENV: "development",
        NEXT_PUBLIC_AUTH_BYPASS: "true",
      }),
    ).resolves.toBe(true);
  });

  it("does not enable hosted preview bypass unless the non-production flag is explicit", async () => {
    await expect(
      readAuthBypassEnabled({
        NODE_ENV: "production",
        NEXT_PUBLIC_AUTH_BYPASS: "true",
        VERCEL: "1",
        VERCEL_ENV: "preview",
      }),
    ).resolves.toBe(false);
  });

  it("can allow hosted non-production preview without opening Vercel production", async () => {
    await expect(
      readAuthBypassEnabled({
        NODE_ENV: "production",
        NEXT_PUBLIC_AUTH_BYPASS: "true",
        NEXT_PUBLIC_AUTH_BYPASS_ALLOW_NON_PRODUCTION: "true",
        VERCEL: "1",
        VERCEL_ENV: "preview",
      }),
    ).resolves.toBe(true);
  });
});
