import type { SupabaseClient } from "@supabase/supabase-js";

const MIN_DWELL_SECONDS = 180;

export type CloseOpenStoreVisitFailure = {
  operation: "select" | "delete" | "update";
  id?: string;
  message: string;
};

export type CloseOpenStoreVisitsResult = {
  ok: boolean;
  failures: CloseOpenStoreVisitFailure[];
};

/**
 * Close any store_visit row that is still open for this worker.
 *
 * Mirrors the rules from the detect-store-visit edge function:
 *   • duration < 3 min → drive-by, delete the row.
 *   • duration ≥ 3 min → set exited_at, duration_seconds, clear grace.
 *
 * Safe to call from any clock-out path. Errors are returned, not thrown,
 * so a flaky store_visits table never blocks the actual clock-out from
 * succeeding; callers that need to surface partial failure can inspect
 * the result.
 */
export async function closeOpenStoreVisits(
  supabase: SupabaseClient,
  workerId: string,
  exitTimestamp: string,
): Promise<CloseOpenStoreVisitsResult> {
  const failures: CloseOpenStoreVisitFailure[] = [];
  try {
    const { data, error } = await supabase
      .from("store_visits")
      .select("id, entered_at")
      .eq("worker_id", workerId)
      .is("exited_at", null);

    if (error) {
      return {
        ok: false,
        failures: [{ operation: "select", message: error.message }],
      };
    }
    if (!data || data.length === 0) return { ok: true, failures };

    const exitedMs = new Date(exitTimestamp).getTime();

    for (const row of data as Array<{ id: string; entered_at: string }>) {
      const enteredMs = new Date(row.entered_at).getTime();
      const duration = Math.max(0, Math.round((exitedMs - enteredMs) / 1_000));

      if (duration < MIN_DWELL_SECONDS) {
        // Drive-by — delete (chk_min_dwell would otherwise reject the close).
        const { error: deleteError } = await supabase.from("store_visits").delete().eq("id", row.id);
        if (deleteError) {
          failures.push({
            operation: "delete",
            id: row.id,
            message: deleteError.message,
          });
        }
        continue;
      }

      const update: Record<string, unknown> = {
        exited_at: exitTimestamp,
        duration_seconds: duration,
      };
      const { error: updErr } = await supabase
        .from("store_visits")
        .update({ ...update, grace_started_at: null })
        .eq("id", row.id);

      // 00004 migration not applied yet? Retry without grace_started_at.
      if (updErr && /column .* grace_started_at/i.test(updErr.message)) {
        const { error: fallbackError } = await supabase.from("store_visits").update(update).eq("id", row.id);
        if (fallbackError) {
          failures.push({
            operation: "update",
            id: row.id,
            message: fallbackError.message,
          });
        }
      } else if (updErr) {
        failures.push({
          operation: "update",
          id: row.id,
          message: updErr.message,
        });
      }
    }

    return { ok: failures.length === 0, failures };
  } catch (error) {
    return {
      ok: false,
      failures: [
        {
          operation: "update",
          message: error instanceof Error ? error.message : "Store visit cleanup failed.",
        },
      ],
    };
  }
}
