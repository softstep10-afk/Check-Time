import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `server-only` is a Next.js sentinel module that throws if imported
// from a client bundle. Vitest runs in a node env without that module,
// so we stub it before resolving the SUT.
vi.mock("server-only", () => ({}));

import {
  LINK_CHECKOUT_AUDIT_ACTION,
  runLinkCheckoutVideo,
  type LinkCheckoutVideoInput,
  type LinkSupabaseClient,
} from "@/lib/checkout-link-server";
import {
  CHECKOUT_LINK_WINDOW_MS,
  type CandidateMediaRow,
  type ClockOutEventLite,
} from "@/lib/checkout-link";

/**
 * Route-orchestration tests for /api/worker/link-checkout-video.
 *
 * The pure helpers in checkout-link.test.ts already cover the
 * decision logic (validateClockOutEvent + selectLinkableMediaIds).
 * These tests exercise the wiring that the route depends on:
 *   • the admin UPDATE re-asserts every predicate so a TOCTOU race
 *     can't widen the blast radius;
 *   • already-linked checkout media can clear video_status without
 *     needing a second media UPDATE;
 *   • the audit_log row gets the documented shape;
 *   • a failed audit insert never demotes a successful link;
 *   • each error branch returns the documented status code.
 *
 * Mocks are explicit, narrow, and record every chain step so a
 * future regression that drops .eq("uploaded_by", ...) from the
 * UPDATE — the exact shape of footgun this whole route exists to
 * prevent — fails a test instead of a security review.
 */

// ──────────────────────────────────────────────────────────────────────
// Supabase chain mock. Each chain method returns the same proxy and
// records its name + args. Awaiting the chain (or calling a terminal
// method like maybeSingle()) resolves to the configured terminalResult.
// ──────────────────────────────────────────────────────────────────────

type ChainCall = [method: string, args: unknown[]];

interface ChainHandle {
  calls: ChainCall[];
  terminalArgs: { method: string; args: unknown[] } | null;
}

function makeChain(terminalResult: { data: unknown; error: unknown }): {
  proxy: unknown;
  handle: ChainHandle;
} {
  const handle: ChainHandle = { calls: [], terminalArgs: null };

  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop: string | symbol) {
        if (prop === "then") {
          // PromiseLike — consumers can `await chain` directly.
          return (
            resolve: (v: unknown) => void,
            reject: (e: unknown) => void,
          ) => Promise.resolve(terminalResult).then(resolve, reject);
        }
        const name = String(prop);
        return (...args: unknown[]) => {
          handle.calls.push([name, args]);
          if (
            name === "maybeSingle" ||
            name === "single" ||
            name === "returns"
          ) {
            handle.terminalArgs = { method: name, args };
            // maybeSingle / single resolve to {data, error}; returns is
            // a typing-only no-op that returns the same builder. We
            // collapse all three to the configured terminal value.
            if (name === "returns") return proxy;
            return Promise.resolve(terminalResult);
          }
          return proxy;
        };
      },
    },
  );

  return { proxy, handle };
}

// ──────────────────────────────────────────────────────────────────────
// Per-table mock client builder.
// ──────────────────────────────────────────────────────────────────────

interface TableTrace {
  selectChain?: ChainHandle;
  updateChain?: ChainHandle;
  insertChain?: ChainHandle;
  insertCalls?: unknown[][];
}

interface SupabaseMockBuilder {
  client: LinkSupabaseClient;
  traces: Record<string, TableTrace>;
}

interface TableSpec {
  selectResult?: { data: unknown; error: unknown };
  updateResult?: { data: unknown; error: unknown };
  insertResult?: { data: unknown; error: unknown };
}

