import { describe, expect, it } from "vitest";
import {
  areListsEqualByFingerprint,
  keepStableListIfUnchanged,
} from "@/lib/list-stability";

type Row = {
  id: string;
  updatedAt: string;
  label: string;
};

const fingerprint = (row: Row) => `${row.id}:${row.updatedAt}:${row.label}`;

describe("list-stability helpers", () => {
  it("keeps the current reference when the next list has the same fingerprints", () => {
    const current: Row[] = [
      { id: "a", updatedAt: "1", label: "Alpha" },
      { id: "b", updatedAt: "2", label: "Beta" },
    ];
    const next: Row[] = [
      { id: "a", updatedAt: "1", label: "Alpha" },
      { id: "b", updatedAt: "2", label: "Beta" },
    ];

    expect(areListsEqualByFingerprint(current, next, fingerprint)).toBe(true);
    expect(keepStableListIfUnchanged(current, next, fingerprint)).toBe(current);
  });

  it("returns the next list when order, length, or fingerprint changes", () => {
    const current: Row[] = [
      { id: "a", updatedAt: "1", label: "Alpha" },
      { id: "b", updatedAt: "2", label: "Beta" },
    ];
    const changed: Row[] = [
      { id: "a", updatedAt: "1", label: "Alpha" },
      { id: "b", updatedAt: "3", label: "Beta" },
    ];
    const reordered: Row[] = [
      { id: "b", updatedAt: "2", label: "Beta" },
      { id: "a", updatedAt: "1", label: "Alpha" },
    ];
    const shorter = current.slice(0, 1);

    expect(keepStableListIfUnchanged(current, changed, fingerprint)).toBe(changed);
    expect(keepStableListIfUnchanged(current, reordered, fingerprint)).toBe(reordered);
    expect(keepStableListIfUnchanged(current, shorter, fingerprint)).toBe(shorter);
  });
});
