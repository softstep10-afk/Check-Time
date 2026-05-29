import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildMessageAttachmentStoragePath,
  sanitizeMessageAttachmentFilename,
} from "@/lib/message-attachments";
import { normalizeStoragePath } from "@/lib/task-attachments";

describe("message attachment storage paths", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stores new message attachments under the actor org prefix", () => {
    vi.spyOn(Date, "now").mockReturnValue(1711111111000);

    expect(
      buildMessageAttachmentStoragePath("org-123", "recipient-456", "scope-work.pdf"),
    ).toBe("org-123/messages/recipient-456/1711111111000-scope-work.pdf");
  });

  it("sanitizes file names while preserving business file extensions", () => {
    vi.spyOn(Date, "now").mockReturnValue(1711111111000);

    expect(sanitizeMessageAttachmentFilename("../Scope Work.PDF")).toBe("scope-work.pdf");
    expect(sanitizeMessageAttachmentFilename("Field Photo.JPG")).toBe("field-photo.jpg");
    expect(sanitizeMessageAttachmentFilename("walkthrough.MP4")).toBe("walkthrough.mp4");
    expect(
      buildMessageAttachmentStoragePath("org-123", "recipient-456", "Cost Sheet.XLSX"),
    ).toBe("org-123/messages/recipient-456/1711111111000-cost-sheet.xlsx");
  });

  it("requires org and recipient path segments for new uploads", () => {
    expect(() => buildMessageAttachmentStoragePath("", "recipient-456", "scope.pdf")).toThrow(
      /orgId is required/,
    );
    expect(() => buildMessageAttachmentStoragePath("org-123", "../recipient", "scope.pdf")).toThrow(
      /recipientId is not a safe storage path segment/,
    );
  });

  it("keeps legacy and org-prefixed stored paths readable by signed-url helpers", () => {
    expect(normalizeStoragePath("messages/recipient-456/old.pdf")).toBe(
      "messages/recipient-456/old.pdf",
    );
    expect(normalizeStoragePath("/messages/recipient-456/old.pdf")).toBe(
      "messages/recipient-456/old.pdf",
    );
    expect(normalizeStoragePath("media/messages/recipient-456/old.pdf")).toBe(
      "messages/recipient-456/old.pdf",
    );
    expect(normalizeStoragePath("org-123/messages/recipient-456/new.pdf")).toBe(
      "org-123/messages/recipient-456/new.pdf",
    );
  });

  it("wires SendMessageForm to the org-prefixed helper instead of the legacy path", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/manager/SendMessageForm.tsx"),
      "utf8",
    );

    expect(source).toContain("buildMessageAttachmentStoragePath(orgId, recipientId, safeName)");
    expect(source).not.toContain("`messages/${recipientId}/${Date.now()}-${safeName}`");
  });

  it("does not change task or project planning attachment path shapes", () => {
    const taskSource = readFileSync(join(process.cwd(), "src/lib/task-attachments.ts"), "utf8");
    const planningSource = readFileSync(
      join(process.cwd(), "src/lib/project-planning-attachments.ts"),
      "utf8",
    );

    expect(taskSource).toContain("`${orgId}/${projectId}/tasks/${Date.now()}-${safeName}`");
    expect(planningSource).toContain(
      "`${orgId}/${projectId}/planning/${Date.now()}-${safeName}`",
    );
  });
});
