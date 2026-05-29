function requireStoragePathSegment(value: string | undefined, label: string): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    throw new Error(`${label} is required for message attachment storage path.`);
  }
  if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("..")) {
    throw new Error(`${label} is not a safe storage path segment.`);
  }
  return trimmed;
}

export function sanitizeMessageAttachmentFilename(filename: string): string {
  const lastSegment = filename.trim().split(/[\\/]/).filter(Boolean).pop() ?? "";
  const safeName = lastSegment
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^-+|-+$/g, "")
    .replace(/^\.+|\.+$/g, "");
  return safeName || "message-attachment";
}

export function buildMessageAttachmentStoragePath(
  orgId: string | undefined,
  recipientId: string | undefined,
  filename: string,
): string {
  const orgSegment = requireStoragePathSegment(orgId, "orgId");
  const recipientSegment = requireStoragePathSegment(recipientId, "recipientId");
  const safeFilename = sanitizeMessageAttachmentFilename(filename);
  return `${orgSegment}/messages/${recipientSegment}/${Date.now()}-${safeFilename}`;
}
