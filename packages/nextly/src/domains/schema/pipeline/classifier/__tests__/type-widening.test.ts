// Unit tests for the per-dialect type-widening allow-list. Returning true
// means a type change is provably non-destructive and the Classifier can
// skip the type_change warning prompt.

import { describe, it, expect } from "vitest";

import { isWideningChange, stringNarrowingLimit } from "../type-widening";

describe("isWideningChange — Postgres", () => {
  it("varchar(50) -> varchar(255) is widening", () => {
    expect(isWideningChange("varchar(50)", "varchar(255)", "postgresql")).toBe(
      true
    );
  });
  it("varchar(255) -> varchar(50) is NOT widening", () => {
    expect(isWideningChange("varchar(255)", "varchar(50)", "postgresql")).toBe(
      false
    );
  });
  it("varchar -> text is widening", () => {
    expect(isWideningChange("varchar", "text", "postgresql")).toBe(true);
  });
  it("varchar(100) -> text is widening", () => {
    expect(isWideningChange("varchar(100)", "text", "postgresql")).toBe(true);
  });
  it("text -> varchar is NOT widening", () => {
    expect(isWideningChange("text", "varchar", "postgresql")).toBe(false);
  });
  it("smallint -> int is widening (using PG udt_name tokens)", () => {
    expect(isWideningChange("int2", "int4", "postgresql")).toBe(true);
    expect(isWideningChange("int4", "int8", "postgresql")).toBe(true);
  });
  it("smallint -> int is widening (using SQL aliases)", () => {
    expect(isWideningChange("smallint", "int", "postgresql")).toBe(true);
    expect(isWideningChange("int", "bigint", "postgresql")).toBe(true);
  });
  it("text -> int is NOT widening", () => {
    expect(isWideningChange("text", "int", "postgresql")).toBe(false);
  });
  it("int -> text is NOT widening", () => {
    expect(isWideningChange("int", "text", "postgresql")).toBe(false);
  });
  it("char(10) -> varchar is widening", () => {
    expect(isWideningChange("char(10)", "varchar", "postgresql")).toBe(true);
  });
  it("char(10) -> varchar(255) is widening", () => {
    expect(isWideningChange("char(10)", "varchar(255)", "postgresql")).toBe(
      true
    );
  });
  it("bpchar (PG udt_name for CHAR) -> varchar is widening", () => {
    // Critical: PG live introspection returns "bpchar", not "char(N)" —
    // see introspect-live.ts. Without this case, existing CHAR columns
    // would spuriously trigger destructive warnings on widening.
    expect(isWideningChange("bpchar", "varchar", "postgresql")).toBe(true);
  });
  it("bpchar -> text is widening", () => {
    expect(isWideningChange("bpchar", "text", "postgresql")).toBe(true);
  });
  it("int8 -> bigint is widening (cross-token-system within family)", () => {
    expect(isWideningChange("int8", "bigint", "postgresql")).toBe(true);
  });
  it("same type returns true (degenerate widening)", () => {
    expect(isWideningChange("text", "text", "postgresql")).toBe(true);
  });
  it("trims whitespace and is case-insensitive", () => {
    expect(
      isWideningChange(" VarChar(50) ", "varchar(255)", "postgresql")
    ).toBe(true);
  });
});

describe("isWideningChange — MySQL", () => {
  it("tinyint -> smallint widens", () => {
    expect(isWideningChange("tinyint", "smallint", "mysql")).toBe(true);
  });
  it("varchar(100) -> text widens", () => {
    expect(isWideningChange("varchar(100)", "text", "mysql")).toBe(true);
  });
  it("text -> mediumtext widens", () => {
    expect(isWideningChange("text", "mediumtext", "mysql")).toBe(true);
  });
  it("mediumtext -> text does NOT widen", () => {
    expect(isWideningChange("mediumtext", "text", "mysql")).toBe(false);
  });
  it("tinyint -> int widens", () => {
    expect(isWideningChange("tinyint", "int", "mysql")).toBe(true);
  });
  it("varchar(50) -> varchar(255) widens", () => {
    expect(isWideningChange("varchar(50)", "varchar(255)", "mysql")).toBe(true);
  });
  it("varchar(255) -> varchar(50) does NOT widen", () => {
    expect(isWideningChange("varchar(255)", "varchar(50)", "mysql")).toBe(
      false
    );
  });
});

