import { describe, expect, it } from "vitest";
import { parseMaterialSpecPaste } from "@/lib/material-spec-parser";

describe("material specification paste parser", () => {
  it("parses Excel rows with flexible headers", () => {
    const parsed = parseMaterialSpecPaste(
      [
        "позиция\tкол-во\tед\tпримечание",
        "Саморезы\t2\tупаковка\tДля террасы",
        "Краска\t1,5\tл\tБелая",
      ].join("\n"),
    );

    expect(parsed.hasHeader).toBe(true);
    expect(parsed.items).toEqual([
      { name: "Саморезы", quantity: "2", unit: "упаковка", notes: "Для террасы" },
      { name: "Краска", quantity: "1,5", unit: "л", notes: "Белая" },
    ]);
  });

  it("parses rows without headers using the first four columns", () => {
    const parsed = parseMaterialSpecPaste(
      ["Drywall 5/8\t40\tsheets\tType X", "Door trim,12,pcs,paint grade"].join("\n"),
    );

    expect(parsed.hasHeader).toBe(false);
    expect(parsed.items).toEqual([
      { name: "Drywall 5/8", quantity: "40", unit: "sheets", notes: "Type X" },
      { name: "Door trim", quantity: "12", unit: "pcs", notes: "paint grade" },
    ]);
  });

  it("ignores blank rows and preserves simple quantity text safely", () => {
    const parsed = parseMaterialSpecPaste("\nmaterial;quantity;unit;notes\nTape;two rolls;rolls;blue tape\n;;;;\n");

    expect(parsed.items).toEqual([
      { name: "Tape", quantity: "two rolls", unit: "rolls", notes: "blue tape" },
    ]);
  });

  it("parses plain dictated Russian material text with quantity, unit, and spec", () => {
    const parsed = parseMaterialSpecPaste("Гипс 5 листов 5/8");

    expect(parsed.items).toEqual([
      { name: "Гипс", quantity: "5", unit: "листов", notes: "5/8" },
    ]);
  });

  it("dedupes repeated voice text into one editable material item", () => {
    const parsed = parseMaterialSpecPaste(
      "Гипс 5 листов ⅝ гипс гипс пять гипс пять листов 5/8",
    );

    expect(parsed.deduped).toBe(true);
    expect(parsed.items).toEqual([
      { name: "Гипс", quantity: "5", unit: "листов", notes: "5/8" },
    ]);
  });

  it("parses simple Russian number words and quantity-before-material phrasing", () => {
    const parsed = parseMaterialSpecPaste("пять листов гипс 1/2");

    expect(parsed.items).toEqual([
      { name: "гипс", quantity: "5", unit: "листов", notes: "1/2" },
    ]);
  });

  it("does not create duplicate rows for repeated same plain text lines", () => {
    const parsed = parseMaterialSpecPaste("Гипс 5 листов 5/8\nГипс 5 листов 5/8");

    expect(parsed.deduped).toBe(true);
    expect(parsed.items).toHaveLength(1);
  });
});
