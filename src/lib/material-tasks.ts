import { isEffectiveOpenTask } from "@/lib/task-status";

export type MaterialTaskUrgency = "urgent" | "normal";

export interface MaterialTaskLike {
  id?: string;
  title?: string | null;
  priority?: string | null;
  status?: string | null;
  assigned_to?: string | null;
  project_id?: string | null;
  due_date?: string | null;
  completed_at?: string | null;
  deleted_at?: string | null;
  metadata?: unknown;
}

export interface MaterialTaskItem {
  name: string;
  quantity?: string | number | null;
  unit?: string | null;
  notes?: string | null;
}

export interface MaterialTaskMetadataInput {
  base?: Record<string, unknown> | null;
  materialName: string;
  materialNotes?: string | null;
  urgency: MaterialTaskUrgency;
  neededDate?: string | null;
  requestedBy?: string | null;
  driverUserId?: string | null;
  projectId?: string | null;
  quantity?: string | number | null;
  unit?: string | null;
  orderId?: string | null;
  orderNote?: string | null;
  orderLink?: string | null;
  orderSize?: number | null;
  materialItems?: MaterialTaskItem[] | null;
}

export interface MaterialIndicatorState {
  hasOpenMaterialRequest: boolean;
  openCount: number;
  urgentCount: number;
  assignedCount: number;
  seenCount: number;
  allAssignedOpenSeen: boolean;
  primaryLabel: "urgent" | "seen" | "assigned" | "needed" | null;
}

function readMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function normalizeMaterialTaskLink(value: unknown): string | null {
  const raw = readString(value);
  if (!raw) return null;
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withProtocol);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function readStringOrNumber(value: unknown): string | number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return readString(value);
}

function normalizeDate(value: unknown): string | null {
  const raw = readString(value);
  if (!raw) return null;
  return raw.slice(0, 10);
}

export function normalizeMaterialTaskUrgency(value: unknown): MaterialTaskUrgency {
  const raw = readString(value)?.toLowerCase();
  if (raw === "urgent" || raw === "high" || raw === "срочно") return "urgent";
  return "normal";
}

export function isMaterialTask(task: MaterialTaskLike | null | undefined): boolean {
  if (!task) return false;
  const metadata = readMetadata(task.metadata);
  return (
    metadata.materialRequest === true ||
    metadata.taskKind === "material" ||
    metadata.category === "material" ||
    metadata.schedule_scope === "material"
  );
}

export function isOpenMaterialTask(task: MaterialTaskLike | null | undefined): boolean {
  return Boolean(task && isMaterialTask(task) && isEffectiveOpenTask(task));
}

export function getMaterialTaskUrgency(task: MaterialTaskLike): MaterialTaskUrgency {
  const metadata = readMetadata(task.metadata);
  const metadataUrgency = normalizeMaterialTaskUrgency(metadata.urgency);
  if (metadataUrgency === "urgent") return "urgent";
  return normalizeMaterialTaskUrgency(task.priority);
}

export function getMaterialTaskNeededDate(task: MaterialTaskLike): string | null {
  const metadata = readMetadata(task.metadata);
  return (
    normalizeDate(metadata.neededDate) ??
    normalizeDate(metadata.needed_date) ??
    normalizeDate(metadata.materialNeededDate) ??
    normalizeDate(task.due_date)
  );
}

export function getMaterialTaskDriverId(task: MaterialTaskLike): string | null {
  const metadata = readMetadata(task.metadata);
  return (
    readString(metadata.driverUserId) ??
    readString(metadata.driver_user_id) ??
    readString(task.assigned_to)
  );
}

export function getMaterialTaskMaterialName(task: MaterialTaskLike): string | null {
  const metadata = readMetadata(task.metadata);
  return (
    readString(metadata.materialName) ??
    readString(metadata.material_name) ??
    readString(metadata.material) ??
    readString(task.title)
  );
}

export function getMaterialTaskItems(task: MaterialTaskLike): MaterialTaskItem[] {
  const metadata = readMetadata(task.metadata);
  if (!Array.isArray(metadata.materialItems)) return [];
  return normalizeMaterialTaskItems(metadata.materialItems);
}

export function getMaterialTaskLinks(task: MaterialTaskLike): string[] {
  const metadata = readMetadata(task.metadata);
  const links = new Set<string>();
  const maybeLinks = metadata.materialLinks;
  if (Array.isArray(maybeLinks)) {
    for (const value of maybeLinks) {
      const link = normalizeMaterialTaskLink(value);
      if (link) links.add(link);
    }
  }
  const orderLink = normalizeMaterialTaskLink(metadata.order_link ?? metadata.orderLink);
  if (orderLink) links.add(orderLink);
  return Array.from(links);
}

