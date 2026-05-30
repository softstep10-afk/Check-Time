import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const getUserMock = vi.hoisted(() => vi.fn());

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: {
      getUser: getUserMock,
    },
  })),
}));

const ENV_KEYS = [
  "NODE_ENV",
  "NEXT_PUBLIC_AUTH_BYPASS",
  "NEXT_PUBLIC_AUTH_BYPASS_ALLOW_NON_PRODUCTION",
  "VERCEL",
  "VERCEL_ENV",
] as const;

const originalEnv = new Map<string, string | undefined>(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

function setProductionEnv() {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
  process.env.NODE_ENV = "production";
  process.env.NEXT_PUBLIC_AUTH_BYPASS = "true";
  process.env.NEXT_PUBLIC_AUTH_BYPASS_ALLOW_NON_PRODUCTION = "true";
  process.env.VERCEL = "1";
  process.env.VERCEL_ENV = "production";
}

function restoreEnv() {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

async function loadProxy() {
  vi.resetModules();
  setProductionEnv();
  return import("@/proxy");
}

function requestFor(pathname: string) {
  return new NextRequest(`https://check-time-five.vercel.app${pathname}`);
}

afterEach(() => {
  getUserMock.mockReset();
  vi.resetModules();
  restoreEnv();
});

describe("production auth route guards", () => {
  it.each([
    "/overview",
    "/payroll",
    "/team",
    "/command-center",
    "/admin/diagnostics",
    "/clock",
  ])("redirects anonymous production visitors from %s to login", async (pathname) => {
    getUserMock.mockResolvedValue({
      data: { user: null },
      error: null,
    });

    const { proxy } = await loadProxy();
    const response = await proxy(requestFor(pathname));
    const location = response.headers.get("location");

    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    expect(location).toBeTruthy();
    const redirectUrl = new URL(location!);
    expect(redirectUrl.pathname).toBe("/login");
    expect(redirectUrl.searchParams.get("next")).toBe(pathname);
  });

  it("does not route anonymous production users into preview owner data", async () => {
    getUserMock.mockResolvedValue({
      data: { user: null },
      error: null,
    });

    const { proxy } = await loadProxy();
    const response = await proxy(requestFor("/overview"));

    expect(response.headers.get("location")).toContain("/login");
  });

  it("keeps authenticated users on protected routes for server-side role checks", async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: "owner-user-id" } },
      error: null,
    });

    const { proxy } = await loadProxy();
    const response = await proxy(requestFor("/admin/diagnostics"));

    expect(response.headers.get("location")).toBeNull();
  });

  it("keeps diagnostics behind the existing owner/admin server gate", () => {
    const diagnosticsPageSource = readFileSync(
      resolve(process.cwd(), "src/app/(manager)/admin/diagnostics/page.tsx"),
      "utf8",
    );

    expect(diagnosticsPageSource).toContain("requireManagerContext");
    expect(diagnosticsPageSource).toContain('profile.role !== "owner" && profile.role !== "admin"');
  });
});
