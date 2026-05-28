import { describe, expect, it } from "vitest";
import { buildOfflineVisibilityState } from "@/lib/offline-visibility";

describe("offline field visibility state", () => {
  it("shows an offline banner immediately when the browser is offline", () => {
    expect(
      buildOfflineVisibilityState({
        isOnline: false,
        draining: false,
        offlineActionCount: 0,
        offlineUploadCount: 0,
        offlineShiftCount: 0,
      }),
    ).toMatchObject({
      mode: "offline",
      labelKey: "worker.offlineMode",
      tone: "warning",
    });
  });

  it("shows queued actions as waiting for connection even if navigator still reports online", () => {
    expect(
      buildOfflineVisibilityState({
        isOnline: true,
        draining: false,
        offlineActionCount: 1,
        offlineUploadCount: 1,
        offlineShiftCount: 0,
      }),
    ).toMatchObject({
      mode: "pending",
      count: 2,
      labelKey: "worker.offlinePendingSummary",
    });
  });

  it("shows reconnect sync state while queued work is draining", () => {
    expect(
      buildOfflineVisibilityState({
        isOnline: true,
        draining: true,
        offlineActionCount: 1,
        offlineUploadCount: 0,
        offlineShiftCount: 1,
      }),
    ).toMatchObject({
      mode: "syncing",
      count: 2,
      labelKey: "worker.offlineSyncingSummary",
      tone: "syncing",
    });
  });

  it("clears visible offline state when online and nothing is queued", () => {
    expect(
      buildOfflineVisibilityState({
        isOnline: true,
        draining: false,
        offlineActionCount: 0,
        offlineUploadCount: 0,
        offlineShiftCount: 0,
      }),
    ).toBeNull();
  });
});
