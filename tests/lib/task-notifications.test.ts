import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyClaimedTaskAssignment,
  buildTaskCompletionMetadata,
  classifyTaskForWorker,
  countUnseenTasks,
  getCompletionMediaIds,
  getCompletionNote,
  getFollowUpInfo,
  getTaskCompletionAudit,
  groupWorkerTasksByProject,
  isTaskVisibleToWorker,
  loadTaskLastSeen,
  mergeCompletionNote,
  saveTaskLastSeen,
  shouldBlockCompletionFileUpload,
  splitWorkerProjectTasks,
} from "@/lib/task-notifications";

function makeTask(overrides: Partial<Parameters<typeof isTaskVisibleToWorker>[0]> & { id: string }) {
  return {
    assigned_to: null,
    project_id: null,
    status: "pending",
    created_at: "2026-04-01T10:00:00Z",
    deleted_at: null,
    ...overrides,
  };
}

describe("isTaskVisibleToWorker", () => {
  const args = {
    profileId: "w1",
    visibleProjectIds: new Set(["p1", "p2"]),
  };

  it("includes personal tasks assigned to this worker", () => {
    expect(
      isTaskVisibleToWorker(
        makeTask({ id: "t1", assigned_to: "w1", project_id: "p1" }),
        args,
      ),
    ).toBe(true);
  });

  it("includes project-level tasks (assigned_to=null) on a visible project", () => {
    expect(
      isTaskVisibleToWorker(
        makeTask({ id: "t2", assigned_to: null, project_id: "p1" }),
        args,
      ),
    ).toBe(true);
  });

  it("excludes project-level tasks on a project the worker can't see", () => {
    expect(
      isTaskVisibleToWorker(
        makeTask({ id: "t3", assigned_to: null, project_id: "pX" }),
        args,
      ),
    ).toBe(false);
  });

  it("includes open team delivery tasks even before a person claims them", () => {
    expect(
      isTaskVisibleToWorker(
        makeTask({
          id: "delivery-open",
          assigned_to: null,
          project_id: null,
          metadata: { schedule_kind: "delivery", schedule_delivery_status: "open" },
        }),
        args,
      ),
    ).toBe(true);
  });

  it("shows open material tasks only to eligible field users", () => {
    const openMaterial = makeTask({
      id: "open-material",
      assigned_to: null,
      project_id: "p1",
      metadata: {
        category: "material",
        schedule_kind: "delivery",
        schedule_delivery_status: "open",
      },
    });

    expect(
      isTaskVisibleToWorker(openMaterial, {
        ...args,
        profileRole: "worker",
        canSeeOpenMaterialTasks: true,
      }),
    ).toBe(true);
    expect(
      isTaskVisibleToWorker(openMaterial, {
        ...args,
        profileRole: "driver",
        canSeeOpenMaterialTasks: true,
        materialOnly: true,
      }),
    ).toBe(true);
    expect(
      isTaskVisibleToWorker(openMaterial, {
        ...args,
        profileRole: "supervisor",
        canSeeOpenMaterialTasks: false,
      }),
    ).toBe(false);
  });

  it("excludes tasks assigned to another worker", () => {
    expect(
      isTaskVisibleToWorker(
        makeTask({ id: "t4", assigned_to: "w2", project_id: "p1" }),
        args,
      ),
    ).toBe(false);
  });

  it("excludes done / cancelled tasks even when otherwise visible", () => {
    expect(
      isTaskVisibleToWorker(
        makeTask({ id: "t5", assigned_to: "w1", project_id: "p1", status: "done" }),
        args,
      ),
    ).toBe(false);
    expect(
      isTaskVisibleToWorker(
        makeTask({ id: "t6", assigned_to: "w1", project_id: "p1", status: "cancelled" }),
        args,
      ),
    ).toBe(false);
  });

  it("excludes legacy completed tasks when status is still pending", () => {
    expect(
      isTaskVisibleToWorker(
        makeTask({
          id: "legacy-done",
          assigned_to: "w1",
          project_id: "p1",
          status: "pending",
          completed_at: "2026-05-10T22:27:00Z",
        }),
        args,
      ),
    ).toBe(false);
  });

  it("excludes soft-deleted tasks", () => {
    expect(
      isTaskVisibleToWorker(
        makeTask({
          id: "t7",
          assigned_to: "w1",
          project_id: "p1",
          deleted_at: "2026-04-02T00:00:00Z",
        }),
        args,
      ),
    ).toBe(false);
  });

  it("filters the focused driver queue to material tasks only", () => {
    const driverArgs = { ...args, profileRole: "driver" };

    expect(
      isTaskVisibleToWorker(
        makeTask({
          id: "material",
          assigned_to: "w1",
          project_id: "p1",
          metadata: { category: "material" },
        }),
        driverArgs,
      ),
    ).toBe(true);
    expect(
      isTaskVisibleToWorker(
        makeTask({ id: "normal", assigned_to: "w1", project_id: "p1" }),
        driverArgs,
      ),
    ).toBe(false);
    expect(
      isTaskVisibleToWorker(
        makeTask({ id: "normal-worker", assigned_to: "w1", project_id: "p1" }),
        args,
      ),
    ).toBe(true);
  });

  it("can keep completed rows visible for realtime status merges", () => {
    expect(
      isTaskVisibleToWorker(
        makeTask({
          id: "done-material",
          assigned_to: "w1",
          project_id: "p1",
          status: "done",
          metadata: { category: "material" },
        }),
        { ...args, profileRole: "driver", includeClosed: true },
      ),
    ).toBe(true);
  });
});