describe("isWideningChange — SQLite", () => {
  it("text -> text is widening (storage class no-op)", () => {
    expect(isWideningChange("text", "text", "sqlite")).toBe(true);
  });
  it("integer -> integer is widening", () => {
    expect(isWideningChange("integer", "integer", "sqlite")).toBe(true);
  });
  it("text -> integer is NOT widening (cross storage class)", () => {
    expect(isWideningChange("text", "integer", "sqlite")).toBe(false);
  });
  it("integer -> text is NOT widening", () => {
    expect(isWideningChange("integer", "text", "sqlite")).toBe(false);
  });
  // SQLite stores by type AFFINITY, not declared type: every numeric-family
  // declaration (integer/real/numeric/decimal and their aliases) shares NUMERIC
  // or INTEGER affinity, so moving between them rewrites no data and cannot
  // fail. Warning about it produced a false "data loss" prompt on an edit that
  // is in fact lossless. Cross-family moves still warn — see the cases above and
  // below, which is what keeps this from degrading into "SQLite never warns".
  it("treats a change between numeric declared types as non-destructive", () => {
    expect(isWideningChange("real", "integer", "sqlite")).toBe(true);
    expect(isWideningChange("integer", "real", "sqlite")).toBe(true);
    expect(isWideningChange("integer", "numeric", "sqlite")).toBe(true);
    expect(isWideningChange("numeric(10, 2)", "integer", "sqlite")).toBe(true);
  });
  it("blob -> real is NOT widening (cross storage class)", () => {
    expect(isWideningChange("blob", "real", "sqlite")).toBe(false);
  });
});

// A change that can only cut a stored string short, and how long a value may be once it has run.
// The bound is what a row is counted against before the change is allowed to run, so a missed
// narrowing would let truncation through and a false one would refuse a lossless edit.
describe("stringNarrowingLimit", () => {
  it("bounds a MySQL text-family column narrowed to varchar(N)", () => {
    expect(stringNarrowingLimit("text", "varchar(255)", "mysql")).toBe(255);
    expect(stringNarrowingLimit("MEDIUMTEXT", "varchar(100)", "mysql")).toBe(
      100
    );
    expect(stringNarrowingLimit("longtext", "varchar(36)", "mysql")).toBe(36);
  });
  it("bounds a varchar narrowed to a shorter varchar", () => {
    expect(stringNarrowingLimit("varchar(500)", "varchar(100)", "mysql")).toBe(
      100
    );
    expect(stringNarrowingLimit("text", "varchar(255)", "postgresql")).toBe(
      255
    );
    expect(stringNarrowingLimit("varchar", "varchar(10)", "postgresql")).toBe(
      10
    );
  });
  it("bounds a fixed-width char narrowed to a shorter varchar", () => {
    expect(stringNarrowingLimit("char(255)", "varchar(10)", "mysql")).toBe(10);
    expect(isWideningChange("char(255)", "varchar(10)", "mysql")).toBe(false);
    expect(isWideningChange("char(10)", "varchar(255)", "mysql")).toBe(true);
    expect(isWideningChange("char(10)", "varchar", "postgresql")).toBe(true);
  });
  it("is null for a widening string change", () => {
    expect(
      stringNarrowingLimit("varchar(100)", "varchar(255)", "mysql")
    ).toBeNull();
    expect(stringNarrowingLimit("varchar(255)", "text", "mysql")).toBeNull();
    expect(
      stringNarrowingLimit("varchar(255)", "varchar(255)", "mysql")
    ).toBeNull();
  });
  it("is null when either side is not a string type", () => {
    expect(stringNarrowingLimit("text", "int", "mysql")).toBeNull();
    expect(stringNarrowingLimit("int", "varchar(10)", "mysql")).toBeNull();
    expect(stringNarrowingLimit("text", "json", "mysql")).toBeNull();
  });
  it("is null on SQLite, which never enforces a declared length", () => {
    expect(stringNarrowingLimit("text", "varchar(255)", "sqlite")).toBeNull();
  });
});
