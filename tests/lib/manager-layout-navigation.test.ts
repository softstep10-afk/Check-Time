import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const layoutSource = readFileSync(
  resolve(process.cwd(), "src/app/(manager)/layout.tsx"),
  "utf8",
);

function extractMobileNavBlock() {
  const match = layoutSource.match(/const mobileNav:[\s\S]*?\n\];/);
  return match?.[0] ?? "";
}

describe("manager layout navigation visibility", () => {
  it("keeps the desktop sidebar visible at the same breakpoint", () => {
    expect(layoutSource).toContain('className="app-sidebar hidden w-[244px] flex-shrink-0 flex-col overflow-y-auto md:flex"');
  });

  it("keeps the top quick navigation mobile-only", () => {
    expect(layoutSource).toContain('aria-label={t("nav.quick")}');
    expect(layoutSource).toContain("px-4 py-2 md:hidden");
  });

  it("keeps manager quick navigation route destinations unchanged", () => {
    const mobileNavBlock = extractMobileNavBlock();
    for (const href of [
      "/overview",
      "/command-center",
      "/projects",
      "/team",
      "/tasks",
      "/schedule",
      "/ai",
      "/payroll",
    ]) {
      expect(mobileNavBlock).toContain(`href: "${href}"`);
    }
  });

  it("keeps supervisor out of manager-tier quick navigation", () => {
    expect(layoutSource).toContain('userRole === "supervisor"');
    expect(layoutSource).toContain('if (scheduleOnlyUser) return item.href === "/schedule";');
  });
});