function buildSupabaseMock(
  tables: Record<string, TableSpec>,
): SupabaseMockBuilder {
  const traces: Record<string, TableTrace> = {};
  for (const name of Object.keys(tables)) traces[name] = {};

  // Cast to LinkSupabaseClient at the boundary: the proxy chain is
  // structurally compatible at runtime but TS can't prove it without
  // pulling the full PostgrestQueryBuilder type into a test file.
  const client = {
    from(table: string) {
      const spec = tables[table];
      if (!spec) {
        throw new Error(`unexpected table access in mock: ${table}`);
      }
      const trace = traces[table];

      return {
        select(...args: unknown[]) {
          const { proxy, handle } = makeChain(
            spec.selectResult ?? { data: [], error: null },
          );
          trace.selectChain = handle;
          handle.calls.push(["select", args]);
          return proxy;
        },
        update(...args: unknown[]) {
          const { proxy, handle } = makeChain(
            spec.updateResult ?? { data: [], error: null },
          );
          trace.updateChain = handle;
          handle.calls.push(["update", args]);
          return proxy;
        },
        insert(...args: unknown[]) {
          // audit_log path uses the terminal `await admin.from(...).insert(...)`
          // so insert() itself must be awaitable, not a chain.
          trace.insertCalls ??= [];
          trace.insertCalls.push(args);
          return Promise.resolve(
            spec.insertResult ?? { data: null, error: null },
          );
        },
      };
    },
  };

  return { traces, client: client as unknown as LinkSupabaseClient };
}

// ──────────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────────

const callerId = "11111111-1111-1111-1111-111111111111";
const orgId = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const projectId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const eventId = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const mediaIdA = "media-a-aaaa";
const mediaIdB = "media-b-bbbb";

const now = new Date("2026-05-06T18:00:00.000Z").getTime();
const repairWindowStartIso = new Date(now - CHECKOUT_LINK_WINDOW_MS).toISOString();

function buildEvent(over: Partial<ClockOutEventLite> = {}): ClockOutEventLite {
  return {
    id: eventId,
    profile_id: callerId,
    project_id: projectId,
    org_id: orgId,
    event_type: "clock_out",
    event_time: new Date(now).toISOString(),
    ...over,
  };
}

function buildCandidate(
  over: Partial<CandidateMediaRow> = {},
): CandidateMediaRow {
  return {
    id: mediaIdA,
    uploaded_by: callerId,
    project_id: projectId,
    org_id: orgId,
    media_type: "video",
    is_checkout: true,
    time_event_id: null,
    created_at: "2026-05-06T17:55:00.000Z",
    ...over,
  };
}

function buildInput(
  overrides: Partial<LinkCheckoutVideoInput> & {
    supabase: LinkCheckoutVideoInput["supabase"];
    admin: LinkCheckoutVideoInput["admin"];
  },
): LinkCheckoutVideoInput {
  return {
    userId: callerId,
    timeEventId: eventId,
    now,
    ...overrides,
  };
}

// Each test silences console.warn so a noisy log doesn't pollute CI
// output; we still assert console.warn was called when relevant.
let warnSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  warnSpy.mockRestore();
});

// ──────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────

