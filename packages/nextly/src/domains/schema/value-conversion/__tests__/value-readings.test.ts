/**
 * What each database's columns hold, as a repair and a type change both read it: MySQL's `text`
 * by its bytes, a whole number by its column's bits, a decimal by its precision and scale, and the
 * non-finite numbers by what each column was measured to keep
 * (`non-finite-columns.integration.test.ts`).
 */
import { describe, expect, it } from "vitest";

import { valueJudgeFor } from "../judge-value";
import {
  byteLength,
  decimalFit,
  holdsNonFinite,
  integerBits,
  keptByInteger,
  MYSQL_TEXT_BYTES,
} from "../value-readings";

describe("MySQL's text column, by its bytes", () => {
  it("counts a value's UTF-8 bytes, not its characters", () => {
    expect(byteLength("é")).toBe(2);
    expect(MYSQL_TEXT_BYTES).toBe(65_535);
  });

  it("refuses a value past 65,535 bytes when a longer text becomes text, as MySQL does", () => {
    const judge = valueJudgeFor({
      dialect: "mysql",
      from: { type: "longtext", nullable: true },
      to: { type: "text", nullable: true },
      compareAs: "exact",
    });
    expect(judge?.({ key: { id: "1" }, text: "x".repeat(65_535) })).toBeNull();
    expect(judge?.({ key: { id: "2" }, text: "x".repeat(65_536) })).toBe(
      "too-long"
    );
  });
});

describe("a whole-number column, by its bits", () => {
  it("holds 32 bits on PostgreSQL and MySQL, 64 on SQLite", () => {
    expect(integerBits("postgresql")).toBe(32);
    expect(integerBits("mysql")).toBe(32);
    expect(integerBits("sqlite")).toBe(64);
  });

  it("keeps a whole number within its bits, read from its writing", () => {
    expect(keptByInteger("2147483647", 32)).toBe(true);
    expect(keptByInteger("-2147483648", 32)).toBe(true);
    expect(keptByInteger("2147483648", 32)).toBe(false);
    expect(keptByInteger("1e1", 32)).toBe(true);
    expect(keptByInteger("1.5", 64)).toBe(false);
    expect(keptByInteger("9223372036854775807", 64)).toBe(true);
    expect(keptByInteger("1e1000000000", 64)).toBe(false);
  });
});

describe("a decimal column, by its precision and scale", () => {
  it("holds a number exactly, rounded, or not at all", () => {
    expect(decimalFit("12345678.91", 10, 2)).toBe("exactly");
    expect(decimalFit("1.255", 10, 2)).toBe("rounded");
    expect(decimalFit("123456789", 10, 2)).toBe("out of range");
    expect(decimalFit("0", 10, 2)).toBe("exactly");
  });
});

describe("the non-finite numbers each column holds, as measured", () => {
  it("holds them in PostgreSQL's double, NaN only in its numeric, the infinities in SQLite's, none in MySQL's", () => {
    expect(holdsNonFinite("double", "postgresql", "Infinity")).toBe(true);
    expect(holdsNonFinite("decimal", "postgresql", "NaN")).toBe(true);
    expect(holdsNonFinite("decimal", "postgresql", "Infinity")).toBe(false);
    expect(holdsNonFinite("integer", "sqlite", "-Infinity")).toBe(true);
    expect(holdsNonFinite("double", "sqlite", "NaN")).toBe(false);
    expect(holdsNonFinite("double", "mysql", "Infinity")).toBe(false);
    expect(holdsNonFinite("json", "postgresql", "Infinity")).toBe(false);
  });
});
