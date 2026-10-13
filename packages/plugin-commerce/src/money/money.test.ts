import { NextlyError } from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import { isCurrencyCode, minorUnits } from "./currency";
import {
  add,
  compare,
  equals,
  isMoney,
  money,
  moneySchema,
  multiply,
  negate,
  subtract,
  sum,
} from "./money";

function codeOf(body: () => unknown): string | undefined {
  try {
    body();
  } catch (error) {
    return NextlyError.is(error) ? String(error.code) : "not a NextlyError";
  }
  return undefined;
}

describe("currencies", () => {
  it("knows each currency's minor unit from ISO 4217, not from display digits", () => {
    expect(minorUnits("USD")).toBe(2);
    expect(minorUnits("JPY")).toBe(0);
    expect(minorUnits("KWD")).toBe(3);
    // A currency some engines' locale data lacks is still accepted.
    expect(minorUnits("VED")).toBe(2);
    // CLDR shows IQD with no decimals; ISO 4217, which providers charge in,
    // defines three. The table, not Intl, must decide.
    expect(minorUnits("IQD")).toBe(3);
  });

  it("refuses a code that is not a sales currency", () => {
    expect(isCurrencyCode("USD")).toBe(true);
    // XAU is a precious metal and CLF a fund code: real ISO codes, not money a
    // store sells in.
    for (const code of [
      "usd",
      "US",
      "USDX",
      "ABC",
      "XAU",
      "XXX",
      "CLF",
      840,
      null,
    ]) {
      expect(isCurrencyCode(code), String(code)).toBe(false);
    }
    expect(codeOf(() => minorUnits("ABC"))).toBe("COMMERCE_UNKNOWN_CURRENCY");
  });

  it("accepts ISO 4217's current currencies and refuses withdrawn ones the engine still lists", () => {
    // Node 24.21's ICU still lists HRK (replaced by EUR in 2023), BGN (by EUR
    // in 2026), ANG (by XCG), SLL (by SLE), ZWL (by ZWG) and CUC; XAD is a fund
    // code added to the list in 2026.
    for (const code of ["HRK", "BGN", "ANG", "SLL", "ZWL", "CUC", "XAD"]) {
      expect(isCurrencyCode(code), code).toBe(false);
    }
    for (const code of [
      "EUR",
      "XCG",
      "SLE",
      "ZWG",
      "VED",
      "VES",
      "MRU",
      "STN",
    ]) {
      expect(isCurrencyCode(code), code).toBe(true);
    }
  });
});

describe("money", () => {
  it("holds a whole number of minor units with its currency", () => {
    expect(money(1234, "USD")).toEqual({ amount: 1234, currency: "USD" });
    expect(Object.isFrozen(money(1, "USD"))).toBe(true);
  });

  it("refuses an amount that is not a safe whole number", () => {
    for (const amount of [12.34, 0.1, Number.NaN, Infinity, 2 ** 53]) {
      expect(
        codeOf(() => money(amount, "USD")),
        String(amount)
      ).toBe("COMMERCE_INVALID_AMOUNT");
    }
    expect(codeOf(() => money(1, "usd"))).toBe("COMMERCE_UNKNOWN_CURRENCY");
  });

  it("stores negative zero as zero", () => {
    expect(Object.is(negate(money(0, "USD")).amount, 0)).toBe(true);
    expect(Object.is(money(-0, "USD").amount, 0)).toBe(true);
  });

  it("adds, subtracts, multiplies and sums in one currency", () => {
    const a = money(1050, "USD");
    const b = money(250, "USD");
    expect(add(a, b).amount).toBe(1300);
    expect(subtract(b, a).amount).toBe(-800);
    expect(multiply(a, 3).amount).toBe(3150);
    expect(sum("USD", [a, b, b]).amount).toBe(1550);
    expect(sum("JPY", []).amount).toBe(0);
    expect(compare(a, b)).toBe(1);
    expect(equals(a, money(1050, "USD"))).toBe(true);
    expect(equals(a, money(1050, "EUR"))).toBe(false);
  });

  it("refuses to combine amounts in different currencies", () => {
    const usd = money(100, "USD");
    const eur = money(100, "EUR");
    expect(codeOf(() => add(usd, eur))).toBe("COMMERCE_CURRENCY_MISMATCH");
    expect(codeOf(() => subtract(usd, eur))).toBe("COMMERCE_CURRENCY_MISMATCH");
    expect(codeOf(() => compare(usd, eur))).toBe("COMMERCE_CURRENCY_MISMATCH");
    expect(codeOf(() => sum("USD", [usd, eur]))).toBe(
      "COMMERCE_CURRENCY_MISMATCH"
    );
  });

  it("sums to any total in the safe range, whatever the order of the parts", () => {
    const max = Number.MAX_SAFE_INTEGER;
    const parts = [money(max, "USD"), money(1, "USD"), money(-1, "USD")];
    expect(sum("USD", parts)).toEqual(money(max, "USD"));
    expect(sum("USD", [...parts].reverse())).toEqual(money(max, "USD"));
    expect(codeOf(() => sum("USD", parts.slice(0, 2)))).toBe(
      "COMMERCE_INVALID_AMOUNT"
    );
  });

  it("refuses a fractional factor rather than rounding it", () => {
    expect(codeOf(() => multiply(money(999, "USD"), 0.5))).toBe(
      "COMMERCE_INVALID_AMOUNT"
    );
  });

  it("refuses a result that leaves the safe-integer range", () => {
    const big = money(Number.MAX_SAFE_INTEGER, "USD");
    expect(codeOf(() => add(big, money(1, "USD")))).toBe(
      "COMMERCE_INVALID_AMOUNT"
    );
  });

  it("parses an amount from outside, refusing floats, unknown currencies and extra keys", () => {
    expect(moneySchema.parse({ amount: 5, currency: "EUR" })).toEqual(
      money(5, "EUR")
    );
    expect(isMoney({ amount: 5.5, currency: "EUR" })).toBe(false);
    expect(isMoney({ amount: 5, currency: "eur" })).toBe(false);
    expect(isMoney({ amount: 5, currency: "EUR", note: "x" })).toBe(false);
    expect(isMoney({ amount: "5", currency: "EUR" })).toBe(false);
  });
});
