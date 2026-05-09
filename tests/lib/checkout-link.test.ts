import { describe, expect, it } from "vitest";
import {
  CHECKOUT_LINK_WINDOW_MS,
  checkoutMediaWindowStartIso,
  selectLinkableMediaIds,
  startOfTodayIso,
  validateClockOutEvent,
  type CandidateMediaRow,
  type ClockOutEventLite,
} from "@/lib/checkout-link";

const callerId = "11111111-1111-1111-1111-111111111111";
const otherWorkerId = "22222222-2222-2222-2222-222222222222";
const projectId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const otherProjectId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const orgId = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const otherOrgId = "dddddddd-dddd-dddd-dddd-dddddddddddd";

const now = new Date("2026-05-06T18:00:00.000Z");
const nowMs = now.getTime();
const todayStartIso = "2026-05-06T00:00:00.000Z";

function buildEvent(over: Partial<ClockOutEventLite> = {}): ClockOutEventLite {
  return {
    id: "event-1",
    profile_id: callerId,
    project_id: projectId,
    org_id: orgId,
    event_type: "clock_out",
    event_time: now.toISOString(),
    ...over,
  };
}

function buildMedia(over: Partial<CandidateMediaRow> = {}): CandidateMediaRow {
  return {
    id: "media-1",
    uploaded_by: callerId,
    project_id: projectId,
    org_id: orgId,
    media_type: "video",
    is_checkout: true,
    time_event_id: null,
    created_at: "2026-05-06T17:50:00.000Z",
    ...over,
  };
}

describe("validateClockOutEvent", () => {
  it("accepts a recent clock_out belonging to the caller", () => {
    const result = validateClockOutEvent(buildEvent(), callerId, nowMs);
    expect(result).toEqual({ ok: true });
  });

  it("rejects a missing event with 404", () => {
    const result = validateClockOutEvent(null, callerId, nowMs);
    expect(result).toEqual({
      ok: false,
      status: 404,
      error: "time_event not found",
    });
  });

  it("rejects an event belonging to another worker with 403", () => {
    const result = validateClockOutEvent(
      buildEvent({ profile_id: otherWorkerId }),
      callerId,
      nowMs,
    );
    expect(result).toEqual({
      ok: false,
      status: 403,
      error: "Not your shift",
    });
  });

  it("rejects a clock_in event with 400", () => {
    const result = validateClockOutEvent(
      buildEvent({ event_type: "clock_in" }),
      callerId,
      nowMs,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
    }
  });

  it("rejects an event older than the repair window", () => {
    const ancient = new Date(nowMs - 8 * 24 * 60 * 60 * 1000).toISOString();
    const result = validateClockOutEvent(
      buildEvent({ event_time: ancient }),
      callerId,
      nowMs,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
    }
  });

  it("accepts an event right at the repair window edge", () => {
    const edge = new Date(nowMs - CHECKOUT_LINK_WINDOW_MS).toISOString();
    const result = validateClockOutEvent(
      buildEvent({ event_time: edge }),
      callerId,
      nowMs,
    );
    expect(result.ok).toBe(true);
  });

  it("rejects malformed event_time", () => {
    const result = validateClockOutEvent(
      buildEvent({ event_time: "not-a-date" }),
      callerId,
      nowMs,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
    }
  });
});