describe("runLinkCheckoutVideo — happy path", () => {
  it("links one candidate, returns 200 with the linked id, and writes the audit row", async () => {
    const userMock = buildSupabaseMock({
      time_events: { selectResult: { data: buildEvent(), error: null } },
    });
    const adminMock = buildSupabaseMock({
      media: {
        selectResult: { data: [buildCandidate()], error: null },
        updateResult: { data: [{ id: mediaIdA }], error: null },
      },
      time_events: { updateResult: { data: null, error: null } },
      profiles: {
        selectResult: { data: { name: "Andrew", role: "owner" }, error: null },
      },
      audit_log: { insertResult: { data: null, error: null } },
    });

    const result = await runLinkCheckoutVideo(
      buildInput({ supabase: userMock.client, admin: adminMock.client }),
    );

    expect(result).toEqual({
      ok: true,
      status: 200,
      body: { ok: true, linked: 1, mediaIds: [mediaIdA] },
    });

    // The UPDATE must re-assert every predicate the candidate read used.
    // This is the regression guard against the "TOCTOU race widens the
    // blast radius" footgun the route exists to prevent.
    const updateCalls = adminMock.traces.media.updateChain!.calls;
    const methodNames = updateCalls.map(([m]) => m);
    expect(methodNames).toEqual([
      "update",
      "in",
      "eq",
      "eq",
      "eq",
      "eq",
      "eq",
      "is",
      "select",
    ]);
    // update payload must contain ONLY time_event_id — never storage,
    // mime, caption, or metadata.
    expect(updateCalls[0]).toEqual(["update", [{ time_event_id: eventId }]]);
    expect(updateCalls[1]).toEqual(["in", ["id", [mediaIdA]]]);
    expect(updateCalls[2]).toEqual(["eq", ["uploaded_by", callerId]]);
    expect(updateCalls[3]).toEqual(["eq", ["project_id", projectId]]);
    expect(updateCalls[4]).toEqual(["eq", ["org_id", orgId]]);
    expect(updateCalls[5]).toEqual(["eq", ["media_type", "video"]]);
    expect(updateCalls[6]).toEqual(["eq", ["is_checkout", true]]);
    expect(updateCalls[7]).toEqual(["is", ["time_event_id", null]]);
    expect(updateCalls[8]).toEqual(["select", ["id"]]);

    // Audit row matches the documented shape.
    const auditInserts = adminMock.traces.audit_log.insertCalls!;
    expect(auditInserts).toHaveLength(1);
    const auditRow = auditInserts[0][0] as Record<string, unknown>;
    expect(auditRow).toMatchObject({
      org_id: orgId,
      actor_id: callerId,
      actor_name: "Andrew",
      actor_role: "owner",
      action: LINK_CHECKOUT_AUDIT_ACTION,
      target_type: "time_event",
      target_id: eventId,
      before_data: null,
    });
    expect(auditRow.after_data).toMatchObject({
      time_event_id: eventId,
      project_id: projectId,
      media_ids: [mediaIdA],
    });
  });

  it("links multiple candidates in a single UPDATE", async () => {
    const userMock = buildSupabaseMock({
      time_events: { selectResult: { data: buildEvent(), error: null } },
    });
    const adminMock = buildSupabaseMock({
      media: {
        selectResult: {
          data: [
            buildCandidate({ id: mediaIdA }),
            buildCandidate({
              id: mediaIdB,
              created_at: "2026-05-06T16:00:00.000Z",
            }),
          ],
          error: null,
        },
        updateResult: {
          data: [{ id: mediaIdA }, { id: mediaIdB }],
          error: null,
        },
      },
      profiles: {
        selectResult: { data: { name: "Andrew", role: "owner" }, error: null },
      },
      audit_log: { insertResult: { data: null, error: null } },
    });

    const result = await runLinkCheckoutVideo(
      buildInput({ supabase: userMock.client, admin: adminMock.client }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body.linked).toBe(2);
      expect(result.body.mediaIds.sort()).toEqual([mediaIdA, mediaIdB].sort());
    }

    // The .in() argument must include both ids.
    const inCall = adminMock.traces.media.updateChain!.calls.find(
      ([m]) => m === "in",
    );
    expect(inCall).toBeDefined();
    expect((inCall![1][1] as string[]).sort()).toEqual(
      [mediaIdA, mediaIdB].sort(),
    );

    const auditRow = adminMock.traces.audit_log.insertCalls![0][0] as Record<
      string,
      unknown
    >;
    const after = auditRow.after_data as { media_ids: string[] };
    expect(after.media_ids.sort()).toEqual([mediaIdA, mediaIdB].sort());
  });

  it("links before_leave media from a multi-day shift instead of only today's uploads", async () => {
    const oldProof = buildCandidate({
      id: "media-old-proof",
      created_at: "2026-05-01T18:00:00.000Z",
    });
    const userMock = buildSupabaseMock({
      time_events: { selectResult: { data: buildEvent(), error: null } },
    });
    const adminMock = buildSupabaseMock({
      media: {
        selectResult: { data: [oldProof], error: null },
        updateResult: { data: [{ id: oldProof.id }], error: null },
      },
      time_events: { updateResult: { data: null, error: null } },
      profiles: {
        selectResult: { data: { name: "Andrew", role: "owner" }, error: null },
      },
      audit_log: { insertResult: { data: null, error: null } },
    });

    const result = await runLinkCheckoutVideo(
      buildInput({ supabase: userMock.client, admin: adminMock.client }),
    );

    expect(result).toEqual({
      ok: true,
      status: 200,
      body: { ok: true, linked: 1, mediaIds: [oldProof.id] },
    });
    expect(adminMock.traces.media.selectChain!.calls).toContainEqual([
      "gte",
      ["created_at", repairWindowStartIso],
    ]);
  });

  it("returns linked:0 with no UPDATE call (and no video_status flip) when there are no candidates", async () => {
    const userMock = buildSupabaseMock({
      time_events: { selectResult: { data: buildEvent(), error: null } },
    });
    const adminMock = buildSupabaseMock({
      media: { selectResult: { data: [], error: null } },
      // time_events absent on purpose: if the orchestration tries to
      // touch it when nothing was linked, the mock throws and the test
      // fails — that's the assertion.
    });

    const result = await runLinkCheckoutVideo(
      buildInput({ supabase: userMock.client, admin: adminMock.client }),
    );

    expect(result).toEqual({
      ok: true,
      status: 200,
      body: { ok: true, linked: 0, mediaIds: [] },
    });
    expect(adminMock.traces.media.updateChain).toBeUndefined();
  });

  it("treats checkout media already linked to the event as proof and flips video_status", async () => {
    const userMock = buildSupabaseMock({
      time_events: { selectResult: { data: buildEvent(), error: null } },
    });
    const adminMock = buildSupabaseMock({
      media: {
        selectResult: {
          data: [buildCandidate({ time_event_id: eventId })],
          error: null,
        },
      },
      time_events: { updateResult: { data: null, error: null } },
      profiles: {
        selectResult: { data: { name: "Andrew", role: "owner" }, error: null },
      },
      audit_log: { insertResult: { data: null, error: null } },
    });

    const result = await runLinkCheckoutVideo(
      buildInput({ supabase: userMock.client, admin: adminMock.client }),
    );

    expect(result).toEqual({
      ok: true,
      status: 200,
      body: { ok: true, linked: 0, mediaIds: [mediaIdA] },
    });
    expect(adminMock.traces.media.updateChain).toBeUndefined();
    expect(adminMock.traces.time_events.updateChain!.calls[0]).toEqual([
      "update",
      [{ video_status: "uploaded" }],
    ]);
  });
});

