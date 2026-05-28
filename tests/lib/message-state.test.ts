import { describe, expect, it } from "vitest";
import {
  buildPrivateMessageParticipantFilter,
  buildMessageTaskMetadata,
  isTaskMessagePriority,
  isPrivateMessageVisibleToProfile,
  markMessagesReadById,
  mergeMessagesById,
  readLinkedTaskId,
  sortMessagesForStableNotificationList,
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

  it("keeps private messages visible to sender and recipient only", () => {
    const message = { sender_id: "sender-1", recipient_id: "recipient-1" };

    expect(isPrivateMessageVisibleToProfile(message, "sender-1")).toBe(true);
    expect(isPrivateMessageVisibleToProfile(message, "recipient-1")).toBe(true);
    expect(isPrivateMessageVisibleToProfile(message, "other-1")).toBe(false);
  });

  it("builds a sender-or-recipient history filter for direct message history", () => {
    expect(buildPrivateMessageParticipantFilter("profile-1")).toBe(
      "sender_id.eq.profile-1,recipient_id.eq.profile-1",
    );
  });

  it("keeps read private messages in the notification list after acknowledgement", () => {
    const acknowledged = markMessagesReadById(baseMessages, ["message-2"]);
    const sorted = sortMessagesForStableNotificationList(acknowledged);

    expect(sorted.map((message) => message.id)).toEqual(["message-1", "message-2"]);
    expect(sorted.find((message) => message.id === "message-2")?.read).toBe(true);
  });

  it("keeps sender and recipient history stable after realtime read updates", () => {
    const sent = {
      id: "direct-1",
      sender_id: "sender-1",
      recipient_id: "recipient-1",
      created_at: "2026-05-21T10:00:00Z",
      read: false,
      text: "Private note",
    };
    const updated = mergeMessagesById([sent], { ...sent, read: true });

    expect(updated).toHaveLength(1);
    expect(isPrivateMessageVisibleToProfile(updated[0], "sender-1")).toBe(true);
    expect(isPrivateMessageVisibleToProfile(updated[0], "recipient-1")).toBe(true);
    expect(updated[0].read).toBe(true);
  });
});
