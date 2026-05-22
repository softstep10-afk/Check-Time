import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectCoordinateFiles = [
  "src/components/manager/ProjectsPage.tsx",
  "src/components/manager/ProjectDetailPage.tsx",
];

function getProjectCoordinateInputs(source: string) {
  return source
    .split("<input")
    .slice(1)
    .map((part) => `<input${part.split("/>")[0]}/>`)
    .filter(
      (block) =>
        (block.includes('name="lat"') || block.includes('name="lng"')) &&
        (block.includes('placeholder={t("projects.latitude")}') ||
          block.includes('placeholder={t("projects.longitude")}')),
    );
}

describe("project coordinate inputs", () => {
  it("allow high-precision decimal coordinates through browser validation", () => {
    for (const file of projectCoordinateFiles) {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      const inputs = getProjectCoordinateInputs(source);

      expect(inputs.length).toBeGreaterThan(0);
      for (const input of inputs) {
        expect(input).toContain('type="number"');
        expect(input).toContain('step="any"');
        expect(input).not.toContain('step="0.000001"');
      }
    }
  });
});
