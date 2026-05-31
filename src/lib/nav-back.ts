/**
 * Pure navigation helper for the global in-app "back" control.
 *
 * Kept framework-free so it can be unit-tested in the node test env without
 * rendering React. The component layer (AppBackButton) wires this to
 * next/navigation's router; this module only decides *where* back should go.
 *
 * Rule: if the browser has real same-tab history to go back to, use it.
 * Otherwise fall back to the owner dashboard so the button never strands the
 * user on a blank history entry (e.g. deep-linked first load).
 */
export const BACK_FALLBACK_PATH = "/overview";

/**
 * Decide the back action from the current history length.
 *
 * `history.length` is 1 on a fresh tab with no prior entries. Anything >1
 * means there is at least one entry to pop. We treat a missing/invalid value
 * conservatively as "no history" so we fall back rather than calling back()
 * into nothing.
 */
export function resolveBackTarget(historyLength: number | null | undefined): {
  action: "history-back";
} | {
  action: "fallback";
  path: string;
} {
  if (typeof historyLength === "number" && historyLength > 1) {
    return { action: "history-back" };
  }
  return { action: "fallback", path: BACK_FALLBACK_PATH };
}
