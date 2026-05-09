import { describe, expect, it } from "vitest";
import {
  buildProfileNameMap,
  buildTaskCompletionMetadata,
  getCompletionMediaIds,
  getCompletionNote,
  getFollowUpInfo,
  getTaskCompletionAudit,
} from "@/lib/task-notifications";

/**
 * Behavioural tests around the worker task-completion flow.
 *
 * The UI rule is:
 *   • Every "Mark done" entry point routes through the completion modal.
 *   • The modal calls the parent's onDone with an optional payload.
 *   • The shell composes metadata via buildTaskCompletionMetadata and
 *     persists it in tasks.metadata.
 *   • Manager / worker surfaces read the same metadata back via
 *     getCompletionNote / getFollowUpInfo / getCompletionMediaIds.
 *
 * These tests pin the metadata contract — the UI tests have a green
 * net to fall back on whenever the modal flows are touched.
 */

describe("task completion metadata round-trip", () => {
  it("note-only completion is readable by the manager surfaces", () => {
    const meta = buildTaskCompletionMetadata(null, {
      note: "Fixed the leak.",
      completedById: "worker-1",
    });
    expect(getCompletionNote({ metadata: meta })).toBe("Fixed the leak.");
    expect(getFollowUpInfo({ metadata: meta })).toEqual({
      required: false,
      note: null,
    });
    expect(getCompletionMediaIds({ metadata: meta })).toEqual([]);
    expect(meta.completed_by_recorded).toBe("worker-1");
  });

  it("a follow-up completion preserves the follow-up note alongside the main note", () => {
    const meta = buildTaskCompletionMetadata(null, {
      note: "Painted ceiling.",
      followUpRequired: true,
      followUpNote: "Touch up corner near the window next visit.",
      completionMediaIds: ["m-1", "m-2"],
      completedById: "vasya",
    });
    expect(getCompletionNote({ metadata: meta })).toBe("Painted ceiling.");
    expect(getFollowUpInfo({ metadata: meta })).toEqual({
      required: true,
      note: "Touch up corner near the window next visit.",
    });
    expect(getCompletionMediaIds({ metadata: meta })).toEqual(["m-1", "m-2"]);
  });

  it("media-only completion still flips the media id array on", () => {
    // The worker can mark a task done with just photos and no text.
    const meta = buildTaskCompletionMetadata(null, {
      completionMediaIds: ["m-3"],
      completedById: "vasya",
    });
    expect(getCompletionNote({ metadata: meta })).toBeNull();
    expect(getCompletionMediaIds({ metadata: meta })).toEqual(["m-3"]);
  });

  it("completion does NOT clobber existing attachment_media_ids the manager pre-attached", () => {
    const existing = { attachment_media_ids: ["att-1"] };
    const meta = buildTaskCompletionMetadata(existing, {
      note: "Ok",
      completionMediaIds: ["m-9"],
    });
    expect(meta.attachment_media_ids).toEqual(["att-1"]);
    expect(getCompletionMediaIds({ metadata: meta })).toEqual(["m-9"]);
  });

  it("re-completing a follow-up task with followUpRequired=false clears the flag", () => {
    // The "Mark done" button on a previously-flagged task lets the
    // worker close the loop. Manager surfaces should see the flag drop.
    const stale = buildTaskCompletionMetadata(null, {
      followUpRequired: true,
      followUpNote: "Will do later.",
    });
    expect(getFollowUpInfo({ metadata: stale }).required).toBe(true);

    const cleared = buildTaskCompletionMetadata(stale, {
      note: "Done for real this time.",
      followUpRequired: false,
    });
    expect(getFollowUpInfo({ metadata: cleared }).required).toBe(false);
    expect(getCompletionNote({ metadata: cleared })).toBe("Done for real this time.");
  });

  it("an empty payload still records the timestamp via the parent's tasks.completed_at — the metadata stays untouched", () => {
    // Modal lets the worker submit with no note + no files + no
    // follow-up. The shell is expected to write status=done and
    // completed_at via the canonical columns; the metadata helper
    // produces a clean clone of existing metadata.
    const existing = { attachment_media_ids: ["att-1"], category: "field" };
    const meta = buildTaskCompletionMetadata(existing, {});
    expect(meta).toEqual(existing);
    expect(meta).not.toBe(existing);
  });
});

