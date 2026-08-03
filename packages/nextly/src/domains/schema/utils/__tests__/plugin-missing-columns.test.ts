/**
 * A plugin field added to an existing table gets its storage primitive.
 *
 * A fresh component table maps a plugin type through the canonical descriptor,
 * but `db:sync` adds columns to an existing table through this helper, whose
 * own switch falls back to TEXT for anything it does not recognise — so the
 * same declaration produced a numeric column on one path and a text column on
 * the other.
 */
import { afterEach, describe, expect, it } from "vitest";

import type { FieldConfig } from "../../../../collections/fields/types";
import {
  clearFieldTypes,
  registerFieldType,
} from "../../field-types/field-type-registry";
import { fieldToColumnDef } from "../missing-columns";

afterEach(() => {
  clearFieldTypes();
});

describe("adding a plugin field to an existing table", () => {
  it("uses the type's storage primitive rather than the text fallback", () => {
    registerFieldType({
      type: "star-rating",
      storage: "number",
      component: "@acme/ratings/admin#StarRating",
      surfaces: ["entries", "singles", "components"],
    });

    const column = fieldToColumnDef(
      { name: "score", type: "star-rating" } as unknown as FieldConfig,
      "postgresql"
    );

    expect(column).not.toMatch(/TEXT/i);
    expect(column).toMatch(/INTEGER|REAL|DOUBLE PRECISION|NUMERIC/i);
  });
});

/**
 * A built-in field added to an existing table must get the same storage class
 * a freshly created table gives it. This helper stated its own types, so a
 * `number` became NUMERIC/DECIMAL/REAL here while the ORM bound an integer,
 * and a SQLite `date` became TEXT while the binder wrote an integer.
 */
describe("built-in columns agree with the descriptor the ORM binds", () => {
  const number = { name: "score", type: "number" } as unknown as FieldConfig;

  it("adds an integer number column on every dialect", () => {
    for (const dialect of ["postgresql", "mysql", "sqlite"]) {
      expect(fieldToColumnDef(number, dialect)).toMatch(/INTEGER/i);
    }
  });

  it("does not emit a fractional type for a plain number", () => {
    // NUMERIC/DECIMAL/REAL here truncated or widened relative to the binder,
    // so the value read back was not the value written.
    for (const dialect of ["postgresql", "mysql", "sqlite"]) {
      expect(fieldToColumnDef(number, dialect)).not.toMatch(
        /NUMERIC|DECIMAL|REAL|DOUBLE/i
      );
    }
  });

  it("honours the two ways a field asks for fractions", () => {
    const money = {
      name: "price",
      type: "number",
      dbType: "decimal",
    } as unknown as FieldConfig;
    expect(fieldToColumnDef(money, "postgresql")).toMatch(/NUMERIC/i);
    expect(fieldToColumnDef(money, "mysql")).toMatch(/DECIMAL/i);

    const float = {
      name: "ratio",
      type: "number",
      options: { format: "float" },
    } as unknown as FieldConfig;
    expect(fieldToColumnDef(float, "postgresql")).toMatch(/DOUBLE PRECISION/i);
    expect(fieldToColumnDef(float, "sqlite")).toMatch(/REAL/i);
  });

  it("adds a SQLite date column the timestamp binder can read", () => {
    const date = {
      name: "publishedAt",
      type: "date",
    } as unknown as FieldConfig;

    expect(fieldToColumnDef(date, "sqlite")).toMatch(/INTEGER/i);
    // The other two dialects keep the types they already had.
    expect(fieldToColumnDef(date, "postgresql")).toMatch(/TIMESTAMP/i);
    expect(fieldToColumnDef(date, "mysql")).toMatch(/DATETIME/i);
  });
});
