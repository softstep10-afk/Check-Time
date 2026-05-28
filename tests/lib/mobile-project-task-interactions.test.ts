import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const managerProjectsSource = readFileSync(
  resolve(process.cwd(), "src/components/manager/ProjectsPage.tsx"),
  "utf8",
);
const workerProjectsSource = readFileSync(
  resolve(process.cwd(), "src/components/worker/WorkerProjectsList.tsx"),
  "utf8",
);
const managerProjectDetailSource = readFileSync(
  resolve(process.cwd(), "src/components/manager/ProjectDetailPage.tsx"),
  "utf8",
);
const workerProjectDetailSource = readFileSync(
  resolve(process.cwd(), "src/components/worker/WorkerProjectView.tsx"),
  "utf8",
);
const managerScheduleSource = readFileSync(
  resolve(process.cwd(), "src/app/(manager)/schedule/SchedulePageClient.tsx"),
  "utf8",
);
const workerTasksSource = readFileSync(
  resolve(process.cwd(), "src/components/worker/TasksPage.tsx"),
  "utf8",
);
const workerModalSource = readFileSync(
  resolve(process.cwd(), "src/components/worker/WorkerTaskDetailModal.tsx"),
  "utf8",
);

describe("mobile project card and task action UX", () => {
  it("makes worker project cards clickable without wrapping nested controls in a link", () => {
    expect(workerProjectsSource).toContain('data-testid="worker-project-card"');
    expect(workerProjectsSource).toContain("router.push(`/project/${project.id}`)");
    expect(workerProjectsSource).toContain("onPointerDown={(event) => {");
    expect(workerProjectsSource).toContain("onPointerUp={(event) => {");
    expect(workerProjectsSource).toContain("shouldActivateProjectCardPointer");
    expect(workerProjectsSource).toContain("PROJECT_CARD_TAP_MOVE_TOLERANCE_PX");
    expect(workerProjectsSource).toContain("onKeyDown={(event) => {");
    expect(workerProjectsSource).toContain("touch-manipulation cursor-pointer");
    expect(workerProjectsSource).toContain("shouldIgnoreProjectCardActivation(event.target, event.currentTarget)");
    expect(workerProjectsSource).not.toContain("href={`/project/${project.id}`}");
  });

  it("makes manager project cards clickable as a full card hit area", () => {
    expect(managerProjectsSource).toContain('data-testid="manager-project-card"');
    expect(managerProjectsSource).toContain("const openProjectDetail = () => router.push(`/projects/${project.id}`)");
    expect(managerProjectsSource).toContain("onPointerDown={(event) => {");
    expect(managerProjectsSource).toContain("onPointerUp={(event) => {");
    expect(managerProjectsSource).toContain("shouldActivateProjectCardPointer");
    expect(managerProjectsSource).toContain("PROJECT_CARD_TAP_MOVE_TOLERANCE_PX");
    expect(managerProjectsSource).toContain("touch-manipulation cursor-pointer");
    expect(managerProjectsSource).toContain("shouldIgnoreProjectCardActivation(event.target, event.currentTarget)");
  });

  it("suppresses the click-after-touch duplicate while keeping desktop click behavior", () => {
    expect(managerProjectsSource).toContain("PROJECT_CARD_CLICK_SUPPRESSION_MS");
    expect(workerProjectsSource).toContain("PROJECT_CARD_CLICK_SUPPRESSION_MS");
    expect(managerProjectsSource).toContain('event.pointerType === "mouse"');
    expect(workerProjectsSource).toContain('event.pointerType === "mouse"');
    expect(managerProjectsSource).toContain("projectCardTouchActivatedAtRef.current = Date.now()");
    expect(workerProjectsSource).toContain("projectCardTouchActivatedAtRef.current = Date.now()");
  });

  it("keeps address/copy rows from triggering the project card navigation", () => {
    expect(managerProjectsSource).toContain("CopyAddressButton address={project.address}");
    expect(managerProjectsSource).toContain('data-project-card-action="address"');
    expect(managerProjectsSource).toContain("normalizeProjectAddressForCopy(address)");
    expect(managerProjectsSource).toContain("onClick={(event) => event.stopPropagation()}");
    expect(workerProjectsSource).toContain('data-project-card-action="address"');
    expect(workerProjectsSource).toContain("onClick={(event) => event.stopPropagation()}");
  });

  it("shows Поехать on project cards without routing through the card click", () => {
    expect(managerProjectsSource).toContain('data-project-card-action="navigation"');
    expect(workerProjectsSource).toContain('data-project-card-action="navigation"');
    expect(managerProjectsSource).toContain("<ProjectNavigationActions");
    expect(workerProjectsSource).toContain("<ProjectNavigationActions");
    expect(managerProjectsSource).toContain("siteCoordinates={project.siteCoordinates}");
    expect(workerProjectsSource).toContain("siteCoordinates={project.site}");
  });

  it("keeps project detail navigation actions near the top headers", () => {
    expect(managerProjectDetailSource).toContain("<ProjectNavigationActions");
    expect(managerProjectDetailSource).toContain("siteCoordinates={site}");
    expect(workerProjectDetailSource).toContain("<ProjectNavigationActions");
    expect(workerProjectDetailSource).toContain("siteCoordinates={projectSite}");
  });

  it("keeps schedule project entries able to show navigation when destination is available", () => {
    expect(managerScheduleSource).toContain("<ProjectNavigationActions");
    expect(managerScheduleSource).toContain("projectAddress");
    expect(managerScheduleSource).toContain("projectSite");
    expect(managerScheduleSource).toContain("parseGeoPoint(project.site_point)");
  });

  it("keeps task card actions stacked on mobile and wrapped on larger screens", () => {
    expect(workerTasksSource).toContain("mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap");
    expect(workerTasksSource).toContain("button-base button-secondary w-full justify-center sm:flex-1");
    expect(workerTasksSource).toContain("button-base button-primary w-full justify-center sm:flex-1");
  });

  it("keeps the completion modal capable of submitting an empty optional report", () => {
    expect(workerModalSource).toContain("const isEmpty =");
    expect(workerModalSource).toContain("onDone(task.id, isEmpty ? undefined : payload)");
  });
});
