import { describe, expect, it } from "vitest";
import {
  collectTaskReferencedMediaIds,
  mergeMediaWithTaskReferences,
} from "@/lib/task-media-hydration";

describe("collectTaskReferencedMediaIds", () => {
  it("collects manager attachments and worker completion media ids", () => {
    const ids = collectTaskReferencedMediaIds([
      {
        metadata: {
          attachment_media_ids: ["attachment-1"],
          completion_media_ids: ["completion-1", "completion-2"],
        },
      },
      {
        metadata: {
          attachment_media_ids: ["attachment-1"],
          completion_media_ids: ["completion-2", "completion-3"],
        },
      },
    ]);

    expect(ids).toEqual([
      "attachment-1",
      "completion-1",
      "completion-2",
      "completion-3",
    ]);
  });
});

describe("mergeMediaWithTaskReferences", () => {
  it("adds older completion media references to the project detail media payload", () => {
    const recentProjectMedia = [{ id: "recent" }];
    const allKnownMedia = [
      { id: "recent" },
      { id: "old-completion" },
      { id: "unused" },
    ];

    const merged = mergeMediaWithTaskReferences(
      recentProjectMedia,
      allKnownMedia,
      ["old-completion"],
    );

    expect(merged.map((item) => item.id)).toEqual(["recent", "old-completion"]);
  });
});
