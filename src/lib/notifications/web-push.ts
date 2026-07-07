import "server-only";

import webpush from "web-push";
import type { NotificationPayload, PushSubscriptionRecord } from "@/lib/notifications/types";

// web-push channel adapter. VAPID keys come from env only — never from code. If
// the env is not configured the adapter is a silent no-op (logs once), so the
// whole notifications lib degrades gracefully before the owner sets the keys.

export type WebPushResult =
  | { status: "sent" }
  | { status: "gone" } // 404/410 — subscription expired; caller should revoke it
  | { status: "skipped" } // not configured
  | { status: "error"; message: string };

function vapidEnv() {
  return {
    publicKey: process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim() ?? "",
    privateKey: process.env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim() ?? "",
    contact: process.env.WEB_PUSH_CONTACT?.trim() ?? "",
  };
}

export function isWebPushConfigured(): boolean {
  const { publicKey, privateKey, contact } = vapidEnv();
  return Boolean(publicKey && privateKey && contact);
}

let vapidReady = false;
let warnedUnconfigured = false;

function ensureVapid(): boolean {
  if (vapidReady) return true;
  if (!isWebPushConfigured()) {
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      console.warn(
        "[push] web-push VAPID env not configured (WEB_PUSH_VAPID_PUBLIC_KEY / _PRIVATE_KEY / WEB_PUSH_CONTACT) — push sends are a no-op.",
      );
    }
    return false;
  }
  const { publicKey, privateKey, contact } = vapidEnv();
  const subject = contact.startsWith("mailto:") || contact.startsWith("http") ? contact : `mailto:${contact}`;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidReady = true;
  return true;
}

export async function sendWebPush(
  record: Pick<PushSubscriptionRecord, "endpoint" | "p256dh" | "auth">,
  payload: NotificationPayload,
): Promise<WebPushResult> {
  if (!ensureVapid()) return { status: "skipped" };
  try {
    await webpush.sendNotification(
      { endpoint: record.endpoint, keys: { p256dh: record.p256dh, auth: record.auth } },
      JSON.stringify(payload),
    );
    return { status: "sent" };
  } catch (error) {
    const statusCode = (error as { statusCode?: number })?.statusCode;
    if (statusCode === 404 || statusCode === 410) {
      return { status: "gone" };
    }
    return {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
