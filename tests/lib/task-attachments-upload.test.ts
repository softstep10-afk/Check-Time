import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getAttachmentRefs,
  mergeTaskAttachmentRefs,
  uploadTaskAttachment,
} from "@/lib/task-attachments";

function makeFile(name: string, mime: string): File {
  return new File(["payload"], name, { type: mime });
}

function makeUploadClient({
  uploadError = null,
  insertError = null,
}: {
  uploadError?: { message: string } | null;
  insertError?: { message: string } | null;
} = {}) {
  const upload = vi.fn(async () => ({ error: uploadError }));
  const storageFrom = vi.fn(() => ({ upload }));
  const single = vi.fn(async () => ({
    data: insertError ? null : { id: "media-1" },
    error: insertError,
  }));
  const select = vi.fn(() => ({ single }));
  const insert = vi.fn(() => ({ select }));
  const from = vi.fn(() => ({ insert }));

  const client = {
    storage: { from: storageFrom },
    from,
  } as unknown as SupabaseClient;

  return { client, storageFrom, upload, from, insert };
}

describe("uploadTaskAttachment", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns success only after storage upload and media metadata insert succeed", async () => {
    const { client, storageFrom, upload, from, insert } = makeUploadClient();
    const result = await uploadTaskAttachment(client, {
      orgId: "org-1",
      projectId: "project-1",
      uploadedBy: "manager-1",
      file: makeFile("Scope Document.DOCX", "application/octet-stream"),
    });

    expect(result).toMatchObject({
      ok: true,
      mediaId: "media-1",
      attachment: {
        id: "media-1",
        filename: "Scope Document.DOCX",
        mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        media_type: "document",
      },
    });
    expect(storageFrom).toHaveBeenCalledWith("media");
    expect(upload).toHaveBeenCalledWith(
      expect.stringMatching(/^org-1\/project-1\/tasks\/\d+-scope-document\.docx$/),
      expect.any(File),
      expect.objectContaining({
        upsert: false,
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    );
    expect(from).toHaveBeenCalledWith("media");
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: "org-1",
        project_id: "project-1",
        uploaded_by: "manager-1",
        filename: "Scope Document.DOCX",
        mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        metadata: { kind: "task_attachment" },
      }),
    );
  });

  it("uses an org-scoped no-project task path for general task attachments", async () => {
    const { client, upload, insert } = makeUploadClient();
    const result = await uploadTaskAttachment(client, {
      orgId: "org-1",
      projectId: null,
      uploadedBy: "manager-1",
      file: makeFile("todo.pdf", "application/pdf"),
    });

    expect(result).toMatchObject({ ok: true, mediaId: "media-1" });
    expect(upload).toHaveBeenCalledWith(
      expect.stringMatching(/^org-1\/tasks\/\d+-todo\.pdf$/),
      expect.any(File),
      expect.objectContaining({ contentType: "application/pdf" }),
    );
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: "org-1",
        project_id: null,
        metadata: { kind: "task_attachment" },
      }),
    );
  });

  it("does not report success when the media metadata insert fails", async () => {
    const { client } = makeUploadClient({
      insertError: { message: "metadata insert failed" },
    });

    await expect(
      uploadTaskAttachment(client, {
        orgId: "org-1",
        projectId: "project-1",
        uploadedBy: "manager-1",
        file: makeFile("", "video/quicktime"),
      }),
    ).resolves.toEqual({
      ok: false,
      error: "media-insert: metadata insert failed",
    });
  });

  it("stops before metadata insert when storage upload fails", async () => {
    const { client, insert } = makeUploadClient({
      uploadError: { message: "storage failed" },
    });

    await expect(
      uploadTaskAttachment(client, {
        orgId: "org-1",
        projectId: "project-1",
        uploadedBy: "manager-1",
        file: makeFile("iphone.mov", "video/quicktime"),
      }),
    ).resolves.toEqual({ ok: false, error: "storage: storage failed" });
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("task attachment metadata refs", () => {
  it("reads sanitized attachment refs and ignores malformed rows", () => {
    const refs = getAttachmentRefs({
      metadata: {
        attachment_refs: [
          {
            id: "media-1",
            filename: "scope.pdf",
            mime_type: "application/pdf",
            media_type: "pdf",
            storage_path: "org/tasks/scope.pdf",
          },
          { id: "missing-storage", media_type: "pdf" },
        ],
      },
    });

    expect(refs).toEqual([
      {
        id: "media-1",
        filename: "scope.pdf",
        mime_type: "application/pdf",
        media_type: "pdf",
        storage_path: "org/tasks/scope.pdf",
      },
    ]);
  });

  it("dedupes attachment refs by id while preserving latest uploaded ref", () => {
    expect(
      mergeTaskAttachmentRefs(
        [
          {
            id: "media-1",
            filename: "old.pdf",
            mime_type: "application/pdf",
            media_type: "pdf",
            storage_path: "old",
          },
        ],
        [
          {
            id: "media-1",
            filename: "new.pdf",
            mime_type: "application/pdf",
            media_type: "pdf",
            storage_path: "new",
          },
        ],
      ),
    ).toEqual([
      {
        id: "media-1",
        filename: "new.pdf",
        mime_type: "application/pdf",
        media_type: "pdf",
        storage_path: "new",
      },
    ]);
  });
});
