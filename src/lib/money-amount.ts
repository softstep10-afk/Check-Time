export type MoneyAmountParseMode = "number" | "parseFloat";
export type MoneyAmountInvalidFallback = number | null | "parsed";

export type MoneyAmountParseOptions = {
  mode?: MoneyAmountParseMode;
  missing?: number | null;
  invalid?: MoneyAmountInvalidFallback;
  finiteNumbers?: boolean;
};

export function parseMoneyAmount(
  value: unknown,
  {
    mode = "number",
    missing = 0,
    invalid = 0,
    finiteNumbers = true,
  }: MoneyAmountParseOptions = {},
): number | null {
  if (value === null || value === undefined) return missing;

  if (mode === "number") {
    if (typeof value === "number" && !finiteNumbers) return value;
    try {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
      return invalid === "parsed" ? parsed : invalid;
    } catch {
      return invalid === "parsed" ? Number.NaN : invalid;
    }
  }

  if (typeof value === "number") {
    if (!finiteNumbers || Number.isFinite(value)) return value;
    return invalid === "parsed" ? value : invalid;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
    return invalid === "parsed" ? parsed : invalid;
  }

  return missing;
}
