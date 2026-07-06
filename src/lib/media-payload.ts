import type { MediaType } from "@/types/database";

export type MediaInsertPayload = {
  org_id: string;
  project_id: string | null;
  uploaded_by: string;
  media_type: MediaType | string;
  storage_path: string;
  filename: string;
  file_size: number;
  mime_type: string;
  caption: string | null;
  is_checkout: boolean;
  time_event_id: string | null;
  metadata: Record<string, unknown>;
};

export type BuildMediaInsertPayloadInput = {
  orgId: string;
  projectId: string | null;
  uploadedBy: string;
  mediaType: MediaType | string;
  storagePath: string;
  filename: string;
  fileSize: number;
  mimeType: string;
  caption?: string | null;
  isCheckout?: boolean;
  timeEventId?: string | null;
  metadata: Record<string, unknown>;
};

export function buildMediaInsertPayload({
  orgId,
  projectId,
  uploadedBy,
  mediaType,
  storagePath,
  filename,
  fileSize,
  mimeType,
  caption = null,
  isCheckout = false,
  timeEventId = null,
  metadata,
}: BuildMediaInsertPayloadInput): MediaInsertPayload {
  return {
    org_id: orgId,
    project_id: projectId,
    uploaded_by: uploadedBy,
    media_type: mediaType,
    storage_path: storagePath,
    filename,
    file_size: fileSize,
    mime_type: mimeType,
    caption,
    is_checkout: isCheckout,
    time_event_id: timeEventId,
    metadata,
  };
}

export function buildProjectMediaMetadata(source?: string): Record<string, unknown> {
  return {
    kind: "project_media",
    ...(source ? { source } : {}),
  };
}

export function buildReceiptMediaMetadata({
  storeName,
  amount,
  purchaseDate,
  uploaderName,
}: {
  storeName: string | null;
  amount: number;
  purchaseDate: string;
  uploaderName: string;
}): Record<string, unknown> {
  return {
    kind: "receipt",
    category: "receipt",
    store_name: storeName,
    amount,
    purchase_date: purchaseDate,
    uploader_name: uploaderName,
  };
}
