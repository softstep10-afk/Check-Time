// Client-side Web Push helpers (Push notifications Phase 1). Browser-only; no
// server imports. The VAPID public key comes from NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY
// (inlined by Next). Per-device opt-out and one-time prompt dismissal live in
// localStorage so we never nag.

const OPT_OUT_KEY = "cc_push_optout";
const PROMPT_DISMISSED_KEY = "cc_push_prompt_dismissed";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY ?? "";

export function isPushSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    typeof window !== "undefined" &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function isPushConfigured(): boolean {
  return Boolean(VAPID_PUBLIC_KEY);
}

export function getNotificationPermission(): NotificationPermission | "unsupported" {
  if (!isPushSupported()) return "unsupported";
  return Notification.permission;
}

export function isPushOptedOut(): boolean {
  try {
    return window.localStorage.getItem(OPT_OUT_KEY) === "true";
  } catch {
    return false;
  }
}

export function setPushOptOut(optedOut: boolean): void {
  try {
    window.localStorage.setItem(OPT_OUT_KEY, String(optedOut));
  } catch {
    /* storage blocked — nothing to persist */
  }
}

export function isPromptDismissed(): boolean {
  try {
    return window.localStorage.getItem(PROMPT_DISMISSED_KEY) === "true";
  } catch {
    return false;
  }
}

export function dismissPrompt(): void {
  try {
    window.localStorage.setItem(PROMPT_DISMISSED_KEY, "true");
  } catch {
    /* storage blocked */
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

export async function getCurrentSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  try {
    const registration = await navigator.serviceWorker.ready;
    return await registration.pushManager.getSubscription();
  } catch {
    return null;
  }
}

/**
 * Request permission (if needed), subscribe via the active SW, and register the
 * subscription server-side. Clears the per-device opt-out on success. Returns
 * false on any failure (denied, unsupported, missing key, network) — callers
 * treat that quietly (no nagging).
 */
export async function subscribeToPush(): Promise<boolean> {
  if (!isPushSupported() || !isPushConfigured()) return false;
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return false;

    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      }));

    const response = await fetch("/api/worker/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription: subscription.toJSON() }),
    });
    if (!response.ok) return false;

    setPushOptOut(false);
    return true;
  } catch (error) {
    console.warn("[push] subscribe failed:", error);
    return false;
  }
}

/** Revoke server-side and unsubscribe this device; remembers the opt-out. */
export async function unsubscribeFromPush(): Promise<boolean> {
  setPushOptOut(true);
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await fetch("/api/worker/push/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      }).catch(() => {});
      await subscription.unsubscribe().catch(() => {});
    }
    return true;
  } catch (error) {
    console.warn("[push] unsubscribe failed:", error);
    return false;
  }
}