describe("countUnseenTasks", () => {
  const args = {
    profileId: "w1",
    visibleProjectIds: new Set(["p1"]),
  };

  it("counts visible tasks newer than lastSeenIso", () => {
    const tasks = [
      makeTask({ id: "old", assigned_to: "w1", project_id: "p1", created_at: "2026-04-01T10:00:00Z" }),
      makeTask({ id: "new", assigned_to: "w1", project_id: "p1", created_at: "2026-04-02T10:00:00Z" }),
    ];
    const result = countUnseenTasks(tasks, "2026-04-01T12:00:00Z", args);
    expect(result.count).toBe(1);
    expect(result.latestCreatedAt).toBe("2026-04-02T10:00:00Z");
  });

  it("treats every visible task as unseen when lastSeenIso is null", () => {
    const tasks = [
      makeTask({ id: "a", assigned_to: "w1", project_id: "p1", created_at: "2026-04-01T10:00:00Z" }),
      makeTask({ id: "b", assigned_to: null, project_id: "p1", created_at: "2026-04-02T10:00:00Z" }),
    ];
    const result = countUnseenTasks(tasks, null, args);
    expect(result.count).toBe(2);
    expect(result.latestCreatedAt).toBe("2026-04-02T10:00:00Z");
  });

  it("does not count done / cancelled / hidden tasks", () => {
    const tasks = [
      makeTask({
        id: "done",
        assigned_to: "w1",
        project_id: "p1",
        status: "done",
        created_at: "2026-04-02T10:00:00Z",
      }),
      makeTask({
        id: "cancelled",
        assigned_to: "w1",
        project_id: "p1",
        status: "cancelled",
        created_at: "2026-04-02T10:00:00Z",
      }),
      makeTask({
        id: "other-worker",
        assigned_to: "w2",
        project_id: "p1",
        created_at: "2026-04-02T10:00:00Z",
      }),
    ];
    const result = countUnseenTasks(tasks, "2026-04-01T00:00:00Z", args);
    expect(result.count).toBe(0);
  });

  it("does not count tasks already seen by this worker in task metadata", () => {
    const tasks = [
      makeTask({
        id: "seen",
        assigned_to: "w1",
        project_id: "p1",
        created_at: "2026-04-02T10:00:00Z",
        metadata: {
          seen_by: {
            w1: "2026-04-02T10:05:00Z",
          },
        },
      }),
    ];

    const result = countUnseenTasks(tasks, "2026-04-01T00:00:00Z", args);

    expect(result.count).toBe(0);
    expect(result.latestCreatedAt).toBe("2026-04-02T10:00:00Z");
  });

  it("keeps seen tasks visible in the worker task lists", () => {
    const tasks = [
      makeTask({
        id: "seen-open",
        assigned_to: "w1",
        project_id: "p1",
        metadata: {
          seen_by: {
            w1: "2026-04-02T10:05:00Z",
          },
        },
      }),
    ];

    expect(isTaskVisibleToWorker(tasks[0], args)).toBe(true);
    const split = splitWorkerProjectTasks(tasks, "w1");
    expect(split.mineTasks.map((task) => task.id)).toEqual(["seen-open"]);
    expect(split.completedTasks).toHaveLength(0);
  });

  it("still counts tasks only seen by another worker", () => {
    const tasks = [
      makeTask({
        id: "seen-by-other",
        assigned_to: "w1",
        project_id: "p1",
        created_at: "2026-04-02T10:00:00Z",
        metadata: {
          seen_by: {
            w2: "2026-04-02T10:05:00Z",
          },
        },
      }),
    ];

    const result = countUnseenTasks(tasks, "2026-04-01T00:00:00Z", args);

    expect(result.count).toBe(1);
  });

  it("returns latestCreatedAt across all visible tasks even when none are new", () => {
    // Used by the worker shell to seed lastSeenAt on first load so the
    // initial flood of historical tasks doesn't trigger a banner.
    const tasks = [
      makeTask({ id: "a", assigned_to: "w1", project_id: "p1", created_at: "2026-04-01T10:00:00Z" }),
      makeTask({ id: "b", assigned_to: "w1", project_id: "p1", created_at: "2026-04-02T10:00:00Z" }),
    ];
    const result = countUnseenTasks(tasks, "2026-04-03T00:00:00Z", args);
    expect(result.count).toBe(0);
    expect(result.latestCreatedAt).toBe("2026-04-02T10:00:00Z");
  });
});

