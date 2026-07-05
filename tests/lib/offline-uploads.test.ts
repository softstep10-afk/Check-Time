import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OFFLINE_KEY,
  countRetryOfflineUploads,
  loadOfflineQueue,
  markOfflineUploadStatus,
} from "@/lib/offline-uploads";

function installStorage() {
  const store = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
  vi.stubGlobal("window", { localStorage });
  return { store };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("offline upload queue", () => {
  it("normalizes legacy queued uploads as pending retryable work", () => {
    const { store } = installStorage();
    store.set(
      OFFLINE_KEY,
      JSON.stringify([
        {
          id: "upload-1",
          mode: "journal",
          projectId: "project-1",
          profileId: "worker-1",
          orgId: "org-1",
          caption: "",
          createdAt: "2026-07-03T10:00:00.000Z",
          payload: {
            kind: "thumb_only",
            thumbDataUrl: null,
            filename: "big.mov",
            mime: "video/quicktime",
            sizeBytes: 11_000_000,
          },
        },
      ]),
    );

    expect(loadOfflineQueue()[0]).toMatchObject({
      id: "upload-1",
      status: "pending",
      retryCount: 0,
      lastErrorMessage: null,
      lastAttemptAt: null,
    });
  });

  it("marks drain failures as retry without removing the queued upload", () => {
    const { store } = installStorage();
    store.set(
      OFFLINE_KEY,
      JSON.stringify([
        {
          id: "upload-1",
          mode: "journal",
          projectId: "project-1",
          profileId: "worker-1",
          orgId: "org-1",
          caption: "",
          createdAt: "2026-07-03T10:00:00.000Z",
          status: "pending",
          retryCount: 0,
          lastErrorMessage: null,
          lastAttemptAt: null,
          payload: {
            kind: "thumb_only",
            thumbDataUrl: null,
            filename: "big.mov",
            mime: "video/quicktime",
            sizeBytes: 11_000_000,
          },
        },
      ]),
    );

    const queue = markOfflineUploadStatus("upload-1", {
      status: "retry",
      retryCount: 1,
      lastErrorMessage: "Storage upload failed.",
    });

    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      id: "upload-1",
      status: "retry",
      retryCount: 1,
      lastErrorMessage: "Storage upload failed.",
    });
    expect(countRetryOfflineUploads(queue)).toBe(1);
    expect(loadOfflineQueue()).toHaveLength(1);
  });
});
