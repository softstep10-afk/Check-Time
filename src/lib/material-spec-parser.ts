export type MaterialSpecItem = {
  name: string;
  quantity: string | null;
  unit: string | null;
  notes: string | null;
};

export type MaterialSpecParseResult = {
  items: MaterialSpecItem[];
  hasHeader: boolean;
};

type MaterialSpecField = keyof MaterialSpecItem;

const FIELD_ALIASES: Record<MaterialSpecField, Set<string>> = {
  name: new Set([
    "name",
    "material",
    "item",
    "position",
    "product",
    "название",
    "наименование",
    "материал",
    "позиция",
    "товар",
    "продукт",
  ]),
  quantity: new Set(["quantity", "qty", "count", "amount", "колво", "количество", "кво"]),
  unit: new Set(["unit", "uom", "ед", "единица", "едизм"]),
  notes: new Set(["notes", "note", "comment", "comments", "description", "примечание", "заметка", "комментарий", "описание"]),
};

function cleanCell(value: string): string {
  return value.trim().replace(/^"(.*)"$/, "$1").trim();
}

function normalizeHeader(value: string): string {
  return cleanCell(value)
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/g, "");
}

function splitDelimitedLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && next === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === delimiter && !inQuotes) {
      cells.push(cleanCell(current));
      current = "";
      continue;
    }
    current += char;
  }

  cells.push(cleanCell(current));
  return cells;
}

function splitSpecLine(line: string): string[] {
  if (line.includes("\t")) return line.split("\t").map(cleanCell);
  if (line.includes(";")) return splitDelimitedLine(line, ";");
  if (line.includes("|")) return splitDelimitedLine(line, "|");
  return splitDelimitedLine(line, ",");
}

function detectHeader(columns: string[]): Partial<Record<MaterialSpecField, number>> | null {
  const header: Partial<Record<MaterialSpecField, number>> = {};
  for (const [index, column] of columns.entries()) {
    const normalized = normalizeHeader(column);
    for (const field of Object.keys(FIELD_ALIASES) as MaterialSpecField[]) {
      if (FIELD_ALIASES[field].has(normalized) && header[field] === undefined) {
        header[field] = index;
      }
    }
  }

  return Object.keys(header).length > 0 ? header : null;
}

function readColumn(
  columns: string[],
  header: Partial<Record<MaterialSpecField, number>> | null,
  field: MaterialSpecField,
  fallbackIndex: number,
): string | null {
  const index = header?.[field] ?? fallbackIndex;
  const value = columns[index];
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
}

export function parseMaterialSpecPaste(text: string): MaterialSpecParseResult {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return { items: [], hasHeader: false };
  }

  const firstColumns = splitSpecLine(lines[0] ?? "");
  const header = detectHeader(firstColumns);
  const items: MaterialSpecItem[] = [];

  for (const line of header ? lines.slice(1) : lines) {
    const columns = splitSpecLine(line);
    const name = readColumn(columns, header, "name", 0);
    if (!name) continue;

    items.push({
      name,
      quantity: readColumn(columns, header, "quantity", 1),
      unit: readColumn(columns, header, "unit", 2),
      notes: readColumn(columns, header, "notes", 3),
    });
  }

  return { items: items.slice(0, 250), hasHeader: Boolean(header) };
}
