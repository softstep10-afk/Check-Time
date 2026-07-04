import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  applyProfileRates,
  buildProfileRateUpsert,
  hydrateProfilesWithRates,
  PROFILE_SELECT_WITHOUT_RATE,
  profilesWithoutRates,
  type ProfileWithoutRate,
} from "@/lib/profile-rates";

function profile(overrides: Partial<ProfileWithoutRate> & Pick<ProfileWithoutRate, "id" | "name">): ProfileWithoutRate {
  return {
    org_id: "org",
    role: "worker",
    color: "#ffffff",
    is_active: true,
    require_video: false,
    language: "en",
    settings: {},
    last_clock_in: null,
    current_project: null,
    deleted_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function supabaseForRates(args: {
  rateRows: Array<{ profile_id: string; hourly_rate: number | string | null }>;
  legacyRows: Array<{ id: string; hourly_rate: number | string | null }>;
  calls: Array<{ table: string; select?: string; in?: { column: string; values: string[] } }>;
}): SupabaseClient {
  return {
    from(table: string) {
      const call: { table: string; select?: string; in?: { column: string; values: string[] } } = { table };
      args.calls.push(call);
      return {
        select(columns: string) {
          call.select = columns;
          return {
            in(column: string, values: string[]) {
              call.in = { column, values };
              return {
                returns() {
                  if (table === "profile_rates") {
                    return Promise.resolve({ data: args.rateRows, error: null });
                  }
                  if (table === "profiles") {
                    return Promise.resolve({ data: args.legacyRows, error: null });
                  }
                  return Promise.resolve({ data: [], error: null });
                },
              };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
}

describe("profile_rates helpers", () => {
  it("keeps authenticated profile reads on column-granted fields", () => {
    expect(PROFILE_SELECT_WITHOUT_RATE).not.toContain("*");
    expect(PROFILE_SELECT_WITHOUT_RATE).not.toContain("pin_hash");
    expect(PROFILE_SELECT_WITHOUT_RATE).not.toContain("hourly_rate");
    expect(PROFILE_SELECT_WITHOUT_RATE.split(", ")).toEqual(
      expect.arrayContaining([
        "id",
        "org_id",
        "name",
        "role",
        "color",
        "is_active",
        "require_video",
        "last_clock_in",
        "current_project",
        "deleted_at",
      ]),
    );
  });

  it("sets profile rates to null when rates are not finance-visible", () => {
    const rows = [profile({ id: "w1", name: "Worker" })];

    expect(profilesWithoutRates(rows)).toEqual([
      expect.objectContaining({ id: "w1", hourly_rate: null }),
    ]);
  });

  it("applies profile_rates and leaves profiles without a rate row null", () => {
    const baseProfiles = profilesWithoutRates([
      profile({ id: "w1", name: "Worker One" }),
      profile({ id: "w2", name: "Worker Two" }),
    ]);

    const result = applyProfileRates(
      baseProfiles,
      [{ profile_id: "w1", hourly_rate: 42 }],
    );

    expect(result.find((entry) => entry.id === "w1")?.hourly_rate).toBe(42);
    expect(result.find((entry) => entry.id === "w2")?.hourly_rate).toBeNull();
  });

  it("hydrates finance-visible rates from profile_rates only, with no legacy column fallback", async () => {
    const calls: Array<{ table: string; select?: string; in?: { column: string; values: string[] } }> = [];
    const supabase = supabaseForRates({
      rateRows: [{ profile_id: "w1", hourly_rate: "45.5" }],
      legacyRows: [{ id: "w2", hourly_rate: 30 }],
      calls,
    });

    const result = await hydrateProfilesWithRates(
      supabase,
      [
        profile({ id: "w1", name: "Worker One" }),
        profile({ id: "w2", name: "Worker Two" }),
      ],
      true,
      "org",
    );

    expect(result.map((entry) => [entry.id, entry.hourly_rate])).toEqual([
      ["w1", 45.5],
      ["w2", null],
    ]);
    expect(calls).toEqual([
      {
        table: "profile_rates",
        select: "profile_id, hourly_rate",
        in: { column: "profile_id", values: ["w1", "w2"] },
      },
    ]);
  });

  it("rejects profile rate hydration when the profile seed set crosses orgs", async () => {
    const calls: Array<{ table: string; select?: string; in?: { column: string; values: string[] } }> = [];
    const supabase = supabaseForRates({
      rateRows: [{ profile_id: "w1", hourly_rate: "45.5" }],
      legacyRows: [],
      calls,
    });

    await expect(
      hydrateProfilesWithRates(
        supabase,
        [
          profile({ id: "w1", name: "Worker One" }),
          profile({ id: "w2", name: "Worker Two", org_id: "other-org" }),
        ],
        true,
        "org",
      ),
    ).rejects.toThrow("outside the authenticated org");

    expect(calls).toEqual([]);
  });

  it("builds the profile_rates upsert payload with updated_at", () => {
    expect(
      buildProfileRateUpsert({
        profileId: "w1",
        orgId: "org",
        hourlyRate: 44,
        updatedAt: "2026-06-15T12:00:00.000Z",
      }),
    ).toEqual({
      profile_id: "w1",
      org_id: "org",
      hourly_rate: 44,
      updated_at: "2026-06-15T12:00:00.000Z",
    });
  });
});
