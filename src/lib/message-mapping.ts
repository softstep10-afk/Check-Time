import {
  PRIORITY_COLOR,
  type AppMessage,
  type MessageAttachment,
  type MessageColor,
  type MessagePriority,
} from "@/lib/message-types";

export type MessageDisplayRow = {
  id: string;
  sender_id: string;
  recipient_id: string;
  text: string;
  color?: string | null;
  priority?: string | null;
  read: boolean;
  attachment?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
};

export type MessageHistoryRow = {
  id: string;
  recipient_id: string;
  text: string;
  priority?: string | null;
  color?: string | null;
  metadata?: Record<string, unknown> | null;
  read: boolean;
  created_at: string;
};

export type MappedMessageHistoryRow = {
  id: string;
  recipient_id: string;
  text: string;
  priority: MessagePriority;
  read: boolean;
  created_at: string;
};

type AttachmentStringMode = "cast" | "string";

type MapMessageRowOptions = {
  fromName?: string | ((row: MessageDisplayRow) => string);
  colorFallback?: boolean;
  includeMetadata?: boolean;
  attachment?: "map" | "none";
  emptyAttachment?: "undefined" | "null";
  attachmentStringMode?: AttachmentStringMode;
};

function isMessagePriority(value: unknown): value is MessagePriority {
  return value === "urgent" || value === "info" || value === "good" || value === "task";
}

export function inferMessagePriority(row: {
  priority?: string | null;
  color?: string | null;
  metadata?: Record<string, unknown> | null;
}): MessagePriority {
  if (isMessagePriority(row.priority)) return row.priority;
  const fromMeta = row.metadata?.priority;
  if (isMessagePriority(fromMeta)) return fromMeta;
  if (row.color === "#ef4444") return "urgent";
  if (row.color === "#22c55e") return "good";
  if (row.color === "#3b82f6") return "task";
  return "info";
}

export function mapMessageAttachment(
  attachment: Record<string, unknown>,
  mode: AttachmentStringMode = "cast",
): MessageAttachment {
  if (mode === "string") {
    return {
      url: String(attachment.url ?? ""),
      storagePath: String(attachment.storagePath ?? ""),
      filename: String(attachment.filename ?? ""),
      type: String(attachment.type ?? "image") as MessageAttachment["type"],
      mimeType: attachment.mimeType ? String(attachment.mimeType) : undefined,
      size: Number(attachment.size ?? 0),
    };
  }

  const castAttachment = attachment as Record<string, string | number | undefined>;
  return {
    url: (castAttachment.url as string | undefined) ?? "",
    storagePath: (castAttachment.storagePath as string | undefined) ?? "",
    filename: (castAttachment.filename as string | undefined) ?? "",
    type: ((castAttachment.type as string | undefined) ?? "image") as MessageAttachment["type"],
    mimeType: (castAttachment.mimeType as string | undefined) ?? undefined,
    size: Number(castAttachment.size ?? 0),
  };
}

export function mapMessageRowToAppMessage(
  row: MessageDisplayRow,
  options: MapMessageRowOptions = {},
): AppMessage {
  const priority = inferMessagePriority(row);
  const message: AppMessage = {
    id: row.id,
    from_id: row.sender_id,
    from_name: typeof options.fromName === "function"
      ? options.fromName(row)
      : options.fromName ?? "",
    to_id: row.recipient_id,
    text: row.text,
    color: (options.colorFallback ? row.color ?? PRIORITY_COLOR[priority] : row.color) as MessageColor,
    priority,
    read: row.read,
    created_at: row.created_at,
  };

  if (options.includeMetadata !== false) {
    message.metadata = row.metadata ?? null;
  }

  if (options.attachment === "none") {
    message.attachment = undefined;
    return message;
  }

  message.attachment = row.attachment
    ? mapMessageAttachment(row.attachment, options.attachmentStringMode)
    : options.emptyAttachment === "null"
      ? null
      : undefined;

  return message;
}

export function mapMessageHistoryRow(row: MessageHistoryRow): MappedMessageHistoryRow {
  return {
    id: row.id,
    recipient_id: row.recipient_id,
    text: row.text,
    priority: inferMessagePriority(row),
    read: row.read,
    created_at: row.created_at,
  };
}
