import { NextlyError } from "@nextlyhq/plugin-sdk";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { fromDecimalString, toDecimalString } from "./decimal";
import { money } from "./money";

describe("decimal strings at a provider's edge", () => {
  it("writes an amount with exactly the currency's decimal places", () => {
    expect(toDecimalString(money(1234, "USD"))).toBe("12.34");
    expect(toDecimalString(money(5, "USD"))).toBe("0.05");
    expect(toDecimalString(money(-5, "USD"))).toBe("-0.05");
    expect(toDecimalString(money(1234, "JPY"))).toBe("1234");
    expect(toDecimalString(money(1234, "KWD"))).toBe("1.234");
    expect(toDecimalString(money(0, "USD"))).toBe("0.00");
  });

  it("reads a decimal exactly, accepting fewer places but never more", () => {
    expect(fromDecimalString("12.34", "USD")).toEqual(money(1234, "USD"));
    expect(fromDecimalString("12.3", "USD")).toEqual(money(1230, "USD"));
    expect(fromDecimalString("12", "USD")).toEqual(money(1200, "USD"));
    expect(fromDecimalString("-0.05", "USD")).toEqual(money(-5, "USD"));
    expect(fromDecimalString("1234", "JPY")).toEqual(money(1234, "JPY"));
  });

  it("refuses rounding, exponents and anything that is not a plain decimal", () => {
    for (const value of [
      "12.345",
      "1e2",
      "+1.00",
      " 1.00",
      "1,000.00",
      "1.",
      ".5",
      "",
    ]) {
      let code: unknown;
      try {
        fromDecimalString(value, "USD");
      } catch (error) {
        code = NextlyError.is(error) ? error.code : error;
      }
      expect(code, JSON.stringify(value)).toBe("COMMERCE_INVALID_AMOUNT");
    }
  });

  it("round-trips every safe amount in every kind of minor unit", () => {
    fc.assert(
      fc.property(
        fc.integer({
          min: Number.MIN_SAFE_INTEGER,
          max: Number.MAX_SAFE_INTEGER,
        }),
        fc.constantFrom("USD", "JPY", "KWD"),
        (amount, currency) => {
          const m = money(amount, currency);
          expect(fromDecimalString(toDecimalString(m), currency)).toEqual(m);
        }
      )
    );
  });
});
