import type { MediaType } from "@/types/database";

export type MaterialOrderGroupingItem = {
  id: string;
  authorName: string;
  createdAt: string;
  priority: unknown;
  metadata: Record<string, unknown>;
};

export type GroupedMaterialOrder<TItem extends MaterialOrderGroupingItem> = {
  id: string;
  orderId: string | null;
  authorName: string;
  createdAt: string;
  priority: TItem["priority"];
  note: string;
  items: TItem[];
};

export type GroupedMaterialOrderWithLink<
  TItem extends MaterialOrderGroupingItem,
  TLink,
> = GroupedMaterialOrder<TItem> & {
  link: TLink | null;
};

export type MaterialMediaGroupingItem = {
  id: string;
  filename: string | null;
  mime_type: string | null;
  media_type: MediaType | string;
  storage_path: string;
  metadata?: Record<string, unknown> | null;
};

export type MaterialMediaAttachmentRef = {
  id: string;
  filename: string | null;
  mime_type: string | null;
  media_type: string;
  storage_path: string;
};

type LinkOptions<TItem extends MaterialOrderGroupingItem, TLink> = {
  getLink: (item: TItem) => TLink | null;
};

type WorkingMaterialOrderGroup<TItem extends MaterialOrderGroupingItem, TLink> =
  GroupedMaterialOrder<TItem> & {
    link?: TLink | null;
  };

export function groupMaterialOrderItems<TItem extends MaterialOrderGroupingItem>(
  items: readonly TItem[],
): GroupedMaterialOrder<TItem>[];
export function groupMaterialOrderItems<
  TItem extends MaterialOrderGroupingItem,
  TLink,
>(
  items: readonly TItem[],
  options: LinkOptions<TItem, TLink>,
): GroupedMaterialOrderWithLink<TItem, TLink>[];
export function groupMaterialOrderItems<
  TItem extends MaterialOrderGroupingItem,
  TLink,
>(
  items: readonly TItem[],
  options?: LinkOptions<TItem, TLink>,
) {
  const grouped = new Map<string, WorkingMaterialOrderGroup<TItem, TLink>>();
  for (const item of items) {
    const orderId = typeof item.metadata.order_id === "string" ? item.metadata.order_id : null;
    const groupKey = orderId ?? `legacy-${item.id}`;
    const note = typeof item.metadata.order_note === "string" ? item.metadata.order_note : "";
    const link = options?.getLink(item) ?? null;
    const current = grouped.get(groupKey);
    if (current) {
      current.items.push(item);
      if (options && !current.link && link) current.link = link;
      if (new Date(item.createdAt).getTime() < new Date(current.createdAt).getTime()) {
        current.createdAt = item.createdAt;
      }
    } else {
      grouped.set(groupKey, {
        id: groupKey,
        orderId,
        authorName: item.authorName,
        createdAt: item.createdAt,
        priority: item.priority,
        note,
        ...(options ? { link } : {}),
        items: [item],
      });
    }
  }

  return [...grouped.values()]
    .map((group) => ({
      ...group,
      items: [...group.items].sort(
        (left, right) =>
          new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
      ),
    }))
    .sort(
      (left, right) =>
        new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
    );
}

export function isProjectMaterialMedia(item: MaterialMediaGroupingItem): boolean {
  return item.metadata?.kind === "project_media";
}

export function isReceiptMaterialMedia(item: MaterialMediaGroupingItem): boolean {
  return item.metadata?.kind === "receipt" || item.metadata?.category === "receipt";
}

export function isReceiptCategoryMetadata(metadata: Record<string, unknown>): boolean {
  return metadata.category === "receipt";
}

export function splitProjectMaterialMedia<TItem extends MaterialMediaGroupingItem>(
  items: readonly TItem[],
  options: {
    receiptFilter?: (item: TItem) => boolean;
  } = {},
) {
  const projectMedia: TItem[] = [];
  const receipts: TItem[] = [];
  for (const item of items) {
    if (isProjectMaterialMedia(item)) {
      projectMedia.push(item);
    }
    if (
      isReceiptMaterialMedia(item) &&
      (!options.receiptFilter || options.receiptFilter(item))
    ) {
      receipts.push(item);
    }
  }
  return { projectMedia, receipts };
}

export function toMaterialMediaAttachmentRef(
  item: MaterialMediaGroupingItem,
): MaterialMediaAttachmentRef {
  return {
    id: item.id,
    filename: item.filename,
    mime_type: item.mime_type,
    media_type: item.media_type,
    storage_path: item.storage_path,
  };
}