describe("selectLinkableMediaIds", () => {
  const opts = {
    callerProfileId: callerId,
    projectId,
    orgId,
    windowStartIso: todayStartIso,
  };

  it("links a before_leave video uploaded today by the caller", () => {
    const ids = selectLinkableMediaIds([buildMedia({ id: "video-1" })], opts);
    expect(ids).toEqual(["video-1"]);
  });

  it("never links someone else's media", () => {
    const ids = selectLinkableMediaIds(
      [buildMedia({ id: "stranger", uploaded_by: otherWorkerId })],
      opts,
    );
    expect(ids).toEqual([]);
  });

  it("never links media from another project", () => {
    const ids = selectLinkableMediaIds(
      [buildMedia({ id: "wrong-project", project_id: otherProjectId })],
      opts,
    );
    expect(ids).toEqual([]);
  });

  it("never links media from another org", () => {
    const ids = selectLinkableMediaIds(
      [buildMedia({ id: "wrong-org", org_id: otherOrgId })],
      opts,
    );
    expect(ids).toEqual([]);
  });

  it("never links rows that are not is_checkout", () => {
    const ids = selectLinkableMediaIds(
      [buildMedia({ id: "journal", is_checkout: false })],
      opts,
    );
    expect(ids).toEqual([]);
  });

  it("never links non-video rows even when they are marked is_checkout", () => {
    const ids = selectLinkableMediaIds(
      [buildMedia({ id: "photo-checkout", media_type: "photo" })],
      opts,
    );
    expect(ids).toEqual([]);
  });

  it("never overwrites an existing time_event_id", () => {
    const ids = selectLinkableMediaIds(
      [buildMedia({ id: "already", time_event_id: "old-event" })],
      opts,
    );
    expect(ids).toEqual([]);
  });

  it("never links media created before today's window", () => {
    const ids = selectLinkableMediaIds(
      [buildMedia({ id: "yesterday", created_at: "2026-05-05T18:00:00.000Z" })],
      opts,
    );
    expect(ids).toEqual([]);
  });

  it("links older before_leave media when the caller uses a wider repair window", () => {
    const ids = selectLinkableMediaIds(
      [
        buildMedia({
          id: "multi-day-shift-proof",
          created_at: "2026-05-01T18:00:00.000Z",
        }),
      ],
      { ...opts, windowStartIso: checkoutMediaWindowStartIso(now.toISOString()) },
    );
    expect(ids).toEqual(["multi-day-shift-proof"]);
  });

  it("returns multiple ids when several videos qualify (multi-clip checkout)", () => {
    const ids = selectLinkableMediaIds(
      [
        buildMedia({ id: "clip-a", created_at: "2026-05-06T16:00:00.000Z" }),
        buildMedia({ id: "clip-b", created_at: "2026-05-06T17:30:00.000Z" }),
      ],
      opts,
    );
    expect(ids.sort()).toEqual(["clip-a", "clip-b"]);
  });

  it("integration: a freshly uploaded before_leave video links to a fresh clock_out", () => {
    // End-to-end pure case: the validation pass + selection pass both
    // approve the canonical happy path the WorkerShell triggers.
    const event = buildEvent();
    const validation = validateClockOutEvent(event, callerId, nowMs);
    expect(validation.ok).toBe(true);

    const beforeLeaveVideo = buildMedia({
      id: "video-bl",
      created_at: "2026-05-06T17:55:00.000Z",
      time_event_id: null,
    });
    const ids = selectLinkableMediaIds([beforeLeaveVideo], opts);
    expect(ids).toEqual(["video-bl"]);
  });

  it("integration: existing checkout proof on yesterday's shift is left alone", () => {
    // Regression guard: yesterday's already-linked checkout video is
    // visible in the candidate query (because RLS by org), but the
    // selector must not touch it. Otherwise a stray fetch could
    // re-stamp a closed shift.
    const yesterdayLinked = buildMedia({
      id: "yesterday-linked",
      created_at: "2026-05-05T18:00:00.000Z",
      time_event_id: "yesterday-event",
    });
    const ids = selectLinkableMediaIds([yesterdayLinked], opts);
    expect(ids).toEqual([]);
  });
});

describe("startOfTodayIso", () => {
  it("returns the start of the host's local day as ISO", () => {
    const reference = new Date("2026-05-06T18:00:00.000Z");
    const iso = startOfTodayIso(reference);
    // The exact wall-clock hours depend on the host TZ, but the result
    // is always strictly less than or equal to the input timestamp and
    // produces an ISO string parseable by Date.
    expect(new Date(iso).getTime()).toBeLessThanOrEqual(reference.getTime());
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe("checkoutMediaWindowStartIso", () => {
  it("returns seven days before the time_event as ISO", () => {
    expect(checkoutMediaWindowStartIso("2026-05-06T18:00:00.000Z")).toBe(
      "2026-04-29T18:00:00.000Z",
    );
  });
});
