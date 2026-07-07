import { beforeEach, describe, expect, it, vi } from "vitest";

// server-only throws outside a server bundle; stub it for the unit test.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/notifications/subscriptions", () => ({
  getActiveSubscriptions: vi.fn(),
  revokeById: vi.fn(),
}));
vi.mock("@/lib/notifications/web-push", () => ({
  sendWebPush: vi.fn(),
}));

import { sendNotificationToProfile } from "@/lib/notifications/send";
import { getActiveSubscriptions, revokeById } from "@/lib/notifications/subscriptions";
import { sendWebPush } from "@/lib/notifications/web-push";

const sub = (id: string) => ({
  id,
  profile_id: "worker-1",
  endpoint: `https://push.example/${id}`,
  p256dh: "p",
  auth: "a",
  user_agent: null,
  created_at: "",
  last_seen_at: "",
  revoked_at: null,
});

const payload = { title: "T", body: "B", url: "/clock", tag: "x" };

beforeEach(() => {
  vi.mocked(getActiveSubscriptions).mockReset();
  vi.mocked(revokeById).mockReset();
  vi.mocked(sendWebPush).mockReset();
});

describe("sendNotificationToProfile (channel-agnostic fan-out)", () => {
  it("no subscriptions → nothing sent, no revokes", async () => {
    vi.mocked(getActiveSubscriptions).mockResolvedValue([]);
    const result = await sendNotificationToProfile("worker-1", payload);
    expect(result).toMatchObject({ candidates: 0, sent: 0, revoked: 0, errored: 0 });
    expect(sendWebPush).not.toHaveBeenCalled();
  });

  it("counts sends and revokes gone (404/410) subscriptions", async () => {
    vi.mocked(getActiveSubscriptions).mockResolvedValue([sub("live"), sub("dead")]);
    vi.mocked(sendWebPush)
      .mockResolvedValueOnce({ status: "sent" })
      .mockResolvedValueOnce({ status: "gone" });

    const result = await sendNotificationToProfile("worker-1", payload);

    expect(result.candidates).toBe(2);
    expect(result.sent).toBe(1);
    expect(result.revoked).toBe(1);
    expect(revokeById).toHaveBeenCalledTimes(1);
    expect(revokeById).toHaveBeenCalledWith("dead");
  });

  it("marks skipped when the channel is unconfigured, and does not revoke", async () => {
    vi.mocked(getActiveSubscriptions).mockResolvedValue([sub("live")]);
    vi.mocked(sendWebPush).mockResolvedValue({ status: "skipped" });

    const result = await sendNotificationToProfile("worker-1", payload);

    expect(result.skipped).toBe(true);
    expect(result.sent).toBe(0);
    expect(revokeById).not.toHaveBeenCalled();
  });

  it("counts errors without revoking (kept for retry)", async () => {
    vi.mocked(getActiveSubscriptions).mockResolvedValue([sub("live")]);
    vi.mocked(sendWebPush).mockResolvedValue({ status: "error", message: "boom" });

    const result = await sendNotificationToProfile("worker-1", payload);

    expect(result.errored).toBe(1);
    expect(result.revoked).toBe(0);
    expect(revokeById).not.toHaveBeenCalled();
  });
});
