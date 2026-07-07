import { describe, expect, it } from "vitest";
import { parseMoneyAmount } from "@/lib/money-amount";

describe("parseMoneyAmount", () => {
  it("preserves Number conversion call-sites with zero fallback", () => {
    expect(parseMoneyAmount(12.34)).toBe(12.34);
    expect(parseMoneyAmount(0)).toBe(0);
    expect(parseMoneyAmount(-5)).toBe(-5);
    expect(parseMoneyAmount("12.34")).toBe(12.34);
    expect(parseMoneyAmount("")).toBe(0);
    expect(parseMoneyAmount("   ")).toBe(0);
    expect(parseMoneyAmount("12abc")).toBe(0);
    expect(parseMoneyAmount(null)).toBe(0);
    expect(parseMoneyAmount(undefined)).toBe(0);
    expect(parseMoneyAmount(Number.NaN)).toBe(0);
    expect(parseMoneyAmount(Number.POSITIVE_INFINITY)).toBe(0);
    expect(parseMoneyAmount(true)).toBe(1);
    expect(parseMoneyAmount([12])).toBe(12);
    expect(parseMoneyAmount({ amount: 12 })).toBe(0);
  });

  it("preserves finite parseFloat call-sites with zero fallback", () => {
    const options = { mode: "parseFloat" as const, missing: 0, invalid: 0 };

    expect(parseMoneyAmount(12.34, options)).toBe(12.34);
    expect(parseMoneyAmount("12.34", options)).toBe(12.34);
    expect(parseMoneyAmount("12abc", options)).toBe(12);
    expect(parseMoneyAmount("-5.25", options)).toBe(-5.25);
    expect(parseMoneyAmount("abc", options)).toBe(0);
    expect(parseMoneyAmount(null, options)).toBe(0);
    expect(parseMoneyAmount(undefined, options)).toBe(0);
    expect(parseMoneyAmount(Number.NaN, options)).toBe(0);
    expect(parseMoneyAmount(true, options)).toBe(0);
  });

  it("preserves nullable finite parseFloat display call-sites", () => {
    const options = { mode: "parseFloat" as const, missing: null, invalid: null };

    expect(parseMoneyAmount(9, options)).toBe(9);
    expect(parseMoneyAmount("9.75", options)).toBe(9.75);
    expect(parseMoneyAmount("9.75 due", options)).toBe(9.75);
    expect(parseMoneyAmount("due", options)).toBeNull();
    expect(parseMoneyAmount(null, options)).toBeNull();
    expect(parseMoneyAmount(undefined, options)).toBeNull();
    expect(parseMoneyAmount(Number.POSITIVE_INFINITY, options)).toBeNull();
  });

  it("preserves worker receipt display's loose parsed values", () => {
    const options = {
      mode: "parseFloat" as const,
      missing: null,
      invalid: "parsed" as const,
      finiteNumbers: false,
    };

    expect(parseMoneyAmount(12, options)).toBe(12);
    expect(parseMoneyAmount(Number.POSITIVE_INFINITY, options)).toBe(Number.POSITIVE_INFINITY);
    expect(parseMoneyAmount("12abc", options)).toBe(12);
    expect(parseMoneyAmount("Infinity", options)).toBe(Number.POSITIVE_INFINITY);
    expect(parseMoneyAmount(null, options)).toBeNull();
    expect(parseMoneyAmount({ amount: 12 }, options)).toBeNull();
    expect(Number.isNaN(parseMoneyAmount("abc", options))).toBe(true);
    expect(Number.isNaN(parseMoneyAmount(Number.NaN, options))).toBe(true);
  });
});
