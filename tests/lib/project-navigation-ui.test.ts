import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/components/shared/ProjectNavigationActions.tsx"),
  "utf8",
);

describe("project navigation mobile action", () => {
  it("keeps mobile navigation to system app choice plus copy only", () => {
    expect(source).toContain('t("projects.goMobile")');
    expect(source).toContain("window.location.href = buildGeoNavigationUrl(navigationDestination");
    expect(source).toContain('t("projects.copyDestination")');
    expect(source).toContain("buildProjectAddressCopyText");
    expect(source).toContain('kind === "tesla" ? shareText : addressCopyText');
    expect(source).not.toContain("handleMobileChoice");
    expect(source).not.toContain("writeProjectNavigationPreference");
    expect(source).not.toContain("readProjectNavigationPreference");
    expect(source).not.toContain("clearProjectNavigationPreference");
    expect(source).not.toContain("saveChoiceAsDefault");
    expect(source).not.toContain('t("projects.useNavigationByDefault")');
    expect(source).not.toContain('t("projects.openOtherNavigationApp")');
  });

  it("keeps compact project navigation below lg and full desktop actions at lg", () => {
    expect(source).toContain("lg:hidden");
    expect(source.match(/hidden lg:inline-flex/g)).toHaveLength(5);
    expect(source).not.toContain("hidden sm:inline-flex");
    expect(source).not.toContain("sm:hidden");
  });
});
