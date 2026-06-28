import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readSource(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const auditDoc = readSource("docs/MEDIA_CONSISTENCY_AUDIT_ALPHA7.md");
const workerShellSource = readSource("src/components/worker/WorkerShell.tsx");
const taskUploaderSource = readSource("src/components/shared/TaskAttachmentUploader.tsx");
const uploadSourceButtonsSource = readSource("src/components/shared/UploadSourceButtons.tsx");
const taskListSource = readSource("src/components/shared/TaskAttachmentList.tsx");
const messageViewSource = readSource("src/components/shared/MessageAttachmentView.tsx");
const projectLibrarySource = readSource("src/components/shared/ProjectMediaLibrary.tsx");
const managerProjectSource = readSource("src/components/manager/ProjectDetailPage.tsx");
const workerProjectSource = readSource("src/components/worker/WorkerProjectView.tsx");
const journalSource = readSource("src/components/worker/JournalPage.tsx");

describe("media consistency audit guardrails", () => {
  it("documents every owner-requested media and attachment surface", () => {
    for (const expected of [
      "Project media",
      "Task attachments",
      "Message attachments",
      "Material request attachments",
      "Checkout video",
      "Check-in video",
      "Journal media",
      "Project notes attachments",
      "Manager upload flows",
      "Worker upload flows",
    ]) {
      expect(auditDoc).toContain(expected);
    }
  });

  it("keeps shared open/download surfaces for project, task, and message files", () => {
    expect(taskUploaderSource).toContain("<UploadSourceButtons");
    expect(uploadSourceButtonsSource).toContain("ACCEPT_ALL_UPLOADS");
    expect(taskListSource).toContain("MediaViewerModal");
    expect(taskListSource).toContain("createSignedUrl(normalized, 3600, { download: downloadAs })");
    expect(messageViewSource).toContain("MediaViewerModal");
    expect(messageViewSource).toContain("normalizeStoragePath(attachment.storagePath)");
    expect(projectLibrarySource).toContain("<TaskAttachmentList items={filteredItems} />");
  });

  it("keeps manager and worker project upload pickers on approved business file types", () => {
    expect(managerProjectSource).toContain("accept={ACCEPT_ALL_UPLOADS}");
    expect(workerProjectSource).toContain("accept={ACCEPT_ALL_UPLOADS}");
    expect(journalSource).toContain("accept={ACCEPT_ALL_UPLOADS}");
  });

  it("stores worker journal and shift media with inferred content type and safe display filename", () => {
    expect(workerShellSource).toContain("inferUploadContentType");
    expect(workerShellSource).toContain("const displayName = file.name || safeName");
    expect(workerShellSource).toContain("const resolvedContentType = inferUploadContentType(file)");
    expect(workerShellSource).toContain("contentType: resolvedContentType");
    expect(workerShellSource).toContain("filename: displayName");
    expect(workerShellSource).toContain("mime_type: resolvedContentType");
  });
});
