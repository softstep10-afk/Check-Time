import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/components/shared/ProjectNavigationActions.tsx"),
  "utf8",
);

describe("project navigation mobile action", () => {
  it("keeps a mobile Поехать choice flow with local preference storage", () => {
    expect(source).toContain('t("projects.goMobile")');
    expect(source).toContain("PROJECT_NAVIGATION_PREFERENCE_KEY");
    expect(source).toContain('handleMobileChoice("apple")');
    expect(source).toContain('handleMobileChoice("google")');
    expect(source).toContain('handleMobileChoice("tesla")');
    expect(source).toContain('t("projects.changeNavigationApp")');
  });

  it("keeps desktop map actions hidden from mobile-only preference buttons", () => {
    expect(source).toContain("hidden sm:inline-flex");
    expect(source).toContain("sm:hidden");
  });
});
