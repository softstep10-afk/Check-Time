import { describe, expect, it } from "vitest";
import { getDisplayOrgName } from "@/lib/brand";
import {
  PROJECT_ESTIMATES_KEY,
  PROJECT_MATERIAL_SPEC_KEY,
  estimateMargin,
  mergeProjectPlanningSettings,
  normalizeProjectEstimations,
  parseMaterialSpecText,
  readProjectEstimations,
  readProjectMaterialSpec,
} from "@/lib/project-planning";

describe("project planning", () => {
  it("normalizes legacy owner branding for UI display", () => {
    expect(getDisplayOrgName("Andrew's Crew")).toBe("NW Build Pro");
    expect(getDisplayOrgName("Andrew")).toBe("NW Build Pro");
    expect(getDisplayOrgName("Northwest Build")).toBe("Northwest Build");
  });

  it("parses pasted Excel or CSV material rows with supplier links", () => {
    const rows = parseMaterialSpecText(
      [
        "material\tqty\tunit\tsupplier\tlink\tnote",
        "[Framing]",
        "Drywall 5/8\t40\tsheets\tHome Depot\thttps://example.com/drywall\tType X",
        "Door trim,12,pcs,Lowe's,www.example.com/trim,paint grade",
      ].join("\n"),
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      name: "Drywall 5/8",
      quantity: "40",
      unit: "sheets",
      supplier: "Home Depot",
      link: "https://example.com/drywall",
      note: "Type X",
      category: "Framing",
    });
    expect(rows[1]?.link).toBe("https://www.example.com/trim");
  });

  it("keeps material specs and estimates inside project settings without dropping other settings", () => {
    const materialRows = parseMaterialSpecText("Frame lumber\t20\tpcs\tDunn Lumber");
    const estimates = normalizeProjectEstimations([
      {
        title: "Bathroom change order",
        attachments: [
          {
            name: "Client scope PDF",
            url: "https://example.com/scope.pdf",
            kind: "pdf",
          },
          {
            fileName: "Scope workbook.xlsx",
            storagePath: "org-1/project-1/planning/scope-workbook.xlsx",
            mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          },
        ],
        items: [
          {
            title: "Tile install",
            quantity: 120,
            unit: "sq ft",
            unitPrice: 18,
            materialCost: 450,
            internalCost: 900,
          },
        ],
      },
    ]);

    const settings = mergeProjectPlanningSettings(
      { client_priority: "red" },
      { materialSpecItems: materialRows, estimations: estimates },
    );

    expect(settings.client_priority).toBe("red");
    expect(readProjectMaterialSpec(settings)[0]?.name).toBe("Frame lumber");
    expect(readProjectEstimations(settings)[0]?.clientPrice).toBe(2160);
    expect(readProjectEstimations(settings)[0]?.attachments[0]?.name).toBe("Client scope PDF");
    expect(readProjectEstimations(settings)[0]?.attachments[1]).toMatchObject({
      name: "Scope workbook.xlsx",
      kind: "file",
      storagePath: "org-1/project-1/planning/scope-workbook.xlsx",
    });
    expect(settings[PROJECT_MATERIAL_SPEC_KEY]).toHaveLength(1);
    expect(settings[PROJECT_ESTIMATES_KEY]).toHaveLength(1);
    expect(estimateMargin(readProjectEstimations(settings)[0]!)).toBe(810);
  });
});
