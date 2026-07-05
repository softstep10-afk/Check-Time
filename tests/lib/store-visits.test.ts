import { describe, expect, it, vi } from "vitest";
import { closeOpenStoreVisits } from "@/lib/store-visits";

function createStoreVisitClient({
  selectResult,
  deleteResult = { error: null },
  updateResults = [],
}: {
  selectResult: { data: Array<{ id: string; entered_at: string }> | null; error: { message: string } | null };
  deleteResult?: { error: { message: string } | null };
  updateResults?: Array<{ error: { message: string } | null }>;
}) {
  const remainingUpdateResults = [...updateResults];
  const table = {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        is: vi.fn(async () => selectResult),
      })),
    })),
    delete: vi.fn(() => ({
      eq: vi.fn(async () => deleteResult),
    })),
    update: vi.fn(() => ({
      eq: vi.fn(async () => remainingUpdateResults.shift() ?? { error: null }),
    })),
  };

  return {
    supabase: { from: vi.fn(() => table) },
    table,
  };
}

describe("store visit cleanup", () => {
  it("returns select errors to callers without throwing", async () => {
    const { supabase } = createStoreVisitClient({
      selectResult: { data: null, error: { message: "table missing" } },
    });

    await expect(
      closeOpenStoreVisits(
        supabase as never,
        "worker-1",
        "2026-07-03T10:05:00.000Z",
      ),
    ).resolves.toMatchObject({
      ok: false,
      failures: [{ operation: "select", message: "table missing" }],
    });
  });

  it("reports delete failures for drive-by visits", async () => {
    const { supabase } = createStoreVisitClient({
      selectResult: {
        data: [{ id: "visit-1", entered_at: "2026-07-03T10:00:00.000Z" }],
        error: null,
      },
      deleteResult: { error: { message: "delete denied" } },
    });

    const result = await closeOpenStoreVisits(
      supabase as never,
      "worker-1",
      "2026-07-03T10:01:00.000Z",
    );

    expect(result).toMatchObject({
      ok: false,
      failures: [{ operation: "delete", id: "visit-1", message: "delete denied" }],
    });
  });

  it("reports update failures for kept visits", async () => {
    const { supabase } = createStoreVisitClient({
      selectResult: {
        data: [{ id: "visit-1", entered_at: "2026-07-03T10:00:00.000Z" }],
        error: null,
      },
      updateResults: [{ error: { message: "update denied" } }],
    });

    const result = await closeOpenStoreVisits(
      supabase as never,
      "worker-1",
      "2026-07-03T10:05:00.000Z",
    );

    expect(result).toMatchObject({
      ok: false,
      failures: [{ operation: "update", id: "visit-1", message: "update denied" }],
    });
  });
});