describe("groupWorkerTasksByProject", () => {
  function row(
    overrides: Partial<{
      id: string;
      project_id: string | null;
      projectName: string | null;
      priority: string;
      created_at: string;
    }> & { id: string },
  ) {
    return {
      project_id: null,
      projectName: null,
      priority: "medium",
      created_at: "2026-04-01T10:00:00Z",
      ...overrides,
    };
  }

  it("places the current/active project bucket first, others alphabetically", () => {
    const tasks = [
      row({ id: "z1", project_id: "pZ", projectName: "Zebra" }),
      row({ id: "a1", project_id: "pA", projectName: "Alpha" }),
      row({ id: "c1", project_id: "pC", projectName: "Current" }),
    ];
    const buckets = groupWorkerTasksByProject(tasks, {
      currentProjectId: "pC",
      generalLabel: "General",
    });
    expect(buckets.map((b) => b.key)).toEqual(["pC", "pA", "pZ"]);
  });

  it("falls back to alphabetical when no current project is set", () => {
    const tasks = [
      row({ id: "z1", project_id: "pZ", projectName: "Zebra" }),
      row({ id: "a1", project_id: "pA", projectName: "Alpha" }),
    ];
    const buckets = groupWorkerTasksByProject(tasks, {
      currentProjectId: null,
      generalLabel: "General",
    });
    expect(buckets.map((b) => b.key)).toEqual(["pA", "pZ"]);
  });

  it("puts the no-project bucket last", () => {
    const tasks = [
      row({ id: "n1", project_id: null, projectName: null }),
      row({ id: "a1", project_id: "pA", projectName: "Alpha" }),
    ];
    const buckets = groupWorkerTasksByProject(tasks, {
      generalLabel: "General",
    });
    expect(buckets.map((b) => b.key)).toEqual(["pA", "__noproject__"]);
    expect(buckets[1].name).toBe("General");
  });

  it("sorts inside a bucket by priority then created_at desc", () => {
    const tasks = [
      row({
        id: "old-urgent",
        project_id: "pA",
        priority: "urgent",
        created_at: "2026-04-01T10:00:00Z",
      }),
      row({
        id: "new-low",
        project_id: "pA",
        priority: "low",
        created_at: "2026-04-03T10:00:00Z",
      }),
      row({
        id: "new-urgent",
        project_id: "pA",
        priority: "urgent",
        created_at: "2026-04-02T10:00:00Z",
      }),
    ];
    const buckets = groupWorkerTasksByProject(tasks, {
      generalLabel: "General",
    });
    expect(buckets[0].tasks.map((t) => t.id)).toEqual([
      "new-urgent",
      "old-urgent",
      "new-low",
    ]);
  });
});

