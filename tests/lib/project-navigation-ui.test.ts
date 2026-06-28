import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/components/shared/ProjectNavigationActions.tsx"),
  "utf8",
);
const globals = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8").replace(
  /\r\n/g,
  "\n",
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

  it("splits compact and full project navigation by input type instead of width", () => {
    expect(source).toContain("nav-touch-only w-full flex-wrap items-center gap-1.5");
    expect(source.match(/nav-pointer-only/g)).toHaveLength(5);
    expect(source).not.toContain("lg:hidden");
    expect(source).not.toContain("hidden lg:inline-flex");
    expect(source).not.toContain("hidden sm:inline-flex");
    expect(source).not.toContain("sm:hidden");

    expect(globals).toContain(".nav-touch-only");
    expect(globals).toContain(".nav-pointer-only");
    expect(globals).toContain("@media (hover: none), (pointer: coarse)");
    expect(globals).toContain("@media (hover: hover) and (pointer: fine)");
    expect(globals).toContain(".nav-touch-only {\n    display: flex;");
    expect(globals).toContain(".nav-pointer-only {\n    display: inline-flex;");
  });
});
