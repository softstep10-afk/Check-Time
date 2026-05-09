import { describe, expect, it } from "vitest";
import {
  isReceiptMedia,
  isReceiptVisibleToWorker,
} from "@/lib/worker-receipt-visibility";

describe("isReceiptMedia", () => {
  it("recognises the worker-side category=receipt shape", () => {
    expect(
      isReceiptMedia({
        uploaded_by: "w1",
        metadata: { category: "receipt", amount: 12.34 },
      }),
    ).toBe(true);
  });

  it("recognises the manager-side kind=receipt shape", () => {
    expect(
      isReceiptMedia({
        uploaded_by: "m1",
        metadata: { kind: "receipt" },
      }),
    ).toBe(true);
  });

  it("rejects project_media / journal entries", () => {
    expect(
      isReceiptMedia({
        uploaded_by: "w1",
        metadata: { kind: "project_media" },
      }),
    ).toBe(false);
    expect(isReceiptMedia({ uploaded_by: "w1", metadata: null })).toBe(false);
  });
});

describe("isReceiptVisibleToWorker", () => {
  it("returns true for the worker's own receipt", () => {
    expect(
      isReceiptVisibleToWorker(
        { uploaded_by: "w1", metadata: { category: "receipt", amount: 50 } },
        "w1",
      ),
    ).toBe(true);
  });

  it("hides receipts uploaded by another worker", () => {
    // Vasya cannot see Oliver's receipts on the same project — that
    // would expose project material cost in aggregate.
    expect(
      isReceiptVisibleToWorker(
        { uploaded_by: "w2", metadata: { category: "receipt", amount: 80 } },
        "w1",
      ),
    ).toBe(false);
  });

  it("hides manager-uploaded receipts from the worker view", () => {
    expect(
      isReceiptVisibleToWorker(
        { uploaded_by: "manager-id", metadata: { kind: "receipt" } },
        "w1",
      ),
    ).toBe(false);
  });

  it("hides non-receipt rows even when the worker uploaded them", () => {
    expect(
      isReceiptVisibleToWorker(
        { uploaded_by: "w1", metadata: { kind: "project_media" } },
        "w1",
      ),
    ).toBe(false);
  });

  it("does not crash on null metadata", () => {
    expect(
      isReceiptVisibleToWorker({ uploaded_by: "w1", metadata: null }, "w1"),
    ).toBe(false);
  });

  it("does not match when uploaded_by is null (server-side rows with no actor)", () => {
    expect(
      isReceiptVisibleToWorker(
        { uploaded_by: null, metadata: { category: "receipt" } },
        "w1",
      ),
    ).toBe(false);
  });
});