describe("classifyTaskForWorker", () => {
  it("returns personal for tasks assigned to the worker", () => {
    expect(
      classifyTaskForWorker({ assigned_to: "w1", project_id: "p1" }, "w1"),
    ).toBe("personal");
  });

  it("returns project for assigned_to=null with a project", () => {
    expect(
      classifyTaskForWorker({ assigned_to: null, project_id: "p1" }, "w1"),
    ).toBe("project");
  });

  it("returns other for tasks assigned to someone else", () => {
    expect(
      classifyTaskForWorker({ assigned_to: "w2", project_id: "p1" }, "w1"),
    ).toBe("other");
  });

  it("returns other for assigned_to=null with no project", () => {
    expect(
      classifyTaskForWorker({ assigned_to: null, project_id: null }, "w1"),
    ).toBe("other");
  });
});

describe("applyClaimedTaskAssignment", () => {
  it("overlays a claimed general task so the modal can become actionable immediately", () => {
    const tasks = [
      { id: "task-1", assigned_to: null, title: "Crew task" },
      { id: "task-2", assigned_to: "someone", title: "Other task" },
    ];
    const next = applyClaimedTaskAssignment(tasks, "task-1", "worker-1");
    expect(next[0]).toEqual({ id: "task-1", assigned_to: "worker-1", title: "Crew task" });
    expect(next[1]).toBe(tasks[1]);
    expect(tasks[0].assigned_to).toBeNull();
  });
});

describe("splitWorkerProjectTasks", () => {
  it("keeps read/seen and taken tasks visible in the open worker sections", () => {
    const split = splitWorkerProjectTasks(
      [
        {
          id: "seen-personal",
          assigned_to: "worker-1",
          status: "pending",
          metadata: { seen_by: { "worker-1": "2026-05-21T10:00:00Z" } },
        },
        {
          id: "taken-personal",
          assigned_to: "worker-1",
          status: "in_progress",
          metadata: { started_by: "worker-1", started_at: "2026-05-21T10:05:00Z" },
        },
        {
          id: "seen-project",
          assigned_to: null,
          status: "pending",
          metadata: { seen_by: { "worker-1": "2026-05-21T10:10:00Z" } },
        },
      ],
      "worker-1",
    );

    expect(split.mineTasks.map((task) => task.id)).toEqual([
      "seen-personal",
      "taken-personal",
    ]);
    expect(split.projectLevelTasks.map((task) => task.id)).toEqual(["seen-project"]);
    expect(split.completedTasks).toHaveLength(0);
  });

  it("keeps completed project-view tasks in a separate completed section", () => {
    const split = splitWorkerProjectTasks(
      [
        { id: "mine-open", assigned_to: "worker-1", status: "pending" },
        { id: "project-open", assigned_to: null, status: "in_progress" },
        { id: "done-mine", assigned_to: "worker-1", status: "done" },
        { id: "done-project", assigned_to: null, status: "done" },
        {
          id: "legacy-done-project",
          assigned_to: null,
          status: "pending",
          completed_at: "2026-05-10T22:27:00Z",
        },
      ],
      "worker-1",
    );
    expect(split.mineTasks.map((task) => task.id)).toEqual(["mine-open"]);
    expect(split.projectLevelTasks.map((task) => task.id)).toEqual(["project-open"]);
    expect(split.completedTasks.map((task) => task.id)).toEqual([
      "done-mine",
      "done-project",
      "legacy-done-project",
    ]);
  });
});

