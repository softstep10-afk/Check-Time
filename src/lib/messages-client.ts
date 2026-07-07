// Client helper for the manager-side message send (Push Phase 2). The manager
// components used to insert into "messages" directly from the browser; now they
// POST here so the server can validate + dispatch pushes. Returns a
// supabase-insert-shaped { data, error } so callers stay near drop-in, and
// surfaces network failures as network-like errors so the existing offline-queue
// fallback (isNetworkLikeFieldError → queueOfflineFieldAction) still fires.

export type SentMessage = { id: string; recipient_id: string };

export type SendMessagesResult = {
  data: SentMessage[] | null;
  error: Error | null;
};

export async function sendMessagesViaApi(rows: unknown[]): Promise<SendMessagesResult> {
  // Offline: skip the doomed request and hand back a network-like error so the
  // caller queues the rows for the offline drain, exactly as before.
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { data: null, error: new Error("Failed to fetch (offline)") };
  }
  try {
    const response = await fetch("/api/messages/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows }),
    });
    const json = (await response.json().catch(() => null)) as
      | { messages?: SentMessage[]; error?: string }
      | null;
    if (!response.ok) {
      return { data: null, error: new Error(json?.error ?? `Message send failed (${response.status}).`) };
    }
    return { data: json?.messages ?? [], error: null };
  } catch (error) {
    // Network failure (e.g. connection dropped mid-request) — network-like error
    // so the caller falls back to the offline queue.
    return {
      data: null,
      error: error instanceof Error ? error : new Error("Network error sending message."),
    };
  }
}