describe("runLinkCheckoutVideo — video_status flip", () => {
  it("flips time_events.video_status from 'pending' to 'uploaded' with the right predicates after a successful link", async () => {
    const userMock = buildSupabaseMock({
      time_events: { selectResult: { data: buildEvent(), error: null } },
    });
    const adminMock = buildSupabaseMock({
      media: {
        selectResult: { data: [buildCandidate()], error: null },
        updateResult: { data: [{ id: mediaIdA }], error: null },
      },
      time_events: { updateResult: { data: null, error: null } },
      profiles: {
        selectResult: { data: { name: "Andrew", role: "owner" }, error: null },
      },
      audit_log: { insertResult: { data: null, error: null } },
    });

    const result = await runLinkCheckoutVideo(
      buildInput({ supabase: userMock.client, admin: adminMock.client }),
    );

    expect(result.ok).toBe(true);

    const calls = adminMock.traces.time_events.updateChain!.calls;
    expect(calls[0]).toEqual(["update", [{ video_status: "uploaded" }]]);
    // Must scope by event id AND profile id AND current status — never
    // a blanket update that could downgrade 'verified' or affect a
    // different worker's row.
    const filterCalls = calls.slice(1);
    expect(filterCalls).toContainEqual(["eq", ["id", eventId]]);
    expect(filterCalls).toContainEqual(["eq", ["profile_id", callerId]]);
    expect(filterCalls).toContainEqual(["eq", ["video_status", "pending"]]);
  });

  it("does NOT touch time_events when no media was linked", async () => {
    const userMock = buildSupabaseMock({
      time_events: { selectResult: { data: buildEvent(), error: null } },
    });
    const adminMock = buildSupabaseMock({
      media: { selectResult: { data: [], error: null } },
      // time_events deliberately absent — accessing it would throw.
    });

    const result = await runLinkCheckoutVideo(
      buildInput({ supabase: userMock.client, admin: adminMock.client }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.body.linked).toBe(0);
  });

  it("still returns 200 when the video_status flip errors, and logs the warning", async () => {
    const userMock = buildSupabaseMock({
      time_events: { selectResult: { data: buildEvent(), error: null } },
    });
    const adminMock = buildSupabaseMock({
      media: {
        selectResult: { data: [buildCandidate()], error: null },
        updateResult: { data: [{ id: mediaIdA }], error: null },
      },
      time_events: {
        updateResult: { data: null, error: { message: "trigger refused" } },
      },
      profiles: {
        selectResult: { data: { name: "Andrew", role: "owner" }, error: null },
      },
      audit_log: { insertResult: { data: null, error: null } },
    });

    const result = await runLinkCheckoutVideo(
      buildInput({ supabase: userMock.client, admin: adminMock.client }),
    );

    expect(result).toEqual({
      ok: true,
      status: 200,
      body: { ok: true, linked: 1, mediaIds: [mediaIdA] },
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "[link-checkout-video] video_status flip failed:",
      ),
      "trigger refused",
    );
  });
});

describe("runLinkCheckoutVideo — validation", () => {
  it("returns 404 when the time_event does not exist", async () => {
    const userMock = buildSupabaseMock({
      time_events: { selectResult: { data: null, error: null } },
    });
    const adminMock = buildSupabaseMock({
      media: { selectResult: { data: [], error: null } },
    });

    const result = await runLinkCheckoutVideo(
      buildInput({ supabase: userMock.client, admin: adminMock.client }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
      expect(result.body.error).toMatch(/not found/i);
    }
    expect(adminMock.traces.media.selectChain).toBeUndefined();
  });

  it("returns 403 when the time_event belongs to another worker", async () => {
    const userMock = buildSupabaseMock({
      time_events: {
        selectResult: {
          data: buildEvent({
            profile_id: "22222222-2222-2222-2222-222222222222",
          }),
          error: null,
        },
      },
    });
    const adminMock = buildSupabaseMock({
      media: { selectResult: { data: [], error: null } },
    });

    const result = await runLinkCheckoutVideo(
      buildInput({ supabase: userMock.client, admin: adminMock.client }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
    }
    expect(adminMock.traces.media.selectChain).toBeUndefined();
  });

  it("returns 400 when the time_event is a clock_in", async () => {
    const userMock = buildSupabaseMock({
      time_events: {
        selectResult: {
          data: buildEvent({ event_type: "clock_in" }),
          error: null,
        },
      },
    });
    const adminMock = buildSupabaseMock({
      media: { selectResult: { data: [], error: null } },
    });

    const result = await runLinkCheckoutVideo(
      buildInput({ supabase: userMock.client, admin: adminMock.client }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
    }
  });

  it("returns 400 when the event_time is older than the repair window", async () => {
    const ancient = new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString();
    const userMock = buildSupabaseMock({
      time_events: {
        selectResult: {
          data: buildEvent({ event_time: ancient }),
          error: null,
        },
      },
    });
    const adminMock = buildSupabaseMock({
      media: { selectResult: { data: [], error: null } },
    });

    const result = await runLinkCheckoutVideo(
      buildInput({ supabase: userMock.client, admin: adminMock.client }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
    }
  });
});

describe("runLinkCheckoutVideo — error propagation", () => {
  it("returns 500 when the time_events read errors", async () => {
    const userMock = buildSupabaseMock({
      time_events: {
        selectResult: { data: null, error: { message: "db down" } },
      },
    });
    const adminMock = buildSupabaseMock({
      media: { selectResult: { data: [], error: null } },
    });

    const result = await runLinkCheckoutVideo(
      buildInput({ supabase: userMock.client, admin: adminMock.client }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(500);
      expect(result.body.error).toBe("db down");
    }
  });

  it("returns 500 when the candidate fetch errors", async () => {
    const userMock = buildSupabaseMock({
      time_events: { selectResult: { data: buildEvent(), error: null } },
    });
    const adminMock = buildSupabaseMock({
      media: {
        selectResult: { data: null, error: { message: "perm denied" } },
      },
    });

    const result = await runLinkCheckoutVideo(
      buildInput({ supabase: userMock.client, admin: adminMock.client }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(500);
      expect(result.body.error).toBe("perm denied");
    }
  });

  it("returns 500 when the UPDATE errors and writes no audit row", async () => {
    const userMock = buildSupabaseMock({
      time_events: { selectResult: { data: buildEvent(), error: null } },
    });
    const adminMock = buildSupabaseMock({
      media: {
        selectResult: { data: [buildCandidate()], error: null },
        updateResult: { data: null, error: { message: "fk violated" } },
      },
      // time_events update never reached because the media UPDATE fails first.
      profiles: {
        selectResult: { data: { name: "Andrew", role: "owner" }, error: null },
      },
      audit_log: { insertResult: { data: null, error: null } },
    });

    const result = await runLinkCheckoutVideo(
      buildInput({ supabase: userMock.client, admin: adminMock.client }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(500);
      expect(result.body.error).toBe("fk violated");
    }
    expect(adminMock.traces.audit_log.insertCalls).toBeUndefined();
  });
});

describe("runLinkCheckoutVideo — audit best-effort", () => {
  it("still returns 200 when the audit insert errors, and logs the warning", async () => {
    const userMock = buildSupabaseMock({
      time_events: { selectResult: { data: buildEvent(), error: null } },
    });
    const adminMock = buildSupabaseMock({
      media: {
        selectResult: { data: [buildCandidate()], error: null },
        updateResult: { data: [{ id: mediaIdA }], error: null },
      },
      time_events: { updateResult: { data: null, error: null } },
      profiles: {
        selectResult: { data: { name: "Andrew", role: "owner" }, error: null },
      },
      audit_log: {
        insertResult: { data: null, error: { message: "audit write failed" } },
      },
    });

    const result = await runLinkCheckoutVideo(
      buildInput({ supabase: userMock.client, admin: adminMock.client }),
    );

    expect(result).toEqual({
      ok: true,
      status: 200,
      body: { ok: true, linked: 1, mediaIds: [mediaIdA] },
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[link-checkout-video] audit insert failed:"),
      "audit write failed",
    );
  });

  it("falls back to 'Worker' / 'worker' when the profile lookup returns no row", async () => {
    const userMock = buildSupabaseMock({
      time_events: { selectResult: { data: buildEvent(), error: null } },
    });
    const adminMock = buildSupabaseMock({
      media: {
        selectResult: { data: [buildCandidate()], error: null },
        updateResult: { data: [{ id: mediaIdA }], error: null },
      },
      time_events: { updateResult: { data: null, error: null } },
      profiles: { selectResult: { data: null, error: null } },
      audit_log: { insertResult: { data: null, error: null } },
    });

    const result = await runLinkCheckoutVideo(
      buildInput({ supabase: userMock.client, admin: adminMock.client }),
    );

    expect(result.ok).toBe(true);
    const auditRow = adminMock.traces.audit_log.insertCalls![0][0] as Record<
      string,
      unknown
    >;
    expect(auditRow).toMatchObject({
      actor_name: "Worker",
      actor_role: "worker",
    });
  });
});

describe("runLinkCheckoutVideo — predicate independence", () => {
  it("the candidate fetch must never query a different worker's media", async () => {
    // If a future regression silently swaps user.id for some other id
    // (e.g., picks event.profile_id without verifying it == user.id),
    // this assertion makes sure the .eq("uploaded_by", ...) on the
    // candidate fetch still uses the caller's id.
    const userMock = buildSupabaseMock({
      time_events: { selectResult: { data: buildEvent(), error: null } },
    });
    const adminMock = buildSupabaseMock({
      media: { selectResult: { data: [], error: null } },
    });

    await runLinkCheckoutVideo(
      buildInput({ supabase: userMock.client, admin: adminMock.client }),
    );

    const calls = adminMock.traces.media.selectChain!.calls;
    const eqCalls = calls.filter(([m]) => m === "eq");
    expect(eqCalls).toContainEqual(["eq", ["uploaded_by", callerId]]);
    expect(eqCalls).toContainEqual(["eq", ["project_id", projectId]]);
    expect(eqCalls).toContainEqual(["eq", ["org_id", orgId]]);
    expect(eqCalls).toContainEqual(["eq", ["media_type", "video"]]);
    expect(eqCalls).toContainEqual(["eq", ["is_checkout", true]]);
    const isCalls = calls.filter(([m]) => m === "is");
    expect(isCalls).toEqual([]);
    const gteCalls = calls.filter(([m]) => m === "gte");
    expect(gteCalls).toContainEqual(["gte", ["created_at", repairWindowStartIso]]);
  });
});