export function hasDriverSeenMaterialTask(task: MaterialTaskLike): boolean {
  const driverId = getMaterialTaskDriverId(task);
  if (!driverId) return false;
  const metadata = readMetadata(task.metadata);
  const seenBy = metadata.seen_by;
  if (seenBy && typeof seenBy === "object" && !Array.isArray(seenBy)) {
    const seenAt = (seenBy as Record<string, unknown>)[driverId];
    if (typeof seenAt === "string" && seenAt.trim().length > 0) return true;
  }
  return metadata.last_seen_by === driverId || metadata.seen_by_driver === true;
}

export function getMaterialTaskScheduleDate(task: MaterialTaskLike): string | null {
  return getMaterialTaskNeededDate(task);
}

export function shouldShowInDriverMaterialList(
  task: MaterialTaskLike,
  currentUser: { id: string },
): boolean {
  if (!isMaterialTask(task)) return false;
  const driverId = getMaterialTaskDriverId(task);
  return task.assigned_to === currentUser.id || driverId === currentUser.id || task.assigned_to === null;
}

export function getMaterialIndicatorState(tasks: MaterialTaskLike[]): MaterialIndicatorState {
  const openMaterialTasks = tasks.filter(isOpenMaterialTask);
  const urgentCount = openMaterialTasks.filter(
    (task) => getMaterialTaskUrgency(task) === "urgent",
  ).length;
  const assignedCount = openMaterialTasks.filter((task) => Boolean(getMaterialTaskDriverId(task))).length;
  const seenCount = openMaterialTasks.filter(hasDriverSeenMaterialTask).length;
  const hasOpenMaterialRequest = openMaterialTasks.length > 0;
  const allAssignedOpenSeen = assignedCount > 0 && seenCount >= assignedCount;
  const primaryLabel = !hasOpenMaterialRequest
    ? null
    : urgentCount > 0
      ? "urgent"
      : allAssignedOpenSeen
        ? "seen"
        : assignedCount > 0
          ? "assigned"
          : "needed";

  return {
    hasOpenMaterialRequest,
    openCount: openMaterialTasks.length,
    urgentCount,
    assignedCount,
    seenCount,
    allAssignedOpenSeen,
    primaryLabel,
  };
}

export function hasOpenMaterialRequest(tasks: MaterialTaskLike[]): boolean {
  return getMaterialIndicatorState(tasks).hasOpenMaterialRequest;
}

export function buildMaterialTaskTitle(
  projectName: string | null | undefined,
  materialName: string,
): string {
  const material = materialName.trim() || "материал";
  return projectName && projectName.trim()
    ? `${projectName.trim()}: нужен материал — ${material}`
    : `Нужен материал — ${material}`;
}

export function buildMaterialTaskNotificationText(
  task: MaterialTaskLike,
  projectName?: string | null,
): string {
  const materialName = getMaterialTaskMaterialName(task);
  const urgency = getMaterialTaskUrgency(task);
  const neededDate = getMaterialTaskNeededDate(task);
  const prefix = projectName && projectName.trim() ? `${projectName.trim()}: ` : "";
  const urgencyText = urgency === "urgent" ? "срочно нужен материал" : "нужен материал";
  const materialText = materialName ? ` — ${materialName}` : "";
  const dateText = neededDate ? `, ${neededDate}` : "";
  return `${prefix}${urgencyText}${materialText}${dateText}`;
}

export function buildMaterialTaskMetadata(input: MaterialTaskMetadataInput): Record<string, unknown> {
  const materialName = input.materialName.trim();
  const neededDate = normalizeDate(input.neededDate);
  const driverUserId = readString(input.driverUserId);
  const materialItems = normalizeMaterialTaskItems(input.materialItems);
  const orderLink = normalizeMaterialTaskLink(input.orderLink);
  return {
    ...(input.base ?? {}),
    category: "material",
    taskKind: "material",
    materialRequest: true,
    materialName,
    materialNotes: readString(input.materialNotes),
    urgency: input.urgency,
    neededDate,
    requestedBy: readString(input.requestedBy),
    driverUserId,
    projectId: readString(input.projectId),
    quantity: input.quantity ?? null,
    unit: input.unit ?? null,
    order_id: input.orderId ?? null,
    order_note: input.orderNote ?? null,
    order_link: orderLink,
    materialLinks: orderLink ? [orderLink] : null,
    order_size: input.orderSize ?? null,
    materialItems: materialItems.length > 0 ? materialItems : null,
    schedule_kind: "delivery",
    schedule_scope: "material",
    schedule_visible_to_workers: true,
    schedule_delivery_status: driverUserId ? "assigned" : "open",
    delivery_available_to: driverUserId ? null : "team",
  };
}

export function normalizeMaterialTaskItems(value: unknown): MaterialTaskItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): MaterialTaskItem | null => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const record = item as Record<string, unknown>;
      const name = readString(record.name ?? record.material ?? record.title);
      if (!name) return null;
      return {
        name,
        quantity: readStringOrNumber(record.quantity ?? record.qty),
        unit: readString(record.unit),
        notes: readString(record.notes ?? record.note ?? record.comment),
      };
    })
    .filter((item): item is MaterialTaskItem => Boolean(item))
    .slice(0, 250);
}
