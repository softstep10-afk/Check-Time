import { describe, expect, it } from "vitest";
import {
  buildMessageTaskMetadata,
  isTaskMessagePriority,
  markMessagesReadById,
  mergeMessagesById,
  readLinkedTaskId,
} from "@/lib/message-state";

const baseMessages = [
  {
    id: "message-1",
    created_at: "2026-05-21T10:00:00Z",
    read: false,
    text: "First",
  },
  {
    id: "message-2",
    created_at: "2026-05-21T10:05:00Z",
    read: false,
    text: "Second",
  },
];

describe("message state helpers", () => {
  it("marks a message read without removing it from history", () => {
    const next = markMessagesReadById(baseMessages, ["message-1"]);

    expect(next).toHaveLength(2);
    expect(next.map((message) => message.id)).toEqual(["message-1", "message-2"]);
    expect(next.find((message) => message.id === "message-1")?.read).toBe(true);
    expect(next.find((message) => message.id === "message-2")?.read).toBe(false);
  });

  it("dedupes duplicate realtime INSERT events by id", () => {
    const next = mergeMessagesById(baseMessages, {
      id: "message-2",
      created_at: "2026-05-21T10:05:00Z",
      read: false,
      text: "Second duplicate",
    });

    expect(next).toHaveLength(2);
    expect(next.find((message) => message.id === "message-2")?.text).toBe("Second duplicate");
  });

  it("merges UPDATE events into an existing message without dropping other messages", () => {
    const next = mergeMessagesById(baseMessages, {
      id: "message-1",
      created_at: "2026-05-21T10:00:00Z",
      read: true,
      text: "First",
    });

    expect(next).toHaveLength(2);
    expect(next.find((message) => message.id === "message-1")?.read).toBe(true);
    expect(next.find((message) => message.id === "message-2")?.read).toBe(false);
  });

  it("creates a task only for the explicit task priority", () => {
    expect(isTaskMessagePriority("task")).toBe(true);
    expect(isTaskMessagePriority("urgent")).toBe(false);
    expect(isTaskMessagePriority("info")).toBe(false);
    expect(isTaskMessagePriority("good")).toBe(false);
    expect(isTaskMessagePriority(undefined)).toBe(false);
  });

  it("preserves message metadata while linking the explicit task", () => {
    const linked = buildMessageTaskMetadata(
      { priority: "task", broadcast: true },
      "task-1",
      "2026-05-21T10:10:00Z",
    );

    expect(linked).toEqual({
      priority: "task",
      broadcast: true,
      task_id: "task-1",
      task_created_at: "2026-05-21T10:10:00Z",
    });
    expect(readLinkedTaskId(linked)).toBe("task-1");
  });
});
