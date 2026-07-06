import { describe, expect, it } from "vitest";
import {
  inferMessagePriority,
  mapMessageAttachment,
  mapMessageHistoryRow,
  mapMessageRowToAppMessage,
  type MessageDisplayRow,
} from "@/lib/message-mapping";

const baseRow: MessageDisplayRow = {
  id: "message-1",
  sender_id: "sender-1",
  recipient_id: "recipient-1",
  text: "Bring the plans",
  color: "#f59e0b",
  priority: "info",
  read: false,
  attachment: null,
  metadata: null,
  created_at: "2026-07-06T12:00:00Z",
};

describe("message mapping", () => {
  it("infers priority from column, metadata, legacy color, then info fallback", () => {
    expect(inferMessagePriority({ priority: "urgent", color: "#22c55e" })).toBe("urgent");
    expect(inferMessagePriority({ priority: null, metadata: { priority: "task" } })).toBe("task");
    expect(inferMessagePriority({ color: "#22c55e" })).toBe("good");
    expect(inferMessagePriority({ color: "#3b82f6" })).toBe("task");
    expect(inferMessagePriority({ color: "#ffffff", metadata: { priority: "other" } })).toBe("info");
  });

  it("maps notification rows with blank sender names and undefined empty attachments", () => {
    const message = mapMessageRowToAppMessage({
      ...baseRow,
      priority: null,
      metadata: { priority: "good", source: "manager" },
      attachment: null,
    });

    expect(message).toEqual({
      id: "message-1",
      from_id: "sender-1",
      from_name: "",
      to_id: "recipient-1",
      text: "Bring the plans",
      color: "#f59e0b",
      priority: "good",
      read: false,
      created_at: "2026-07-06T12:00:00Z",
      metadata: { priority: "good", source: "manager" },
      attachment: undefined,
    });
  });

  it("preserves worker history display rules for names, fallback color, and null empty attachments", () => {
    const message = mapMessageRowToAppMessage(
      {
        ...baseRow,
        color: null,
        priority: null,
        metadata: { priority: "task" },
        attachment: null,
      },
      {
        colorFallback: true,
        emptyAttachment: "null",
        fromName: () => "You -> Bob",
      },
    );

    expect(message.from_name).toBe("You -> Bob");
    expect(message.color).toBe("#3b82f6");
    expect(message.priority).toBe("task");
    expect(message.attachment).toBeNull();
  });

  it("normalizes attachment fields in the modes used by notification and history displays", () => {
    const attachment = {
      url: 123,
      storagePath: "messages/file.pdf",
      filename: "file.pdf",
      type: undefined,
      mimeType: 456,
      size: "42",
    };

    expect(mapMessageAttachment(attachment, "string")).toEqual({
      url: "123",
      storagePath: "messages/file.pdf",
      filename: "file.pdf",
      type: "image",
      mimeType: "456",
      size: 42,
    });
    expect(mapMessageAttachment(attachment, "cast")).toEqual({
      url: 123,
      storagePath: "messages/file.pdf",
      filename: "file.pdf",
      type: "image",
      mimeType: 456,
      size: 42,
    });
  });

  it("preserves manager alert rows without metadata or displayed attachments", () => {
    const message = mapMessageRowToAppMessage(
      {
        ...baseRow,
        attachment: {
          url: "signed-url",
          filename: "photo.jpg",
          type: "image",
        },
        metadata: { priority: "urgent" },
      },
      {
        attachment: "none",
        includeMetadata: false,
      },
    );

    expect(message.priority).toBe("info");
    expect(message.attachment).toBeUndefined();
    expect("metadata" in message).toBe(false);
  });

  it("maps broadcast history rows to the compact history shape", () => {
    expect(
      mapMessageHistoryRow({
        id: "message-2",
        recipient_id: "worker-2",
        text: "Check gate",
        priority: null,
        color: "#ef4444",
        read: true,
        created_at: "2026-07-06T13:00:00Z",
      }),
    ).toEqual({
      id: "message-2",
      recipient_id: "worker-2",
      text: "Check gate",
      priority: "urgent",
      read: true,
      created_at: "2026-07-06T13:00:00Z",
    });
  });
});
