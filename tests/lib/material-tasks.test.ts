import { describe, expect, it } from "vitest";
import {
  buildMaterialTaskMetadata,
  buildMaterialTaskNotificationText,
  buildMaterialTaskTitle,
  getMaterialIndicatorState,
  getMaterialTaskDriverId,
  getMaterialTaskItems,
  getMaterialTaskLinks,
  getMaterialTaskNeededDate,
  getMaterialTaskScheduleDate,
  getMaterialTaskUrgency,
  hasDriverSeenMaterialTask,
  hasOpenMaterialRequest,
  isMaterialTask,
  normalizeMaterialTaskLink,
  shouldShowInDriverMaterialList,
} from "@/lib/material-tasks";

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-1",
    title: "Task",
    priority: "medium",
    status: "pending",
    completed_at: null,
    deleted_at: null,
    assigned_to: "driver-1",
    due_date: null,
    metadata: {},
    ...overrides,
  };
}

describe("material task helpers", () => {
  it("detects material tasks by existing metadata", () => {
    expect(isMaterialTask(task({ metadata: { category: "material" } }))).toBe(true);
    expect(isMaterialTask(task({ metadata: { taskKind: "material" } }))).toBe(true);
    expect(isMaterialTask(task({ metadata: { materialRequest: true } }))).toBe(true);
    expect(isMaterialTask(task({ metadata: { category: "field" } }))).toBe(false);
  });

  it("parses urgency, needed date, and driver id from metadata", () => {
    const row = task({
      priority: "low",
      due_date: "2026-06-02",
      metadata: {
        category: "material",
        urgency: "urgent",
        neededDate: "2026-06-01",
        driverUserId: "driver-2",
      },
    });

    expect(getMaterialTaskUrgency(row)).toBe("urgent");
    expect(getMaterialTaskNeededDate(row)).toBe("2026-06-01");
    expect(getMaterialTaskScheduleDate(row)).toBe("2026-06-01");
    expect(getMaterialTaskDriverId(row)).toBe("driver-2");
  });

  it("falls back to task priority and due_date for legacy material rows", () => {
    const row = task({
      priority: "urgent",
      due_date: "2026-06-03",
      metadata: { category: "material" },
    });

    expect(getMaterialTaskUrgency(row)).toBe("urgent");
    expect(getMaterialTaskNeededDate(row)).toBe("2026-06-03");
  });

  it("builds stable material metadata without schema changes", () => {
    expect(
      buildMaterialTaskMetadata({
        materialName: "screws",
        urgency: "urgent",
        neededDate: "2026-06-04",
        requestedBy: "manager-1",
        driverUserId: "driver-1",
        projectId: "project-1",
        quantity: 12,
        unit: "шт",
        materialItems: [
          { name: "screws", quantity: 12, unit: "шт", notes: "deck screws" },
          { name: "paint", quantity: "1,5", unit: "л", notes: "" },
        ],
      }),
    ).toMatchObject({
      category: "material",
      taskKind: "material",
      materialRequest: true,
      materialName: "screws",
      urgency: "urgent",
      neededDate: "2026-06-04",
      requestedBy: "manager-1",
      driverUserId: "driver-1",
      projectId: "project-1",
      quantity: 12,
      unit: "шт",
      materialItems: [
        { name: "screws", quantity: 12, unit: "шт", notes: "deck screws" },
        { name: "paint", quantity: "1,5", unit: "л", notes: null },
      ],
      schedule_kind: "delivery",
      schedule_scope: "material",
      schedule_delivery_status: "assigned",
    });
  });

  it("reads material line items from task metadata", () => {
    expect(
      getMaterialTaskItems(
        task({
          metadata: {
            category: "material",
            materialItems: [
              { name: "Screws", quantity: "2 boxes", unit: "box", notes: "Deck" },
              { name: "   ", quantity: "1" },
              { material: "Paint", qty: 1.5, unit: "gal", comment: "White" },
            ],
          },
        }),
      ),
    ).toEqual([
      { name: "Screws", quantity: "2 boxes", unit: "box", notes: "Deck" },
      { name: "Paint", quantity: 1.5, unit: "gal", notes: "White" },
    ]);
  });

  it("normalizes and dedupes safe material request links", () => {
    expect(normalizeMaterialTaskLink("supplier.example/spec.pdf")).toBe(
      "https://supplier.example/spec.pdf",
    );
    expect(normalizeMaterialTaskLink("https://supplier.example/spec.pdf")).toBe(
      "https://supplier.example/spec.pdf",
    );
    expect(normalizeMaterialTaskLink("javascript:alert(1)")).toBeNull();
    expect(
      getMaterialTaskLinks(
        task({
          metadata: {
            category: "material",
            order_link: "supplier.example/spec.pdf",
            materialLinks: [
              "https://supplier.example/spec.pdf",
              "http://supplier.example/quote",
              "javascript:alert(1)",
            ],
          },
        }),
      ),
    ).toEqual([
      "https://supplier.example/spec.pdf",
      "http://supplier.example/quote",
    ]);
  });

  it("builds open queue material metadata when no assignee is selected", () => {
    expect(
      buildMaterialTaskMetadata({
        materialName: "paint",
        urgency: "normal",
        neededDate: "2026-06-04",
        requestedBy: "manager-1",
        driverUserId: null,
        projectId: "project-1",
      }),
    ).toMatchObject({
      category: "material",
      taskKind: "material",
      materialRequest: true,
      materialName: "paint",
      driverUserId: null,
      schedule_kind: "delivery",
      schedule_scope: "material",
      schedule_delivery_status: "open",
      delivery_available_to: "team",
    });
  });

  it("stores material request links in existing task metadata", () => {
    expect(
      buildMaterialTaskMetadata({
        materialName: "gypsum",
        urgency: "normal",
        requestedBy: "manager-1",
        driverUserId: null,
        projectId: "project-1",
        orderLink: "supplier.example/spec.pdf",
      }),
    ).toMatchObject({
      order_link: "https://supplier.example/spec.pdf",
      materialLinks: ["https://supplier.example/spec.pdf"],
    });
  });

  it("builds material title and alert text with project, urgency, material, and date", () => {
    const row = task({
      title: "screws",
      due_date: "2026-06-05",
      metadata: {
        category: "material",
        materialName: "screws",
        urgency: "urgent",
        neededDate: "2026-06-05",
      },
    });

    expect(buildMaterialTaskTitle("Mayers Project", "screws")).toBe(
      "Mayers Project: нужен материал — screws",
    );
    expect(buildMaterialTaskNotificationText(row, "Mayers Project")).toBe(
      "Mayers Project: срочно нужен материал — screws, 2026-06-05",
    );
  });

  it("shows assigned material tasks in the driver material list only when relevant", () => {
    expect(
      shouldShowInDriverMaterialList(
        task({ metadata: { category: "material" }, assigned_to: "driver-1" }),
        { id: "driver-1" },
      ),
    ).toBe(true);
    expect(
      shouldShowInDriverMaterialList(
        task({ metadata: { category: "material" }, assigned_to: "driver-2" }),
        { id: "driver-1" },
      ),
    ).toBe(false);
    expect(
      shouldShowInDriverMaterialList(
        task({ metadata: { category: "material" }, assigned_to: null }),
        { id: "driver-1" },
      ),
    ).toBe(true);
    expect(
      shouldShowInDriverMaterialList(task({ metadata: { category: "field" } }), {
        id: "driver-1",
      }),
    ).toBe(false);
  });

  it("derives open material indicators and seen state from existing status metadata", () => {
    const rows = [
      task({
        id: "urgent",
        priority: "urgent",
        metadata: {
          category: "material",
          driverUserId: "driver-1",
          seen_by: { "driver-1": "2026-06-01T10:00:00Z" },
        },
      }),
      task({
        id: "done",
        status: "done",
        completed_at: "2026-06-01T11:00:00Z",
        metadata: { category: "material" },
      }),
      task({ id: "normal", metadata: { category: "field" } }),
    ];

    const state = getMaterialIndicatorState(rows);
    expect(state.openCount).toBe(1);
    expect(state.urgentCount).toBe(1);
    expect(state.seenCount).toBe(1);
    expect(state.primaryLabel).toBe("urgent");
    expect(hasOpenMaterialRequest(rows)).toBe(true);
    expect(hasDriverSeenMaterialTask(rows[0])).toBe(true);
  });
});
