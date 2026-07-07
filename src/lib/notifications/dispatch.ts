import "server-only";

import { after } from "next/server";
import { sendNotificationToProfile } from "@/lib/notifications/send";
import type { NotificationPayload } from "@/lib/notifications/types";

// Strictly fire-and-forget notification dispatch (Push Phase 2 triggers).
//
// A push must NEVER fail or delay the message/task write that triggered it. So
// this:
//   - runs the send AFTER the HTTP response is flushed (Next `after`), so it
//     never adds latency to the write's response;
//   - never throws — errors are swallowed and logged;
//   - falls back to a detached promise if there is no request scope for `after`.
export function dispatchNotification(profileId: string, payload: NotificationPayload): void {
  const run = () =>
    sendNotificationToProfile(profileId, payload).catch((error) => {
      console.warn("[push] notification dispatch failed:", error);
    });
  try {
    after(run);
  } catch {
    // No request scope (or `after` unavailable) — detach it; still never throws.
    void run();
  }
}
