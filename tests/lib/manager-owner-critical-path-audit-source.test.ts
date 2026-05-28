import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const managerProjects = readSource("src/components/manager/ProjectsPage.tsx");
const managerProjectDetail = readSource("src/components/manager/ProjectDetailPage.tsx");
const managerTasks = readSource("src/components/manager/ManagerTasksPage.tsx");
const managerMessages = readSource("src/components/manager/BulkMessageComposer.tsx");
const managerTaskRoute = readSource("src/app/api/manager/tasks/route.ts");
const mediaDeleteRoute = readSource("src/app/api/media/[id]/route.ts");
const projectNotesRoute = readSource("src/app/api/worker/project-notes/route.ts");
const managerLayout = readSource("src/app/(manager)/layout.tsx");
const archivePage = readSource("src/app/(manager)/archive/page.tsx");
const payrollPage = readSource("src/app/(manager)/payroll/page.tsx");
const auditPage = readSource("src/app/(manager)/admin/audit/page.tsx");
const diagnosticsPage = readSource("src/app/(manager)/admin/diagnostics/page.tsx");

describe("manager/owner critical path source guards", () => {
  it("keeps manager project cards and detail navigable with media, notes, and document uploads", () => {
    expect(managerProjects).toContain('href={`/projects/${project.id}`}');
    expect(managerProjects).toContain("data-testid=\"manager-project-card-main-link\"");
    expect(managerProjects).toContain("<ProjectNavigationActions");
    expect(managerProjects).toContain("readProjectPublicNotes(project.settings)");
    expect(managerProjectDetail).toContain("<ProjectNavigationActions");
    expect(managerProjectDetail).toContain("manager-project-public-notes");
    expect(managerProjectDetail).toContain("filterProjectMediaByCategory");
    expect(managerProjectDetail).toContain("mediaFilterDocuments");
    expect(managerProjectDetail).toContain("accept={ACCEPT_ALL_UPLOADS}");
  });

  it("keeps manager task creation, material requests, and live task status guarded", () => {
    expect(managerTasks).toContain("mergeRealtimeTaskRow");
    expect(managerTasks).toContain('event: "UPDATE"');
    expect(managerTasks).toContain('table: "tasks"');
    expect(managerTaskRoute).toContain("requireManagerContext");
    expect(managerTaskRoute).toContain("assertTaskAttachmentMediaTargets");
    expect(managerTaskRoute).toContain("isEligibleMaterialTaker");
    expect(managerTaskRoute).toContain("source: materialEnabled ? \"manager_material_task\"");
    expect(managerTaskRoute).toContain("assignedTo: assignedTo.value");
  });

  it("keeps private message history and public project notes separate from tasks", () => {
    expect(managerMessages).toContain("mergeMessagesById");
    expect(managerMessages).toContain("mergeHistoryPayload(payload.new)");
    expect(managerMessages).toContain('event: "UPDATE"');
    expect(projectNotesRoute).toContain("appendProjectPublicNote(project.settings");
    expect(projectNotesRoute).toContain(".from(\"projects\")");
    expect(projectNotesRoute).toContain("project_assignments");
    expect(projectNotesRoute).toContain("project_exclusions");
    expect(projectNotesRoute).not.toContain(".from(\"tasks\")");
    expect(projectNotesRoute).not.toContain(".from(\"messages\")");
  });

  it("keeps media delete semantics helper-gated without changing upload/open/download", () => {
    expect(managerProjectDetail).toContain("canDeleteMedia: boolean");
    expect(managerProjectDetail).toContain("{canDeleteMedia ? (");
    expect(mediaDeleteRoute).toContain("canDeleteMediaEverywhereServer(profile)");
    expect(mediaDeleteRoute).toContain("getConfiguredMediaDeleteProfileIds()");
    expect(mediaDeleteRoute).toContain("softDeleteMediaForActor");
  });

  it("keeps archive, trash, payroll archive, diagnostics, and signatures access-gated", () => {
    expect(managerLayout).toContain("href: \"/archive\"");
    expect(managerLayout).toContain("href: \"/trash\"");
    expect(managerLayout).toContain("href: \"/payroll\"");
    expect(managerLayout).toContain("financeOnly: true");
    expect(archivePage).toContain("hasFinanceAccess");
    expect(archivePage).toContain("buildPaidPayrollArchive");
    expect(payrollPage).toContain("if (!allowed) redirect(\"/overview\")");
    expect(auditPage).toContain("worker_location_consents");
    expect(auditPage).toContain("safety_acknowledgements");
    expect(diagnosticsPage).toContain("requireManagerContext");
    expect(diagnosticsPage).toContain("if (profile.role !== \"owner\" && profile.role !== \"admin\")");
    expect(diagnosticsPage).toContain("does not expose secrets");
  });
});
