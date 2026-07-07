import "server-only";

import { getActiveSubscriptions, revokeById } from "@/lib/notifications/subscriptions";
import { sendWebPush } from "@/lib/notifications/web-push";
import type { NotificationPayload } from "@/lib/notifications/types";

// Channel-agnostic notification send. Resolves a profile's active subscriptions
// and fans out to the channel adapters. Today there is exactly one adapter
// (web-push); the shape (resolve subs → per-subscription adapter → revoke gone)
// is what a second channel (e.g. FCM/APNs) would slot into later.
//
// Phase 1 has NO production triggers — this is only called by the /push/test
// smoke route. It never throws: a missing table, missing keys, or a dead
// subscription all degrade to a counted no-op.

export type SendResult = {
  /** Active subscriptions resolved for the profile. */
  candidates: number;
  /** Deliveries the push service accepted. */
  sent: number;
  /** Subscriptions revoked because the push service reported them gone (404/410). */
  revoked: number;
  /** Delivery attempts that errored (kept for a later retry, not revoked). */
  errored: number;
  /** True when no channel is configured (e.g. VAPID env absent). */
  skipped: boolean;
};

export async function sendNotificationToProfile(
  profileId: string,
  payload: NotificationPayload,
): Promise<SendResult> {
  const subscriptions = await getActiveSubscriptions(profileId);
  const result: SendResult = {
    candidates: subscriptions.length,
    sent: 0,
    revoked: 0,
    errored: 0,
    skipped: false,
  };

  for (const subscription of subscriptions) {
    // Adapter fan-out. Only web-push exists today; add channels here.
    const webPush = await sendWebPush(subscription, payload);
    if (webPush.status === "sent") {
      result.sent += 1;
    } else if (webPush.status === "gone") {
      await revokeById(subscription.id);
      result.revoked += 1;
    } else if (webPush.status === "skipped") {
      result.skipped = true;
    } else {
      result.errored += 1;
    }
  }

  return result;
}
