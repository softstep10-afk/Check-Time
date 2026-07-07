import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted mutable state the module mocks read from (avoids the vi.mock hoisting trap).
const h = vi.hoisted(() => ({
  sender: { id: "mgr-1", org_id: "org-1", role: "manager", name: "Boss" } as {
    id: string;
    org_id: string;
    role: string;
    name: string | null;
  } | null,
  validRecipientIds: ["w1", "w2"] as string[],
  insertResult: null as null | ((rows: unknown[]) => { data: unknown; error: unknown }),
  insertCapture: { rows: null as unknown[] | null },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/notifications/dispatch", () => ({ dispatchNotification: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "mgr-1" } }, error: null }) },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      if (table === "profiles") {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          in(_col: string, ids: string[]) {
            return Promise.resolve({
              data: h.validRecipientIds.filter((id) => ids.includes(id)).map((id) => ({ id })),
              error: null,
            });
          },
          maybeSingle() {
            return Promise.resolve({ data: h.sender, error: null });
          },
        };
      }
      if (table === "messages") {
        return {
          insert(rows: unknown[]) {
            h.insertCapture.rows = rows;
            return { select: () => Promise.resolve(h.insertResult!(rows)) };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

import { POST } from "@/app/api/messages/send/route";

type Row = Record<string, unknown>;
function post(rows: Row[]) {
  return POST({ json: async () => ({ rows }) } as never);
}
function captured(): Row[] {
  return (h.insertCapture.rows ?? []) as Row[];
}

beforeEach(() => {
  h.sender = { id: "mgr-1", org_id: "org-1", role: "manager", name: "Boss" };
  h.validRecipientIds = ["w1", "w2"];
  h.insertResult = (rows) => ({
    data: (rows as Row[]).map((r, i) => ({ id: `m${i}`, recipient_id: r.recipient_id })),
    error: null,
  });
  h.insertCapture.rows = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/messages/send — validation hardening", () => {
  it("a partial row missing color → 200 (not 500), color defaulted from priority", async () => {
    const res = await post([{ recipient_id: "w1", text: "hi", priority: "urgent" }]);
    expect(res.status).toBe(200);
    // urgent → #ef4444 (PRIORITY_COLOR), never null (the NOT NULL 500 in live smoke).
    expect(captured()[0].color).toBe("#ef4444");
    expect(captured()[0].color).not.toBeNull();
  });

  it("no color and no priority → info color default", async () => {
    const res = await post([{ recipient_id: "w1", text: "hi" }]);
    expect(res.status).toBe(200);
    expect(captured()[0].priority).toBe("info");
    expect(captured()[0].color).toBe("#f59e0b");
  });

  it("strips unknown keys and never trusts client org_id/sender_id", async () => {
    await post([
      {
        recipient_id: "w1",
        text: "hi",
        color: "#ef4444",
        evilKey: "DROP TABLE",
        sender_id: "attacker",
        org_id: "other-org",
        id: "forged-id",
      },
    ]);
    const row = captured()[0];
    expect(Object.keys(row).sort()).toEqual(
      ["attachment", "color", "metadata", "org_id", "priority", "recipient_id", "sender_id", "text"].sort(),
    );
    expect(row.evilKey).toBeUndefined();
    expect(row.id).toBeUndefined();
    expect(row.org_id).toBe("org-1"); // server-stamped
    expect(row.sender_id).toBe("mgr-1"); // server-stamped, not "attacker"
  });

  it("clamps an invalid priority to info", async () => {
    await post([{ recipient_id: "w1", text: "hi", priority: "SUPER_URGENT" }]);
    expect(captured()[0].priority).toBe("info");
    expect(captured()[0].color).toBe("#f59e0b");
  });

  it("rejects a row with no recipient with 400", async () => {
    const res = await post([{ text: "hi" }]);
    expect(res.status).toBe(400);
  });

  it("rejects a row with no text with 400", async () => {
    const res = await post([{ recipient_id: "w1" }]);
    expect(res.status).toBe(400);
  });

  // RED LINE: full rows the components send today are unchanged.
  it("preserves an explicit color the client sends", async () => {
    await post([{ recipient_id: "w1", text: "hi", color: "#22c55e", priority: "good" }]);
    expect(captured()[0].color).toBe("#22c55e");
    expect(captured()[0].priority).toBe("good");
  });
});

describe("POST /api/messages/send — error hygiene", () => {
  it("in production, an insert error never leaks raw Postgres constraint text", async () => {
    vi.stubEnv("NODE_ENV", "production");
    h.insertResult = () => ({
      data: null,
      error: {
        code: "23502",
        message: 'null value in column "color" violates not-null constraint',
      },
    });
    try {
      const res = await post([{ recipient_id: "w1", text: "hi" }]);
      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("Could not send message.");
      expect(body.error).not.toContain("constraint");
      expect(body.error).not.toContain("column");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
