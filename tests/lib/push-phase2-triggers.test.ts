import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── dispatchNotification: strictly fire-and-forget ──────────────────────────
vi.mock("server-only", () => ({}));
const afterMock = vi.fn<(fn: () => unknown) => void>();
vi.mock("next/server", () => ({ after: (fn: () => unknown) => afterMock(fn) }));
const sendMock = vi.fn();
vi.mock("@/lib/notifications/send", () => ({
  sendNotificationToProfile: (...args: unknown[]) => sendMock(...args),
}));

import { dispatchNotification } from "@/lib/notifications/dispatch";

const payload = { title: "T", body: "B", url: "/my-tasks", tag: "task:1" };

beforeEach(() => {
  afterMock.mockReset();
  sendMock.mockReset();
});

describe("dispatchNotification (fire-and-forget)", () => {
  it("schedules the send via next `after` (does not run inline / delay the response)", () => {
    sendMock.mockResolvedValue({ sent: 1 });
    dispatchNotification("worker-1", payload);
    expect(afterMock).toHaveBeenCalledTimes(1);
    expect(sendMock).not.toHaveBeenCalled(); // scheduled, not run yet
  });

  it("runs the scheduled send with the profile + payload", async () => {
    sendMock.mockResolvedValue({ sent: 1 });
    dispatchNotification("worker-1", payload);
    await afterMock.mock.calls[0]![0]!();
    expect(sendMock).toHaveBeenCalledWith("worker-1", payload);
  });

  it("never throws when the send rejects", async () => {
    sendMock.mockRejectedValue(new Error("push service down"));
    dispatchNotification("worker-1", payload);
    await expect(afterMock.mock.calls[0]![0]!()).resolves.toBeUndefined();
  });

  it("falls back to a detached run when there is no request scope for `after`", () => {
    afterMock.mockImplementation(() => {
      throw new Error("after() called outside a request scope");
    });
    sendMock.mockResolvedValue({ sent: 0 });
    expect(() => dispatchNotification("worker-1", payload)).not.toThrow();
    expect(sendMock).toHaveBeenCalledWith("worker-1", payload);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Source guards for the two triggers + RED-LINE preservation ──────────────
function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const taskDispatch = read("src/lib/server/task-dispatch.ts");
const messageRoute = read("src/app/api/messages/send/route.ts");
const forceCheckout = read("src/components/manager/ForceCheckoutButton.tsx");
const sendForm = read("src/components/manager/SendMessageForm.tsx");
const bulkComposer = read("src/components/manager/BulkMessageComposer.tsx");

describe("Push Phase 2 — task assignment trigger", () => {
  it("createManagerTask fires a fire-and-forget push to the assignee only", () => {
    expect(taskDispatch).toContain("if (assignedTo) {");
    expect(taskDispatch).toContain("dispatchNotification(assignedTo");
    expect(taskDispatch).toContain('url: "/my-tasks"');
  });
});

describe("Push Phase 2 — message send route (auth + org validation + push)", () => {
  it("is auth-gated, manager-only, and stamps org_id/sender_id from the server profile", () => {
    expect(messageRoute).toContain("supabase.auth.getUser()");
    expect(messageRoute).toContain("{ status: 401 }");
    expect(messageRoute).toContain("isManagerRole(sender.role)");
    expect(messageRoute).toContain("{ status: 403 }");
    // Server-stamped identity — never trust the client for these.
    expect(messageRoute).toContain("org_id: sender.org_id");
    expect(messageRoute).toContain("sender_id: sender.id");
    // Recipients must be in the sender's org.
    expect(messageRoute).toContain('.eq("org_id", sender.org_id)');
    expect(messageRoute).toContain("not in your organization");
  });

  it("pushes each recipient (never the sender) fire-and-forget to the messages screen", () => {
    expect(messageRoute).toContain("=== sender.id) continue");
    expect(messageRoute).toContain("dispatchNotification(recipientId");
    expect(messageRoute).toContain('url: "/my-messages"');
  });
});

describe("Push Phase 2 — manager client sites use the server route", () => {
  for (const [name, src] of [
    ["ForceCheckoutButton", forceCheckout],
    ["SendMessageForm", sendForm],
    ["BulkMessageComposer", bulkComposer],
  ] as const) {
    it(`${name} sends online messages via the API route`, () => {
      expect(src).toContain("sendMessagesViaApi");
    });
  }

  it("offline drains are left untouched (still queue + direct-insert item.payload.rows)", () => {
    // RED LINE: offline queues untouched. The drain paths still insert directly.
    expect(sendForm).toContain(".insert(item.payload.rows)");
    expect(bulkComposer).toContain(".insert(item.payload.rows)");
    // The offline fallback on a network failure is preserved.
    expect(sendForm).toContain("queueOfflineFieldAction");
    expect(bulkComposer).toContain("queueOfflineFieldAction");
  });
});
