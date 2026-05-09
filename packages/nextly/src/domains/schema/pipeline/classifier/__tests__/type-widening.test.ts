// Unit tests for the per-dialect type-widening allow-list. Returning true
// means a type change is provably non-destructive and the Classifier can
// skip the type_change warning prompt.

import { describe, it, expect } from "vitest";

import { isWideningChange } from "../type-widening";

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
});
