import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GPS_CONSENT_VERSION } from "@/lib/gps-consent";

// worker_location_consents is a WA-legal append-only record. These tests pin
// that the route trusts ONLY the session for identity and stamps the legal
// fields server-side, ignoring anything the client tries to inject.

vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  profile: null as { id: string; org_id: string } | null,
  profileError: null as unknown,
  insertedRow: null as Record<string, unknown> | null,
  insertError: null as unknown,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user }, error: null }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: state.profile, error: state.profileError }),
        }),
      }),
    }),
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        state.insertedRow = row;
        return Promise.resolve({ error: state.insertError });
      },
    }),
  }),
}));

import { NextRequest } from "next/server";
import { POST } from "@/app/api/worker/location-consent/route";

function req(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/worker/location-consent", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "TestUA/1.0", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.user = { id: "w-1" };
  state.profile = { id: "w-1", org_id: "org-1" };
  state.profileError = null;
  state.insertedRow = null;
  state.insertError = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/worker/location-consent — auth & validation", () => {
  it("401 when there is no session", async () => {
    state.user = null;
    const res = await POST(req({ signedName: "Ivan", granted: true }));
    expect(res.status).toBe(401);
    expect(state.insertedRow).toBeNull();
  });

  it("400 when granted is missing or not a boolean", async () => {
    expect((await POST(req({ signedName: "Ivan" }))).status).toBe(400);
    expect((await POST(req({ signedName: "Ivan", granted: "yes" }))).status).toBe(400);
    expect(state.insertedRow).toBeNull();
  });

  it("400 when signedName is missing or blank", async () => {
    expect((await POST(req({ granted: true }))).status).toBe(400);
    expect((await POST(req({ signedName: "   ", granted: true }))).status).toBe(400);
    expect(state.insertedRow).toBeNull();
  });

  it("400 when signedName exceeds the length cap", async () => {
    const res = await POST(req({ signedName: "x".repeat(201), granted: true }));
    expect(res.status).toBe(400);
    expect(state.insertedRow).toBeNull();
  });
});

describe("POST /api/worker/location-consent — server stamping", () => {
  it("inserts with identity from session and trims signedName", async () => {
    const res = await POST(
      req({ signedName: "  Ivan Petrov  ", granted: true }, { "x-forwarded-for": "1.1.1.1, 2.2.2.2, 3.3.3.3" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const row = state.insertedRow!;
    expect(row.worker_id).toBe("w-1");
    expect(row.org_id).toBe("org-1");
    expect(row.signed_name).toBe("Ivan Petrov");
    expect(row.consented).toBe(true);
    expect(row.consent_version).toBe(GPS_CONSENT_VERSION);
    expect(row.user_agent).toBe("TestUA/1.0");
    // Trusted (rightmost) forwarded hop, not the spoofable leftmost.
    expect(row.ip_address).toBe("3.3.3.3");
    // signed_at is the DB default now() — the server does not set it.
    expect(row.signed_at).toBeUndefined();
  });

  it("records a denied decision (consented=false) without special-casing", async () => {
    await POST(req({ signedName: "Ivan", granted: false }));
    expect(state.insertedRow!.consented).toBe(false);
  });

  it("IGNORES client-supplied consent_version / worker_id / org_id / consented / ip_address / signed_at", async () => {
    const res = await POST(
      req(
        {
          signedName: "Ivan",
          granted: true,
          // Hostile / spoofed fields a tampered client might inject:
          consent_version: 999,
          worker_id: "attacker-worker",
          org_id: "attacker-org",
          consented: false,
          ip_address: "6.6.6.6",
          signed_at: "1999-01-01T00:00:00Z",
        },
        { "x-forwarded-for": "9.9.9.9" },
      ),
    );
    expect(res.status).toBe(200);

    const row = state.insertedRow!;
    expect(row.consent_version).toBe(GPS_CONSENT_VERSION); // NOT 999
    expect(row.worker_id).toBe("w-1"); // from session, NOT body
    expect(row.org_id).toBe("org-1"); // from session, NOT body
    expect(row.consented).toBe(true); // from `granted`, NOT body.consented
    expect(row.ip_address).toBe("9.9.9.9"); // trusted header, NOT body
    expect(row.signed_at).toBeUndefined(); // DB default, never the body value
  });
});
