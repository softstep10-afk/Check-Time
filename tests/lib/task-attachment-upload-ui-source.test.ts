import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readSource(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const uploaderSource = readSource("src/components/shared/TaskAttachmentUploader.tsx");
const workerModalSource = readSource("src/components/worker/WorkerTaskDetailModal.tsx");
const workerTasksSource = readSource("src/components/worker/TasksPage.tsx");
const workerProjectSource = readSource("src/components/worker/WorkerProjectView.tsx");
const managerTasksSource = readSource("src/components/manager/ManagerTasksPage.tsx");
const managerProjectSource = readSource("src/components/manager/ProjectDetailPage.tsx");
const attachRouteSource = readSource("src/app/api/tasks/[id]/attachments/route.ts");
const projectMediaSource = readSource("src/components/shared/ProjectMediaLibrary.tsx");

describe("task attachment upload surfaces", () => {
  it("exposes a shared task uploader with all approved business file types", () => {
    expect(uploaderSource).toContain("TaskAttachmentUploader");
    expect(uploaderSource).toContain("ACCEPT_ALL_UPLOADS");
    expect(uploaderSource).toContain("validateUploadFile");
    expect(uploaderSource).toContain('data-testid="task-attachment-upload-button"');
    expect(uploaderSource).toContain('data-testid="task-attachment-upload-input"');
    expect(uploaderSource).toContain("uploadTaskAttachment");
  });

  it("renders direct task attachment upload in worker and manager task views", () => {
    expect(workerModalSource).toContain("<TaskAttachmentUploader");
    expect(workerTasksSource).toContain("onAttachmentsAdded");
    expect(workerProjectSource).toContain("onAttachmentsAdded");
    expect(managerTasksSource).toContain("<TaskAttachmentUploader");
    expect(managerProjectSource).toContain("<TaskAttachmentUploader");
  });

  it("keeps task attachments attached to tasks instead of generic project media", () => {
    expect(managerProjectSource).toContain("metadata.kind === \"project_media\"");
    expect(projectMediaSource).toContain("<TaskAttachmentList items={filteredItems} />");
    expect(managerProjectSource).toContain("getAttachmentMediaIds");
    expect(managerTasksSource).toContain("getAttachmentMediaIds");
  });
});

describe("task attachment attach route guards", () => {
  it("authenticates, uses user-scoped task visibility, then validates media before admin update", () => {
    expect(attachRouteSource).toContain("supabase.auth.getUser()");
    expect(attachRouteSource).toContain('.from("profiles")');
    expect(attachRouteSource).toContain('.from("tasks")');
    expect(attachRouteSource).toContain(".eq(\"org_id\", profile.org_id)");
    expect(attachRouteSource).toContain("assertTaskAttachmentMediaTargets");
    expect(attachRouteSource).toContain("createAdminClient");
    expect(attachRouteSource).toContain("attachment_media_ids");
    expect(attachRouteSource).toContain("attachment_refs");
  });

  it("preserves task permissions and project media behavior by avoiding schema/storage changes", () => {
    expect(attachRouteSource).not.toContain("create policy");
    expect(attachRouteSource).not.toContain("alter table");
    expect(attachRouteSource).not.toContain("delete from");
    expect(attachRouteSource).toContain("linkMediaToTask");
    expect(attachRouteSource).toContain("task_attachments_added");
  });
});
