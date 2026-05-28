export type MaterialSpecItem = {
  name: string;
  quantity: string | null;
  unit: string | null;
  notes: string | null;
};

export type MaterialSpecParseResult = {
  items: MaterialSpecItem[];
  hasHeader: boolean;
  deduped: boolean;
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

const NUMBER_WORDS = new Map<string, string>([
  ["ноль", "0"],
  ["один", "1"],
  ["одна", "1"],
  ["одно", "1"],
  ["два", "2"],
  ["две", "2"],
  ["три", "3"],
  ["четыре", "4"],
  ["пять", "5"],
  ["шесть", "6"],
  ["семь", "7"],
  ["восемь", "8"],
  ["девять", "9"],
  ["десять", "10"],
  ["one", "1"],
  ["two", "2"],
  ["three", "3"],
  ["four", "4"],
  ["five", "5"],
  ["six", "6"],
  ["seven", "7"],
  ["eight", "8"],
  ["nine", "9"],
  ["ten", "10"],
]);

const UNIT_ALIASES = new Set([
  "лист",
  "листа",
  "листов",
  "шт",
  "штук",
  "штуки",
  "pcs",
  "pc",
  "piece",
  "pieces",
  "box",
  "boxes",
  "коробка",
  "коробки",
  "коробок",
  "roll",
  "rolls",
  "рулон",
  "рулона",
  "рулонов",
  "pack",
  "packs",
  "упаковка",
  "упаковки",
  "мешок",
  "мешка",
  "мешков",
  "bag",
  "bags",
  "л",
  "литр",
  "литра",
  "литров",
  "m",
  "м",
  "ft",
  "фут",
  "фута",
  "кг",
  "kg",
]);

const FRACTION_REPLACEMENTS: Record<string, string> = {
  "½": "1/2",
  "⅓": "1/3",
  "⅔": "2/3",
  "¼": "1/4",
  "¾": "3/4",
  "⅛": "1/8",
  "⅜": "3/8",
  "⅝": "5/8",
  "⅞": "7/8",
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

function shouldUseCommaDelimiter(line: string): boolean {
  const commaCount = (line.match(/,/g) ?? []).length;
  if (commaCount === 0) return false;
  if (commaCount >= 2) return true;
  return !/\d\s*,\s*\d/.test(line);
}

function splitSpecLine(line: string): string[] {
  if (line.includes("\t")) return line.split("\t").map(cleanCell);
  if (line.includes(";")) return splitDelimitedLine(line, ";");
  if (line.includes("|")) return splitDelimitedLine(line, "|");
  if (shouldUseCommaDelimiter(line)) return splitDelimitedLine(line, ",");
  return [cleanCell(line)];
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

function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/^[^\p{L}\p{N}/]+|[^\p{L}\p{N}/]+$/gu, "");
}

function normalizePlainMaterialText(value: string) {
  let text = value;
  for (const [from, to] of Object.entries(FRACTION_REPLACEMENTS)) {
    text = text.replaceAll(from, ` ${to} `);
  }
  text = text
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();

  const tokens = text.split(" ").filter(Boolean);
  const dedupedTokens: string[] = [];
  for (const token of tokens) {
    const normalized = normalizeToken(token);
    const previous = normalizeToken(dedupedTokens[dedupedTokens.length - 1] ?? "");
    if (normalized && normalized === previous) continue;
    dedupedTokens.push(token);
  }

  return dedupedTokens.join(" ");
}

function readQuantityToken(token: string): string | null {
  const normalized = normalizeToken(token);
  if (!normalized) return null;
  if (/^\d+(?:[,.]\d+)?$/.test(normalized)) {
    return normalized.replace(",", ".");
  }
  return NUMBER_WORDS.get(normalized) ?? null;
}

function isUnitToken(token: string): boolean {
  return UNIT_ALIASES.has(normalizeToken(token));
}

function isSpecToken(token: string): boolean {
  const normalized = normalizeToken(token);
  return (
    /^\d+\/\d+$/.test(normalized) ||
    /^\d+(?:[xх×]\d+){1,2}$/i.test(normalized) ||
    /^\d+(?:\.\d+)?["']$/.test(token.trim())
  );
}

function trimRepeatedTail(tokens: string[], nameTokens: string[]): string[] {
  if (tokens.length === 0 || nameTokens.length === 0) return tokens;
  const firstNameToken = normalizeToken(nameTokens[0] ?? "");
  if (!firstNameToken) return tokens;
  const repeatedNameIndex = tokens.findIndex(
    (token, index) => index > 0 && normalizeToken(token) === firstNameToken,
  );
  return repeatedNameIndex > 0 ? tokens.slice(0, repeatedNameIndex) : tokens;
}

function parsePlainMaterialLine(line: string): { item: MaterialSpecItem | null; deduped: boolean } {
  const normalizedLine = normalizePlainMaterialText(line);
  const tokens = normalizedLine.split(" ").filter(Boolean);
  if (tokens.length === 0) return { item: null, deduped: normalizedLine !== line.trim() };

  const quantityIndex = tokens.findIndex((token) => readQuantityToken(token) !== null);
  if (quantityIndex === -1) {
    return {
      item: {
        name: normalizedLine,
        quantity: null,
        unit: null,
        notes: normalizedLine !== line.trim() ? line.trim() : null,
      },
      deduped: normalizedLine !== line.trim(),
    };
  }

  const quantity = readQuantityToken(tokens[quantityIndex] ?? "") ?? null;
  const unitIndex =
    tokens[quantityIndex + 1] && isUnitToken(tokens[quantityIndex + 1])
      ? quantityIndex + 1
      : -1;
  const unit = unitIndex >= 0 ? tokens[unitIndex] ?? null : null;
  let nameTokens =
    quantityIndex > 0
      ? tokens.slice(0, quantityIndex)
      : tokens.slice(unitIndex >= 0 ? unitIndex + 1 : quantityIndex + 1);
  let notesTokens =
    quantityIndex > 0
      ? tokens.slice(unitIndex >= 0 ? unitIndex + 1 : quantityIndex + 1)
      : [];

  if (quantityIndex === 0) {
    const firstSpecIndex = nameTokens.findIndex(isSpecToken);
    if (firstSpecIndex >= 0) {
      notesTokens = nameTokens.slice(firstSpecIndex);
      nameTokens = nameTokens.slice(0, firstSpecIndex);
    }
  }

  notesTokens = trimRepeatedTail(notesTokens, nameTokens);
  const name = nameTokens.join(" ").trim() || normalizedLine;
  const notes = notesTokens.join(" ").trim();

  return {
    item: {
      name,
      quantity,
      unit,
      notes: notes || null,
    },
    deduped: normalizedLine !== line.trim() || notesTokens.length < (
      quantityIndex > 0
        ? tokens.slice(unitIndex >= 0 ? unitIndex + 1 : quantityIndex + 1).length
        : notesTokens.length
    ),
  };
}

function dedupeMaterialItems(items: MaterialSpecItem[]) {
  const seen = new Set<string>();
  const deduped: MaterialSpecItem[] = [];
  for (const item of items) {
    const key = [
      item.name,
      item.quantity ?? "",
      item.unit ?? "",
      item.notes ?? "",
    ]
      .map((part) => normalizePlainMaterialText(part).toLowerCase())
      .join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

export function parseMaterialSpecPaste(text: string): MaterialSpecParseResult {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return { items: [], hasHeader: false, deduped: false };
  }

  const firstColumns = splitSpecLine(lines[0] ?? "");
  const header = detectHeader(firstColumns);
  const items: MaterialSpecItem[] = [];
  let dedupedText = false;

  for (const line of header ? lines.slice(1) : lines) {
    const columns = splitSpecLine(line);
    if (!header && columns.length === 1) {
      const parsed = parsePlainMaterialLine(line);
      if (parsed.item) items.push(parsed.item);
      dedupedText = dedupedText || parsed.deduped;
      continue;
    }
    const name = readColumn(columns, header, "name", 0);
    if (!name) continue;

    items.push({
      name,
      quantity: readColumn(columns, header, "quantity", 1),
      unit: readColumn(columns, header, "unit", 2),
      notes: readColumn(columns, header, "notes", 3),
    });
  }

  const uniqueItems = dedupeMaterialItems(items);
  return {
    items: uniqueItems.slice(0, 250),
    hasHeader: Boolean(header),
    deduped: dedupedText || uniqueItems.length < items.length,
  };
}
