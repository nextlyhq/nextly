/**
 * Array columns in the desired snapshot.
 *
 * The desired and live snapshots must agree on a column nobody has touched.
 * Drizzle marks `text("tags").array()` as a PgText column carrying
 * `dimensions: 1`, so `getSQLType()` returns "text" for both a text column and
 * a text[] column. Live introspection reads PostgreSQL's `_text`, which
 * normalises to "text[]". Losing the dimension therefore reports a type change
 * on an untouched column — and a type change is destructive, which refuses the
 * entire core reconcile.
 */
import { pgTable, text, integer } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { normalizeType } from "../../../domains/schema/pipeline/diff/normalize-type";
import { drizzleTableToTableSpec } from "../drizzle-to-tablespec";

describe("drizzleTableToTableSpec array columns", () => {
  const table = pgTable("probe", {
    tags: text("tags").array(),
    plain: text("plain"),
    counts: integer("counts").array(),
  });

  function typeOf(column: string): string | undefined {
    return drizzleTableToTableSpec(table).columns.find(c => c.name === column)
      ?.type;
  }

  it("marks an array column as an array", () => {
    expect(typeOf("tags")).toBe("text[]");
  });

  it("leaves a non-array column alone", () => {
    expect(typeOf("plain")).toBe("text");
  });

  it("applies to any base type, not just text", () => {
    expect(typeOf("counts")).toBe("integer[]");
  });

  it("agrees with what introspection reports for the same column", () => {
    // PostgreSQL's udt_name for text[] is `_text`. Both sides must reduce to
    // one token or the diff sees a change that is not there.
    expect(normalizeType(typeOf("tags"))).toBe(normalizeType("_text"));
    expect(normalizeType(typeOf("plain"))).not.toBe(normalizeType("_text"));
  });
});