describe("manager view reads completion data even when written by worker", () => {
  it("shows completed_by and completed_at for an empty worker completion", () => {
    const profileNames = buildProfileNameMap([
      { id: "worker-1", name: "Alex Worker" },
    ]);
    const audit = getTaskCompletionAudit(
      {
        status: "done",
        completed_by: "worker-1",
        completed_at: "2026-05-01T10:30:00Z",
        metadata: {},
      },
      profileNames,
    );
    expect(audit).toEqual({
      hasAudit: true,
      completedById: "worker-1",
      completedByName: "Alex Worker",
      completedAt: "2026-05-01T10:30:00Z",
    });
  });

  it("keeps assignment and completion actor separate for directly assigned tasks", () => {
    const profileNames = buildProfileNameMap([
      { id: "assigned-worker", name: "Assigned Worker" },
      { id: "completed-worker", name: "Completed Worker" },
    ]);
    const audit = getTaskCompletionAudit(
      {
        status: "done",
        completed_by: "completed-worker",
        completed_at: "2026-05-01T10:30:00Z",
        metadata: {},
      },
      profileNames,
    );

    expect(profileNames.get("assigned-worker")).toBe("Assigned Worker");
    expect(audit.completedByName).toBe("Completed Worker");
  });

  it("shows completed_by for a general task even when assigned_to is null", () => {
    const profileNames = buildProfileNameMap([
      { id: "worker-2", name: "Vasya" },
    ]);
    const audit = getTaskCompletionAudit(
      {
        status: "done",
        completed_by: "worker-2",
        completed_at: "2026-05-01T10:30:00Z",
        metadata: {},
      },
      profileNames,
    );

    expect(audit.completedById).toBe("worker-2");
    expect(audit.completedByName).toBe("Vasya");
  });

  it("falls back to metadata.completed_by_recorded when completed_by is missing", () => {
    const profileNames = buildProfileNameMap([
      { id: "worker-3", name: "Nikolai" },
    ]);
    const audit = getTaskCompletionAudit(
      {
        status: "done",
        completed_by: null,
        completed_at: "2026-05-01T10:30:00Z",
        metadata: { completed_by_recorded: "worker-3" },
      },
      profileNames,
    );

    expect(audit.completedById).toBe("worker-3");
    expect(audit.completedByName).toBe("Nikolai");
  });

  it("uses per-task completedByName from the manager route when workers list misses the profile", () => {
    const audit = getTaskCompletionAudit(
      {
        status: "done",
        completed_by: "inactive-worker",
        completedByName: "Inactive Worker",
        completed_at: "2026-05-01T10:30:00Z",
        metadata: {},
      },
      new Map(),
    );

    expect(audit.completedByName).toBe("Inactive Worker");
  });

  it("getCompletionMediaIds is robust to manager-side queries that include metadata=null", () => {
    expect(getCompletionMediaIds({ metadata: null })).toEqual([]);
    expect(getCompletionMediaIds({})).toEqual([]);
  });

  it("getFollowUpInfo decodes the worker-side flag without a separate column", () => {
    const written = buildTaskCompletionMetadata(null, {
      followUpRequired: true,
      followUpNote: "More tile.",
    });
    // Manager surface reads the same Task row back via getCompletionMediaIds /
    // getFollowUpInfo and resolves the linked media via the existing
    // attachment_media_ids fetch path; nothing here requires a new query.
    expect(getFollowUpInfo({ metadata: written })).toEqual({
      required: true,
      note: "More tile.",
    });
  });
});
