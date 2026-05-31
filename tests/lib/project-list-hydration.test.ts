import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectsRouteSource = readFileSync(
  resolve(process.cwd(), "src/app/(manager)/projects/page.tsx"),
  "utf8",
);
const projectsPageSource = readFileSync(
  resolve(process.cwd(), "src/components/manager/ProjectsPage.tsx"),
  "utf8",
);

describe("manager project list hydration", () => {
  it("uses one server render timestamp for project card schedule and activity text", () => {
    expect(projectsRouteSource).toContain("renderTimeIso={new Date().toISOString()}");
    expect(projectsPageSource).toContain("renderTimeIso: string");
    expect(projectsPageSource).toContain(
      "const renderTime = useMemo(() => parseProjectRenderTime(renderTimeIso), [renderTimeIso]);",
    );
    expect(projectsPageSource).toContain("projectSchedulePriorityRank(a, renderTime)");
    expect(projectsPageSource).toContain("projectSchedulePriorityRank(b, renderTime)");
    expect(projectsPageSource).toContain("activityState(project, renderTime)");
    expect(projectsPageSource).toContain("}, renderTime);");
    expect(projectsPageSource).not.toContain("const state = activityState(project);");
    expect(projectsPageSource).not.toContain("projectSchedulePriorityRank(a);");
  });

  it("keeps the project list cards and private media thumbnail guard in place", () => {
    expect(projectsPageSource).toContain('data-testid="manager-project-card"');
    expect(projectsPageSource).toContain('data-testid="manager-project-card-main-link"');
    expect(projectsPageSource).toContain("useThumbnailUrl(isPhoto ? item.storage_path : null)");
    expect(projectsPageSource).toContain("getSignableStoragePath(storagePath)");
  });
});
