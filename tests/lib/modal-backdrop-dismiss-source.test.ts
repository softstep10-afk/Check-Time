import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

const modalBackdropSource = read("src/components/shared/ModalBackdrop.tsx");
const projectsPageSource = read("src/components/manager/ProjectsPage.tsx");
const projectDetailSource = read("src/components/manager/ProjectDetailPage.tsx");

describe("ModalBackdrop guard", () => {
  it("tracks mousedown and click on the backdrop via the shared dismiss handlers", () => {
    expect(modalBackdropSource).toContain(
      'import { shouldDismissOnBackdrop } from "@/lib/backdrop-dismiss";',
    );
    expect(modalBackdropSource).toContain("onMouseDown={handleMouseDown}");
    expect(modalBackdropSource).toContain("onClick={handleClick}");
  });
});

describe("manager modals dismiss without closing on text-selection drag", () => {
  it("routes the project edit modal through ModalBackdrop while keeping the X/Cancel buttons", () => {
    expect(projectsPageSource).toContain(
      'import { ModalBackdrop } from "@/components/shared/ModalBackdrop";',
    );
    // Backdrop now dismisses via the guarded onClose...
    expect(projectsPageSource).toContain("onClose={closeEditProject}");
    // ...the buggy backdrop signature (dimmed overlay that closes on any click) is gone...
    expect(projectsPageSource).not.toMatch(
      /background: "rgba\(0,0,0,0\.5\)" \}\}\s*onClick=\{closeEditProject\}/,
    );
    // ...but the X and Cancel buttons still close on click.
    expect(projectsPageSource).toContain("onClick={closeEditProject}");
  });

  it("routes the project detail edit modal through ModalBackdrop", () => {
    expect(projectDetailSource).toContain(
      'import { ModalBackdrop } from "@/components/shared/ModalBackdrop";',
    );
    expect(projectDetailSource).toContain("onClose={closeEditModal}");
    expect(projectDetailSource).not.toMatch(
      /background: "rgba\(0,0,0,0\.5\)" \}\}\s*onClick=\{closeEditModal\}/,
    );
  });
});
