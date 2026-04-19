export type MessageColor = "#22c55e" | "#3b82f6" | "#f59e0b" | "#ef4444" | "#a855f7";

export interface MessageAttachment {
  url: string;
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
  read: boolean;
  created_at: string;
  attachment?: MessageAttachment | null;
}