describe("shouldBlockCompletionFileUpload", () => {
  it("blocks no-project task media so selected files are not silently dropped", () => {
    expect(shouldBlockCompletionFileUpload({ projectId: null, fileCount: 1 })).toBe(true);
    expect(shouldBlockCompletionFileUpload({ projectId: undefined, fileCount: 1 })).toBe(true);
  });

  it("allows empty no-project completions and project-backed media completions", () => {
    expect(shouldBlockCompletionFileUpload({ projectId: null, fileCount: 0 })).toBe(false);
    expect(shouldBlockCompletionFileUpload({ projectId: "project-1", fileCount: 2 })).toBe(false);
  });
});

describe("loadTaskLastSeen / saveTaskLastSeen", () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        },
        removeItem: (key: string) => {
          storage.delete(key);
        },
      },
    } as unknown as Window);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("round-trips per profileId without leaking between workers", () => {
    saveTaskLastSeen("w1", "2026-04-01T10:00:00Z");
    saveTaskLastSeen("w2", "2026-04-02T10:00:00Z");
    expect(loadTaskLastSeen("w1")).toBe("2026-04-01T10:00:00Z");
    expect(loadTaskLastSeen("w2")).toBe("2026-04-02T10:00:00Z");
    expect(loadTaskLastSeen("w3")).toBeNull();
  });
});

describe("mergeCompletionNote", () => {
  it("returns the existing metadata unchanged when the note is empty", () => {
    const existing = { source: "ui", attachment_media_ids: ["a", "b"] };
    const merged = mergeCompletionNote(existing, "");
    expect(merged).toEqual(existing);
    // New object — caller can pass straight to Supabase update.
    expect(merged).not.toBe(existing);
  });

  it("returns the existing metadata unchanged when the note is whitespace-only", () => {
    const merged = mergeCompletionNote({ k: 1 }, "   \n\t");
    expect(merged).toEqual({ k: 1 });
    expect(merged.completion_note).toBeUndefined();
  });

  it("trims and stamps the note + a timestamp on done", () => {
    const merged = mergeCompletionNote({ source: "ui" }, "  finished framing  ");
    expect(merged.source).toBe("ui");
    expect(merged.completion_note).toBe("finished framing");
    expect(typeof merged.completion_note_at).toBe("string");
    // Sanity: ISO timestamp.
    expect(new Date(merged.completion_note_at as string).toString()).not.toBe(
      "Invalid Date",
    );
  });

  it("treats null / undefined existing metadata as an empty object", () => {
    const merged = mergeCompletionNote(null, "ok");
    expect(merged.completion_note).toBe("ok");
    const merged2 = mergeCompletionNote(undefined, "ok");
    expect(merged2.completion_note).toBe("ok");
  });

  it("does not stomp keys other than completion_note*", () => {
    const merged = mergeCompletionNote(
      { attachment_media_ids: ["a"], category: "field" },
      "wrap-up",
    );
    expect(merged.attachment_media_ids).toEqual(["a"]);
    expect(merged.category).toBe("field");
    expect(merged.completion_note).toBe("wrap-up");
  });
});

