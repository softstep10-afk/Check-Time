import { describe, expect, it } from "vitest";
import { buildJarvisDiagnostic } from "@/lib/ai/jarvis-diagnostics";

describe("Jarvis diagnostics", () => {
  it("keeps owner-visible diagnostics useful without exposing secrets", () => {
    const diagnostic = buildJarvisDiagnostic({
      inputMode: "text",
      userRequest: "Создай задачу Васе",
      selectedIntent: "create_task",
      executionStatus: "awaiting_owner_confirmation",
      dataSourcesUsed: ["workers", "projects"],
      matchedWorker: "Vasia",
      executionEndpoint: "/api/ai/actions/create-task",
      preparedAction: {
        kind: "create_task",
        apiKey: "sk_secret_should_not_show",
        payload: {
          title: "Check windows",
          token: "ghp_private_token",
        },
      },
    });

    expect(diagnostic.dataSourcesUsed).toEqual(["workers", "projects"]);
    expect(diagnostic.matchedWorker).toBe("Vasia");
    expect(JSON.stringify(diagnostic.preparedAction)).not.toContain("sk_secret");
    expect(JSON.stringify(diagnostic.preparedAction)).not.toContain("ghp_private");
    expect(JSON.stringify(diagnostic.preparedAction)).toContain("[redacted]");
  });
});
