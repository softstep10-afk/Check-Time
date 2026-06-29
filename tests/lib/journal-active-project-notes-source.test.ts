import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const mediaViewerSource = readSource("src/components/shared/MediaViewerModal.tsx");
const taskAttachmentSource = readSource("src/components/shared/TaskAttachmentList.tsx");
const journalSource = readSource("src/components/worker/JournalPage.tsx");
const workerProjectsSource = readSource("src/components/worker/WorkerProjectsList.tsx");
const workerProjectViewSource = readSource("src/components/worker/WorkerProjectView.tsx");
const managerProjectDetailSource = readSource("src/components/manager/ProjectDetailPage.tsx");
const managerProjectsSource = readSource("src/components/manager/ProjectsPage.tsx");
const projectNotesRouteSource = readSource("src/app/api/worker/project-notes/route.ts");
const projectMediaLibrarySource = readSource("src/components/shared/ProjectMediaLibrary.tsx");
const uploadSourceButtonsSource = readSource("src/components/shared/UploadSourceButtons.tsx");

describe("journal media back, active project, notes, and picker source guards", () => {
  it("closes in-app media viewer through browser Back without leaving the current surface", () => {
    expect(mediaViewerSource).toContain("window.history.pushState");
    expect(mediaViewerSource).toContain("window.addEventListener(\"popstate\"");
    expect(mediaViewerSource).toContain("window.history.back()");
    expect(journalSource).toContain("<MediaViewerModal");
    expect(taskAttachmentSource).toContain("<MediaViewerModal");
    expect(workerProjectViewSource).toContain("<MediaViewerModal");
  });

  it("shows the active shift project badge on worker project cards and detail", () => {
    expect(workerProjectsSource).toContain("shell.clockState.currentProjectId === project.id");
    expect(workerProjectsSource).toContain("workerProject.activeShiftHere");
    expect(workerProjectViewSource).toContain("active-shift-project-badge");
    expect(workerProjectViewSource).toContain("workerProject.activeShiftHere");
  });

  it("stores public project notes separately from tasks and private messages", () => {
    expect(workerProjectViewSource).toContain("/api/worker/project-notes");
    expect(workerProjectViewSource).toContain("worker-project-public-notes");
    expect(managerProjectDetailSource).toContain("manager-project-public-notes");
    expect(managerProjectsSource).toContain("readProjectPublicNotes(project.settings)");
    expect(projectNotesRouteSource).toContain("appendProjectPublicNote(project.settings");
    expect(projectNotesRouteSource).toContain(".from(\"projects\")");
    expect(projectNotesRouteSource).toContain(".update({ settings: nextSettings })");
    expect(projectNotesRouteSource).not.toContain(".from(\"tasks\")");
    expect(projectNotesRouteSource).not.toContain(".from(\"messages\")");
  });

  it("keeps project note access scoped to existing project visibility guards", () => {
    expect(projectNotesRouteSource).toContain("project_assignments");
    expect(projectNotesRouteSource).toContain("project_exclusions");
    expect(projectNotesRouteSource).toContain(".eq(\"org_id\", profile.org_id)");
    expect(projectNotesRouteSource).toContain("Project is not available to this user");
  });

  it("keeps document picker support on journal and material/project upload surfaces", () => {
    expect(journalSource).toContain("<UploadSourceButtons");
    expect(uploadSourceButtonsSource).toContain("accept={ACCEPT_ALL_UPLOADS}");
    expect(workerProjectViewSource).toContain("accept={ACCEPT_ALL_UPLOADS}");
    expect(managerProjectDetailSource).toContain("accept={ACCEPT_ALL_UPLOADS}");
  });

  it("organizes project media into photo, video, document, and all categories", () => {
    expect(managerProjectDetailSource).toContain("filterProjectMediaByCategory");
    expect(managerProjectDetailSource).toContain("mediaFilterDocuments");
    expect(workerProjectViewSource).toContain("<ProjectMediaLibrary");
    expect(projectMediaLibrarySource).toContain("projectDetail.mediaFilterPhoto");
    expect(projectMediaLibrarySource).toContain("projectDetail.mediaFilterVideo");
    expect(projectMediaLibrarySource).toContain("projectDetail.mediaFilterDocuments");
    expect(projectMediaLibrarySource).toContain("<TaskAttachmentList items={filteredItems} />");
  });
});
