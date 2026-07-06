import { describe, expect, it } from "vitest";
import {
  buildMediaInsertPayload,
  buildProjectMediaMetadata,
  buildReceiptMediaMetadata,
} from "@/lib/media-payload";

describe("media payload helpers", () => {
  it("builds the shared media insert payload with default non-checkout fields", () => {
    expect(
      buildMediaInsertPayload({
        orgId: "org-1",
        projectId: "project-1",
        uploadedBy: "profile-1",
        mediaType: "photo",
        storagePath: "org-1/project-1/project-media/file.jpg",
        filename: "file.jpg",
        fileSize: 1234,
        mimeType: "image/jpeg",
        metadata: { kind: "project_media" },
      }),
    ).toEqual({
      org_id: "org-1",
      project_id: "project-1",
      uploaded_by: "profile-1",
      media_type: "photo",
      storage_path: "org-1/project-1/project-media/file.jpg",
      filename: "file.jpg",
      file_size: 1234,
      mime_type: "image/jpeg",
      caption: null,
      is_checkout: false,
      time_event_id: null,
      metadata: { kind: "project_media" },
    });
  });

  it("preserves explicit caption, checkout flag, time event, and null project", () => {
    expect(
      buildMediaInsertPayload({
        orgId: "org-1",
        projectId: null,
        uploadedBy: "profile-1",
        mediaType: "video",
        storagePath: "org-1/checkouts/file.mp4",
        filename: "file.mp4",
        fileSize: 4321,
        mimeType: "video/mp4",
        caption: "Clock-out proof",
        isCheckout: true,
        timeEventId: "event-1",
        metadata: { kind: "checkout" },
      }),
    ).toMatchObject({
      project_id: null,
      caption: "Clock-out proof",
      is_checkout: true,
      time_event_id: "event-1",
    });
  });

  it("builds project media metadata with optional source", () => {
    expect(buildProjectMediaMetadata()).toEqual({ kind: "project_media" });
    expect(buildProjectMediaMetadata("worker_project_view")).toEqual({
      kind: "project_media",
      source: "worker_project_view",
    });
  });

  it("builds receipt metadata without changing amount or store edge cases", () => {
    expect(
      buildReceiptMediaMetadata({
        storeName: null,
        amount: 0,
        purchaseDate: "2026-07-06",
        uploaderName: "Worker",
      }),
    ).toEqual({
      kind: "receipt",
      category: "receipt",
      store_name: null,
      amount: 0,
      purchase_date: "2026-07-06",
      uploader_name: "Worker",
    });

    expect(
      buildReceiptMediaMetadata({
        storeName: "Other supplier",
        amount: 12.34,
        purchaseDate: "2026-07-05",
        uploaderName: "Manager",
      }),
    ).toEqual({
      kind: "receipt",
      category: "receipt",
      store_name: "Other supplier",
      amount: 12.34,
      purchase_date: "2026-07-05",
      uploader_name: "Manager",
    });
  });
});
