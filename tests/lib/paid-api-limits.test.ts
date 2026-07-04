import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  consumePaidApiLimit,
  PAID_API_LIMIT_DEFAULTS,
} from "@/lib/paid-api-limits";

function missingUsageTableClient() {
  return {
    from(table: string) {
      if (table === "app_settings") {
        return {
          select() {
            return {
              eq() {
                return {
                  async maybeSingle() {
                    return { data: null, error: null };
                  },
                };
              },
            };
          },
        };
      }

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
                      message: "Could not find paid_api_usage",
                    },
                  };
                },
              };
            },
          };
        },
        upsert() {
          return Promise.resolve({
            error: {
              code: "PGRST205",
              message: "Could not find paid_api_usage",
            },
          });
        },
      };
    },
  };
}

function statefulClient(settings: Record<string, unknown>) {
  const rows = new Map<string, Record<string, unknown>>();

  return {
    rows,
    from(table: string) {
      if (table === "app_settings") {
        return {
          select() {
            return {
              eq() {
                return {
                  async maybeSingle() {
                    return { data: { settings }, error: null };
                  },
                };
              },
            };
          },
        };
      }

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
      };
    },
  };
}

describe("paid API limits", () => {
  it("falls back to in-memory state before the migration is applied", async () => {
    const admin = missingUsageTableClient() as never;
    const unique = `org-${Date.now()}`;

    for (let index = 0; index < PAID_API_LIMIT_DEFAULTS.routes["/api/worker/jarvis"].limit; index += 1) {
      await expect(
        consumePaidApiLimit({
          adminClient: admin,
          orgId: unique,
          profileId: "worker-1",
          route: "/api/worker/jarvis",
          provider: "gemini",
        }),
      ).resolves.toEqual({ allowed: true });
    }

    const blocked = await consumePaidApiLimit({
      adminClient: admin,
      orgId: unique,
      profileId: "worker-1",
      route: "/api/worker/jarvis",
      provider: "gemini",
    });
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      expect(blocked.bucket).toBe("burst");
      expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    }
  });

  it("uses app_settings overrides for route burst limits", async () => {
    const admin = statefulClient({
      paid_api_limits: {
        routes: {
          "/api/ai/assistant": { limit: 2, windowSeconds: 60 },
        },
      },
    }) as never;

    for (let index = 0; index < 2; index += 1) {
      await expect(
        consumePaidApiLimit({
          adminClient: admin,
          orgId: "org-burst",
          profileId: "manager-1",
          route: "/api/ai/assistant",
          provider: "gemini",
        }),
      ).resolves.toEqual({ allowed: true });
    }

    const blocked = await consumePaidApiLimit({
      adminClient: admin,
      orgId: "org-burst",
      profileId: "manager-1",
      route: "/api/ai/assistant",
      provider: "gemini",
    });
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      expect(blocked.bucket).toBe("burst");
      expect(blocked.limit).toBe(2);
    }
  });

  it("enforces provider daily budgets across routes", async () => {
    const admin = statefulClient({
      paid_api_limits: {
        routes: {
          "/api/ai/assistant": { limit: 100, windowSeconds: 60 },
          "/api/worker/jarvis": { limit: 100, windowSeconds: 60 },
        },
        providers: {
          gemini: { dailyLimit: 2 },
        },
      },
    }) as never;

    await expect(
      consumePaidApiLimit({
        adminClient: admin,
        orgId: "org-daily",
        profileId: "manager-1",
        route: "/api/ai/assistant",
        provider: "gemini",
      }),
    ).resolves.toEqual({ allowed: true });
    await expect(
      consumePaidApiLimit({
        adminClient: admin,
        orgId: "org-daily",
        profileId: "worker-1",
        route: "/api/worker/jarvis",
        provider: "gemini",
      }),
    ).resolves.toEqual({ allowed: true });

    const blocked = await consumePaidApiLimit({
      adminClient: admin,
      orgId: "org-daily",
      profileId: "manager-2",
      route: "/api/ai/assistant",
      provider: "gemini",
    });
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      expect(blocked.bucket).toBe("daily");
      expect(blocked.limit).toBe(2);
    }
  });
});

