import { describe, expect, it } from "vitest";
import {
  groupMaterialOrderItems,
  isReceiptCategoryMetadata,
  splitProjectMaterialMedia,
  toMaterialMediaAttachmentRef,
  type MaterialOrderGroupingItem,
} from "@/lib/materials-grouping";

type MaterialItem = MaterialOrderGroupingItem & {
  priority: "low" | "medium" | "urgent";
  links: string[];
};

function material(overrides: Partial<MaterialItem> & { id: string }): MaterialItem {
  return {
    id: overrides.id,
    authorName: overrides.authorName ?? "Andrew",
    createdAt: overrides.createdAt ?? "2026-05-01T12:00:00.000Z",
    priority: overrides.priority ?? "medium",
    metadata: overrides.metadata ?? {},
    links: overrides.links ?? [],
  };
}

function media(overrides: {
  id: string;
  kind?: string;
  category?: string;
  uploaded_by?: string | null;
}) {
  return {
    id: overrides.id,
    filename: `${overrides.id}.jpg`,
    mime_type: "image/jpeg",
    media_type: "photo",
    storage_path: `org/project/${overrides.id}.jpg`,
    uploaded_by: overrides.uploaded_by ?? null,
    metadata: {
      ...(overrides.kind ? { kind: overrides.kind } : {}),
      ...(overrides.category ? { category: overrides.category } : {}),
    },
  };
}

describe("materials grouping", () => {
  it("groups material rows by order id, keeps earliest group time, and preserves sort order", () => {
    const groups = groupMaterialOrderItems([
      material({
        id: "newer-same-order",
        createdAt: "2026-05-03T10:00:00.000Z",
        metadata: { order_id: "order-a", order_note: "pickup" },
      }),
      material({
        id: "legacy",
        createdAt: "2026-05-04T10:00:00.000Z",
        metadata: { order_note: "legacy note" },
      }),
      material({
        id: "older-same-order",
        createdAt: "2026-05-02T10:00:00.000Z",
        metadata: { order_id: "order-a", order_note: "pickup" },
      }),
    ]);

    expect(groups.map((group) => group.id)).toEqual(["legacy-legacy", "order-a"]);
    expect(groups[0]).toMatchObject({
      id: "legacy-legacy",
      orderId: null,
      note: "legacy note",
      createdAt: "2026-05-04T10:00:00.000Z",
    });
    expect(groups[1]).toMatchObject({
      id: "order-a",
      orderId: "order-a",
      note: "pickup",
      createdAt: "2026-05-02T10:00:00.000Z",
    });
    expect(groups[1].items.map((item) => item.id)).toEqual([
      "older-same-order",
      "newer-same-order",
    ]);
  });

  it("uses the first available group link without changing item sorting", () => {
    const groups = groupMaterialOrderItems(
      [
        material({
          id: "first",
          createdAt: "2026-05-01T10:00:00.000Z",
          metadata: { order_id: "order-b" },
        }),
        material({
          id: "second",
          createdAt: "2026-05-01T11:00:00.000Z",
          metadata: { order_id: "order-b" },
          links: ["https://supplier.example/spec"],
        }),
        material({
          id: "third",
          createdAt: "2026-05-01T12:00:00.000Z",
          metadata: { order_id: "order-b" },
          links: ["https://supplier.example/other"],
        }),
      ],
      { getLink: (item) => item.links[0] ?? null },
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].link).toBe("https://supplier.example/spec");
    expect(groups[0].items.map((item) => item.id)).toEqual(["first", "second", "third"]);
  });
});

describe("materials media grouping", () => {
  it("splits project media and receipt rows with independent bucket membership", () => {
    const rows = [
      media({ id: "project-file", kind: "project_media" }),
      media({ id: "receipt-kind", kind: "receipt" }),
      media({ id: "receipt-category", category: "receipt" }),
      media({ id: "dual", kind: "project_media", category: "receipt" }),
      media({ id: "other", kind: "task_attachment" }),
    ];

    const split = splitProjectMaterialMedia(rows);

    expect(split.projectMedia.map((item) => item.id)).toEqual(["project-file", "dual"]);
    expect(split.receipts.map((item) => item.id)).toEqual([
      "receipt-kind",
      "receipt-category",
      "dual",
    ]);
    expect(toMaterialMediaAttachmentRef(split.projectMedia[0])).toEqual({
      id: "project-file",
      filename: "project-file.jpg",
      mime_type: "image/jpeg",
      media_type: "photo",
      storage_path: "org/project/project-file.jpg",
    });
  });

  it("keeps worker receipt filtering and archive category-only receipt behavior explicit", () => {
    const split = splitProjectMaterialMedia(
      [
        media({ id: "own", category: "receipt", uploaded_by: "worker-1" }),
        media({ id: "other", category: "receipt", uploaded_by: "worker-2" }),
      ],
      { receiptFilter: (item) => item.uploaded_by === "worker-1" },
    );

    expect(split.receipts.map((item) => item.id)).toEqual(["own"]);
    expect(isReceiptCategoryMetadata({ category: "receipt" })).toBe(true);
    expect(isReceiptCategoryMetadata({ kind: "receipt" })).toBe(false);
  });
});
