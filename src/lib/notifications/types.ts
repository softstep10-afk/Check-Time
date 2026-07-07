// Push notifications Phase 1 — shared types (channel-agnostic).

/** A user-facing notification, independent of delivery channel. */
export type NotificationPayload = {
  title: string;
  body: string;
  /** In-app URL to open on click. Defaults handled at the SW/client edge. */
  url?: string;
  /** Coalescing tag so repeats replace rather than stack. */
  tag?: string;
};

/** A stored web-push subscription for one device of one profile. */
export type PushSubscriptionRecord = {
  id: string;
  profile_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
  created_at: string;
  last_seen_at: string;
  revoked_at: string | null;
};

/** The raw browser PushSubscription shape the client sends to /subscribe. */
export type BrowserPushSubscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};
