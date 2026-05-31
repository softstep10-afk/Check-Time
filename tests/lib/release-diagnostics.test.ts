import { describe, expect, it } from "vitest";
import { getReleaseDiagnostics } from "@/lib/release-diagnostics";

const env = (values: Record<string, string>) => values as unknown as NodeJS.ProcessEnv;

describe("release diagnostics", () => {
  it("reports build metadata from bundled app stamp variables", () => {
    const diagnostics = getReleaseDiagnostics(env({
      APP_BUILD_COMMIT_SHA: "2222222222222222222222222222222222222222",
      APP_BUILD_COMMIT_REF: "fix/postdeploy-qa-audit-patches",
      APP_BUILD_TIME: "2026-05-31T05:10:00.000Z",
      APP_DEPLOY_ENV: "production",
      APP_DEPLOYMENT_URL: "check-time-five.vercel.app",
      NODE_ENV: "production",
    }));

    expect(diagnostics.commitSha).toBe("2222222222222222222222222222222222222222");
    expect(diagnostics.commitShort).toBe("22222222");
    expect(diagnostics.branch).toBe("fix/postdeploy-qa-audit-patches");
    expect(diagnostics.buildTime).toBe("2026-05-31T05:10:00.000Z");
    expect(diagnostics.deployEnvironment).toBe("production");
    expect(diagnostics.vercelUrl).toBe("https://check-time-five.vercel.app");
  });

  it("reports build metadata from safe deployment variables", () => {
    const diagnostics = getReleaseDiagnostics(env({
      VERCEL_GIT_COMMIT_SHA: "abcdef1234567890abcdef1234567890abcdef12",
      VERCEL_GIT_COMMIT_REF: "fix/postdeploy-qa-audit-patches",
      APP_BUILD_TIME: "2026-05-28T12:00:00.000Z",
      VERCEL_ENV: "production",
      VERCEL_URL: "check-time-five.vercel.app",
      NODE_ENV: "production",
    }));

    expect(diagnostics.commitSha).toBe("abcdef1234567890abcdef1234567890abcdef12");
    expect(diagnostics.commitShort).toBe("abcdef12");
    expect(diagnostics.branch).toBe("fix/postdeploy-qa-audit-patches");
    expect(diagnostics.buildTime).toBe("2026-05-28T12:00:00.000Z");
    expect(diagnostics.deployEnvironment).toBe("production");
    expect(diagnostics.vercelUrl).toBe("https://check-time-five.vercel.app");
  });

  it("keeps safe unknown fallbacks when release metadata is unavailable", () => {
    const diagnostics = getReleaseDiagnostics(env({}));

    expect(diagnostics.commitSha).toBe("unknown");
    expect(diagnostics.commitShort).toBe("unknown");
    expect(diagnostics.branch).toBe("unknown");
    expect(diagnostics.buildTime).toBe("unknown");
    expect(diagnostics.deployEnvironment).toBe("unknown");
    expect(diagnostics.vercelUrl).toBeNull();
  });

  it("normalizes deployment URLs that already include a protocol", () => {
    const diagnostics = getReleaseDiagnostics(env({
      APP_DEPLOYMENT_URL: "https://check-time-five.vercel.app",
    }));

    expect(diagnostics.vercelUrl).toBe("https://check-time-five.vercel.app");
  });

  it("does not expose unrelated secrets from the environment", () => {
    const diagnostics = getReleaseDiagnostics(env({
      VERCEL_GIT_COMMIT_SHA: "1111111111111111111111111111111111111111",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
      OPENAI_API_KEY: "openai-secret",
      DATABASE_URL: "postgres://secret",
      VERCEL_TOKEN: "vercel-secret",
    }));

    const text = JSON.stringify(diagnostics);
    expect(text).not.toContain("service-role-secret");
    expect(text).not.toContain("openai-secret");
    expect(text).not.toContain("postgres://secret");
    expect(text).not.toContain("vercel-secret");
    expect(Object.keys(diagnostics).join(" ")).not.toMatch(/secret|token|key|database/i);
  });
});
