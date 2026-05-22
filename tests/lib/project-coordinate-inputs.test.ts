import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const coordinateInputFiles = [
  "src/components/manager/ProjectsPage.tsx",
  "src/components/manager/ProjectDetailPage.tsx",
  "src/app/(manager)/stores/page.tsx",
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

describe("coordinate inputs", () => {
  it("avoid native number-step validation for high-precision decimal coordinates", () => {
    for (const file of coordinateInputFiles) {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      const inputs = getProjectCoordinateInputs(source);

      expect(inputs.length).toBeGreaterThan(0);
      for (const input of inputs) {
        expect(input).toContain('type="text"');
        expect(input).toContain('inputMode="decimal"');
        expect(input).not.toContain('type="number"');
        expect(input).not.toContain('step="0.000001"');
        expect(input).not.toContain('step="any"');
      }
    }
  });

  it("does not leave any coordinate input on the restrictive six-decimal step", () => {
    for (const file of coordinateInputFiles) {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(source).not.toContain('step="0.000001"');
    }
  });
});
