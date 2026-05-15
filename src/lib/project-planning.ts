export const PROJECT_MATERIAL_SPEC_KEY = "material_spec_items";
export const PROJECT_ESTIMATES_KEY = "project_estimations";

export type ProjectMaterialSpecItem = {
  id: string;
  name: string;
  quantity: string;
  unit: string;
  supplier: string;
  link: string;
  note: string;
  category: string;
  createdAt: string;
  updatedAt: string;
};

export type ProjectEstimateStatus = "draft" | "sent" | "approved" | "rejected" | "done";

export type ProjectEstimateWorkItem = {
  id: string;
  title: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  materialCost: number;
  laborHours: number;
  internalCost: number;
  totalPrice: number;
};

export type ProjectEstimate = {
  id: string;
  title: string;
  status: ProjectEstimateStatus;
  description: string;
  clientPrice: number;
  materialCost: number;
  laborHours: number;
  internalCost: number;
  createdAt: string;
  updatedAt: string;
  items: ProjectEstimateWorkItem[];
};

type SettingsRecord = Record<string, unknown>;

function isRecord(value: unknown): value is SettingsRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  const parsed =
    typeof value === "number" ? value : Number.parseFloat(asString(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asStatus(value: unknown): ProjectEstimateStatus {
  const text = asString(value).toLowerCase();
  if (text === "sent" || text === "approved" || text === "rejected" || text === "done") {
    return text;
  }
  return "draft";
}

function nowIso(): string {
  return new Date().toISOString();
}

export function createProjectPlanningId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export function normalizeMaterialSpecItems(value: unknown): ProjectMaterialSpecItem[] {
  if (!Array.isArray(value)) return [];
  const stamp = nowIso();
  return value
    .map((item) => {
      if (!isRecord(item)) return null;
      const name = asString(item.name || item.title || item.material);
      if (!name) return null;
      const createdAt = asString(item.createdAt || item.created_at, stamp);
      return {
        id: asString(item.id, createProjectPlanningId("mat")),
        name,
        quantity: asString(item.quantity || item.qty),
        unit: asString(item.unit),
        supplier: asString(item.supplier || item.vendor || item.store),
        link: asString(item.link || item.url || item.href),
        note: asString(item.note || item.notes || item.description),
        category: asString(item.category),
        createdAt,
        updatedAt: asString(item.updatedAt || item.updated_at, stamp),
      };
    })
    .filter((item): item is ProjectMaterialSpecItem => Boolean(item))
    .slice(0, 250);
}

export function normalizeProjectEstimations(value: unknown): ProjectEstimate[] {
  if (!Array.isArray(value)) return [];
  const stamp = nowIso();
  return value
    .map((estimate) => {
      if (!isRecord(estimate)) return null;
      const title = asString(estimate.title || estimate.name);
      if (!title) return null;
      const items = Array.isArray(estimate.items)
        ? estimate.items
            .map((rawItem) => {
              if (!isRecord(rawItem)) return null;
              const itemTitle = asString(rawItem.title || rawItem.name || rawItem.work);
              if (!itemTitle) return null;
              const quantity = asNumber(rawItem.quantity, 1);
              const unitPrice = asNumber(rawItem.unitPrice || rawItem.unit_price);
              const totalPrice = asNumber(rawItem.totalPrice || rawItem.total_price, quantity * unitPrice);
              return {
                id: asString(rawItem.id, createProjectPlanningId("work")),
                title: itemTitle,
                description: asString(rawItem.description || rawItem.note),
                quantity,
                unit: asString(rawItem.unit, "item"),
                unitPrice,
                materialCost: asNumber(rawItem.materialCost || rawItem.material_cost),
                laborHours: asNumber(rawItem.laborHours || rawItem.labor_hours),
                internalCost: asNumber(rawItem.internalCost || rawItem.internal_cost),
                totalPrice,
              };
            })
            .filter((item): item is ProjectEstimateWorkItem => Boolean(item))
            .slice(0, 120)
        : [];
      const clientPriceFromItems = items.reduce((sum, item) => sum + item.totalPrice, 0);
      const internalCostFromItems = items.reduce(
        (sum, item) => sum + item.internalCost + item.materialCost,
        0,
      );
      return {
        id: asString(estimate.id, createProjectPlanningId("est")),
        title,
        status: asStatus(estimate.status),
        description: asString(estimate.description || estimate.note || estimate.scope),
        clientPrice: asNumber(estimate.clientPrice || estimate.client_price, clientPriceFromItems),
        materialCost: asNumber(estimate.materialCost || estimate.material_cost),
        laborHours: asNumber(estimate.laborHours || estimate.labor_hours),
        internalCost: asNumber(estimate.internalCost || estimate.internal_cost, internalCostFromItems),
        createdAt: asString(estimate.createdAt || estimate.created_at, stamp),
        updatedAt: asString(estimate.updatedAt || estimate.updated_at, stamp),
        items,
      };
    })
    .filter((estimate): estimate is ProjectEstimate => Boolean(estimate))
    .slice(0, 80);
}

export function readProjectMaterialSpec(settings: unknown): ProjectMaterialSpecItem[] {
  if (!isRecord(settings)) return [];
  return normalizeMaterialSpecItems(settings[PROJECT_MATERIAL_SPEC_KEY]);
}

export function readProjectEstimations(settings: unknown): ProjectEstimate[] {
  if (!isRecord(settings)) return [];
  return normalizeProjectEstimations(settings[PROJECT_ESTIMATES_KEY]);
}

export function mergeProjectPlanningSettings(
  settings: unknown,
  changes: {
    materialSpecItems?: ProjectMaterialSpecItem[];
    estimations?: ProjectEstimate[];
  },
): SettingsRecord {
  const next: SettingsRecord = isRecord(settings) ? { ...settings } : {};
  if (changes.materialSpecItems) {
    next[PROJECT_MATERIAL_SPEC_KEY] = normalizeMaterialSpecItems(changes.materialSpecItems);
  }
  if (changes.estimations) {
    next[PROJECT_ESTIMATES_KEY] = normalizeProjectEstimations(changes.estimations);
  }
  return next;
}

function splitMaterialLine(line: string): string[] {
  if (line.includes("\t")) return line.split("\t");
  if (line.includes("|")) return line.split("|");
  if (line.includes(";")) return line.split(";");
  return line.split(",");
}

function looksLikeHeader(columns: string[]): boolean {
  const first = (columns[0] ?? "").trim().toLowerCase();
  return ["name", "material", "материал", "название"].includes(first);
}

function extractUrl(text: string): string {
  return text.match(/https?:\/\/\S+|www\.\S+/i)?.[0] ?? "";
}

export function parseMaterialSpecText(text: string): ProjectMaterialSpecItem[] {
  const stamp = nowIso();
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => splitMaterialLine(line).map((part) => part.trim()))
    .filter((columns) => !looksLikeHeader(columns))
    .map((columns) => {
      const rowText = columns.join(" ");
      const link = columns[4] || extractUrl(rowText);
      const name = columns[0] ?? "";
      if (!name) return null;
      return {
        id: createProjectPlanningId("mat"),
        name,
        quantity: columns[1] ?? "",
        unit: columns[2] ?? "",
        supplier: columns[3] ?? "",
        link: link.startsWith("www.") ? `https://${link}` : link,
        note: columns.slice(5).join(" "),
        category: "",
        createdAt: stamp,
        updatedAt: stamp,
      };
    })
    .filter((item): item is ProjectMaterialSpecItem => Boolean(item))
    .slice(0, 250);
}

export function estimateMargin(estimate: ProjectEstimate): number {
  return estimate.clientPrice - estimate.internalCost - estimate.materialCost;
}
