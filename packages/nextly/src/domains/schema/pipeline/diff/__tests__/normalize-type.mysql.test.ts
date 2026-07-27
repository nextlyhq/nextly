/**
 * MySQL has no boolean type. `BOOL` and `BOOLEAN` are synonyms for
 * `TINYINT(1)`, and introspection reports all three as `tinyint(1)` — verified
 * against MySQL 8: a table declared with BOOLEAN, BOOL, and TINYINT(1) columns
 * reports the identical `COLUMN_TYPE` for each.
 *
 * Without collapsing them, the core differ compared the live `tinyint(1)`
 * against the desired `boolean` and reported a type change for every boolean
 * column in the schema — so `nextly migrate` succeeded once and then refused
 * to run again, calling its own output a destructive change.
 */
import { describe, expect, it } from "vitest";

import { normalizeType } from "../normalize-type";

describe("normalizeType — MySQL booleans", () => {
  it("treats tinyint(1) and boolean as the same type", () => {
    expect(normalizeType("tinyint(1)")).toBe(normalizeType("boolean"));
    expect(normalizeType("tinyint(1)")).toBe(normalizeType("bool"));
  });

  it("is not confused by case or surrounding whitespace", () => {
    expect(normalizeType("  TINYINT(1) ")).toBe(normalizeType("boolean"));
  });

  it("is not confused by whitespace inside the width", () => {
    // Insignificant to the engine but not to a string compare, and the
    // fallback below would strip the width and leave a plain `tinyint`.
    for (const t of ["TINYINT ( 1 )", "tinyint( 1 )", "tinyint (1)"]) {
      expect(normalizeType(t), t).toBe(normalizeType("boolean"));
    }
  });

  it("keeps a plain tinyint distinct from a boolean", () => {
    // A one-byte integer, not a boolean — MySQL 8 reports it as `tinyint`
    // with no width, which is exactly what distinguishes the two.
    expect(normalizeType("tinyint")).not.toBe(normalizeType("boolean"));
  });

  it("keeps an unsigned tinyint(1) distinct", () => {
    // Not what the boolean synonym produces, so collapsing it would hide a
    // real difference rather than a cosmetic one.
    expect(normalizeType("tinyint(1) unsigned")).not.toBe(
      normalizeType("boolean")
    );
  });

  it("leaves the other integer widths alone", () => {
    for (const t of ["smallint", "mediumint", "int", "bigint"]) {
      expect(normalizeType(t), t).not.toBe(normalizeType("boolean"));
    }
  });
});
