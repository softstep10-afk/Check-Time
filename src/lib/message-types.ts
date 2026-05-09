export type MessageColor = "#22c55e" | "#3b82f6" | "#f59e0b" | "#ef4444" | "#a855f7";

export type MessagePriority = "urgent" | "info" | "good" | "task";

export const PRIORITY_ORDER: Record<MessagePriority, number> = {
  urgent: 0,
  info: 1,
  good: 1,
  task: 1,
};

export const PRIORITY_COLOR: Record<MessagePriority, MessageColor> = {
  urgent: "#ef4444",
  info: "#f59e0b",
  good: "#22c55e",
  task: "#3b82f6",
};

export const PRIORITY_EMOJI: Record<MessagePriority, string> = {
  urgent: "🔴",
  info: "🟡",
  good: "🟢",
  task: "🔵",
};

export interface MessageAttachment {
  url: string;
  storagePath?: string;
  filename: string;
  type: "image" | "video" | "pdf";
  size: number;
}

export interface AppMessage {
  id: string;
  from_id: string;
  from_name: string;
  to_id: string;
  text: string;
  color: MessageColor;
  priority: MessagePriority;
  read: boolean;
  created_at: string;
  attachment?: MessageAttachment | null;
}