describe("buildTaskCompletionMetadata", () => {
  it("returns a clone of existing metadata when payload is empty", () => {
    const existing = { attachment_media_ids: ["a"], category: "field" };
    const out = buildTaskCompletionMetadata(existing, {});
    expect(out).toEqual(existing);
    expect(out).not.toBe(existing);
  });

  it("writes completion_note + timestamp on a non-empty note", () => {
    const out = buildTaskCompletionMetadata(null, { note: "  finished framing  " });
    expect(out.completion_note).toBe("finished framing");
    expect(typeof out.completion_note_at).toBe("string");
    expect(new Date(out.completion_note_at as string).toString()).not.toBe("Invalid Date");
  });

  it("writes follow_up_required + note when the worker flagged follow-up", () => {
    const out = buildTaskCompletionMetadata(null, {
      followUpRequired: true,
      followUpNote: "  needs paint touch-up  ",
    });
    expect(out.follow_up_required).toBe(true);
    expect(out.follow_up_note).toBe("needs paint touch-up");
    expect(typeof out.follow_up_at).toBe("string");
  });

  it("clears prior follow-up flags when followUpRequired is explicitly false", () => {
    const existing = {
      follow_up_required: true,
      follow_up_at: "2026-04-01T00:00:00Z",
      follow_up_note: "old note",
    };
    const out = buildTaskCompletionMetadata(existing, { followUpRequired: false });
    expect(out.follow_up_required).toBeUndefined();
    expect(out.follow_up_at).toBeUndefined();
    expect(out.follow_up_note).toBeUndefined();
  });

  it("merges completionMediaIds with the existing list, deduping", () => {
    const existing = { completion_media_ids: ["m1", "m2"] };
    const out = buildTaskCompletionMetadata(existing, {
      completionMediaIds: ["m2", "m3"],
    });
    expect(out.completion_media_ids).toEqual(["m1", "m2", "m3"]);
  });

  it("ignores completionMediaIds when the array is empty", () => {
    const out = buildTaskCompletionMetadata(null, { completionMediaIds: [] });
    expect(out.completion_media_ids).toBeUndefined();
  });

  it("stamps completed_by_recorded for the audit trail", () => {
    const out = buildTaskCompletionMetadata(null, { completedById: "w1" });
    expect(out.completed_by_recorded).toBe("w1");
  });

  it("preserves unrelated existing keys (attachment_media_ids, category)", () => {
    const existing = { attachment_media_ids: ["att1"], category: "field" };
    const out = buildTaskCompletionMetadata(existing, {
      note: "done",
      followUpRequired: true,
      followUpNote: "next week",
      completionMediaIds: ["m1"],
    });
    expect(out.attachment_media_ids).toEqual(["att1"]);
    expect(out.category).toBe("field");
    expect(out.completion_note).toBe("done");
    expect(out.follow_up_required).toBe(true);
    expect(out.follow_up_note).toBe("next week");
    expect(out.completion_media_ids).toEqual(["m1"]);
  });

  it("ignores whitespace-only note + follow-up note", () => {
    const out = buildTaskCompletionMetadata(null, {
      note: "   ",
      followUpRequired: true,
      followUpNote: "   ",
    });
    expect(out.completion_note).toBeUndefined();
    expect(out.follow_up_required).toBe(true);
    expect(out.follow_up_note).toBeUndefined();
  });
});

describe("getCompletionMediaIds / getFollowUpInfo / getCompletionNote", () => {
  it("returns an empty list when metadata has no completion_media_ids", () => {
    expect(getCompletionMediaIds({ metadata: {} })).toEqual([]);
    expect(getCompletionMediaIds({})).toEqual([]);
  });

  it("filters non-string entries out of completion_media_ids", () => {
    expect(
      getCompletionMediaIds({
        metadata: { completion_media_ids: ["a", 1, null, "b"] },
      }),
    ).toEqual(["a", "b"]);
  });

  it("reads follow-up info defensively", () => {
    expect(getFollowUpInfo({ metadata: { follow_up_required: true, follow_up_note: "x" } })).toEqual({
      required: true,
      note: "x",
    });
    expect(getFollowUpInfo({ metadata: {} })).toEqual({ required: false, note: null });
    expect(getFollowUpInfo({})).toEqual({ required: false, note: null });
  });

  it("reads the completion note defensively", () => {
    expect(getCompletionNote({ metadata: { completion_note: "ok" } })).toBe("ok");
    expect(getCompletionNote({ metadata: {} })).toBeNull();
    expect(getCompletionNote({ metadata: { completion_note: 42 } })).toBeNull();
  });
});

describe("getTaskCompletionAudit", () => {
  it("treats legacy pending tasks with completed_at as audited completion", () => {
    const audit = getTaskCompletionAudit({
      status: "pending",
      completed_at: "2026-05-10T22:27:00Z",
      completed_by: "worker-1",
    });

    expect(audit.hasAudit).toBe(true);
    expect(audit.completedById).toBe("worker-1");
    expect(audit.completedAt).toBe("2026-05-10T22:27:00Z");
  });
});
