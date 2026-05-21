import { describe, expect, it } from "vitest";
import {
  formatJarvisRouteModel,
  getJarvisProviderStatuses,
  getJarvisRoutingDiagnostics,
  resolveJarvisRoute,
} from "@/lib/ai/provider-routing";

function env(values: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { NODE_ENV: "test", ...values } as NodeJS.ProcessEnv;
}

describe("Jarvis provider routing", () => {
  it("keeps simple command routing on the deterministic fast path", () => {
    const route = resolveJarvisRoute("fast_command", { env: env() });

    expect(route.selected.provider).toBe("jarvis_deterministic");
    expect(route.costTier).toBe("free_app_logic");
    expect(route.toolGenerationAllowed).toBe(true);
    expect(route.ownerConfirmationRequired).toBe(true);
  });

  it("selects the configured reasoning provider for best-quality operations reasoning", () => {
    const route = resolveJarvisRoute("operations_reasoning", {
      mode: "best_quality",
      env: env({
        ANTHROPIC_API_KEY: "anthropic-secret",
        ANTHROPIC_MODEL: "claude-test",
        GEMINI_API_KEY: "gemini-secret",
      }),
    });

    expect(route.selected).toMatchObject({
      provider: "anthropic",
      model: "claude-test",
    });
    expect(route.fallbackOrder.map(formatJarvisRouteModel).join(" -> ")).toContain("gemini");
  });

  it("falls back safely when the preferred route is not configured", () => {
    const route = resolveJarvisRoute("operations_reasoning", {
      mode: "balanced",
      env: env({
        OPENAI_API_KEY: "openai-secret",
      }),
    });

    expect(route.selected.provider).toBe("openai");
    expect(route.fallbackUsed).toBe(true);
    expect(route.warning).toContain("fallback");
  });

  it("does not route binary attachments to text-only providers", () => {
    const route = resolveJarvisRoute("document_or_media_analysis", {
      hasBinaryAttachments: true,
      env: env({
        OPENAI_API_KEY: "openai-secret",
        ANTHROPIC_API_KEY: "anthropic-secret",
      }),
    });

    expect(route.selected.provider).toBe("none");
    expect(route.warning).toContain("No configured");
  });

  it("shows owner diagnostics without exposing raw keys", () => {
    const diagnostics = getJarvisRoutingDiagnostics(env({
      GEMINI_API_KEY: "secret-gemini-key",
      OPENAI_API_KEY: "secret-openai-key",
      ANTHROPIC_API_KEY: "secret-anthropic-key",
      GOOGLE_SERVICE_ACCOUNT_JSON: "secret-google-json",
    }));
    const text = JSON.stringify(diagnostics);

    expect(text).toContain("Routing mode");
    expect(text).toContain("configured");
    expect(text).not.toContain("secret-gemini-key");
    expect(text).not.toContain("secret-openai-key");
    expect(text).not.toContain("secret-anthropic-key");
    expect(text).not.toContain("secret-google-json");
  });

  it("reports configured provider state explicitly", () => {
    const statuses = getJarvisProviderStatuses(env({
      OPENAI_API_KEY: "openai-secret",
    }));

    expect(statuses.find((item) => item.provider === "openai")?.configured).toBe(true);
    expect(statuses.find((item) => item.provider === "anthropic")?.configured).toBe(false);
  });
});
