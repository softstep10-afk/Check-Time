import { describe, expect, it } from "vitest";
import { buildNoGpsMetadata } from "@/lib/worker-clock-metadata";

describe("buildNoGpsMetadata", () => {
  it("returns an empty object when GPS was captured normally", () => {
    expect(buildNoGpsMetadata({ skippedGps: false })).toEqual({});
  });

  it("marks the shift as no_gps + needs_review when GPS is skipped without an error kind", () => {
    const out = buildNoGpsMetadata({ skippedGps: true });
    expect(out).toEqual({
      location_unverified: true,
      gps_status: "no_gps",
      needs_review: true,
    });
  });

  it("encodes a denied error kind", () => {
    const out = buildNoGpsMetadata({ skippedGps: true, errorKind: "denied" });
    expect(out.gps_status).toBe("gps_denied");
    expect(out.gps_error_kind).toBe("denied");
    expect(out.needs_review).toBe(true);
    expect(out.location_unverified).toBe(true);
  });

  it("encodes an unavailable error kind", () => {
    const out = buildNoGpsMetadata({ skippedGps: true, errorKind: "unavailable" });
    expect(out.gps_status).toBe("gps_unavailable");
    expect(out.gps_error_kind).toBe("unavailable");
  });

  it("encodes an unsupported error kind", () => {
    const out = buildNoGpsMetadata({ skippedGps: true, errorKind: "unsupported" });
    expect(out.gps_status).toBe("gps_unsupported");
    expect(out.gps_error_kind).toBe("unsupported");
  });

  it("flips offline-queued shifts to gps_status=offline_pending_sync regardless of skippedGps", () => {
    // The offline queue can land on a shift that DID capture a fix
    // (gps was set, network failed). The status should reflect "queued
    // for sync" rather than no_gps so the manager review surface
    // distinguishes the two.
    const queued = buildNoGpsMetadata({ skippedGps: false, offlineQueued: true });
    expect(queued.gps_status).toBe("offline_pending_sync");
    expect(queued.needs_review).toBe(true);
    expect(queued.location_unverified).toBe(true);
  });

  it("preserves errorKind alongside offline_pending_sync when both apply", () => {
    const out = buildNoGpsMetadata({
      skippedGps: true,
      errorKind: "denied",
      offlineQueued: true,
    });
    expect(out.gps_status).toBe("offline_pending_sync");
    expect(out.gps_error_kind).toBe("denied");
  });
});
