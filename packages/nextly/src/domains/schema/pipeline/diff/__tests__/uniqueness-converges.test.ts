/**
 * The generators and the desired schema agree about a unique column.
 *
 * Nine review findings on the create path were instances of one thing: "is this column's
 * uniqueness a named index" was answered in three places — the CREATE statements, the ADD COLUMN
 * statements, and the desired schema the diff compares a live table against — and any two of them
 * disagreeing shows up as a reconcile that proposes an index the server refuses, once per attempt,
 * indefinitely. These pin the agreement rather than any one side of it.
 */
import { describe, expect, it } from "vitest";

import { DynamicCollectionSchemaService } from "../../../../dynamic-collections/services/dynamic-collection-schema-service";
import { buildDesiredTableFromFields } from "../build-from-fields";

type Dialect = "postgresql" | "mysql" | "sqlite";
const DIALECTS: Dialect[] = ["postgresql", "mysql", "sqlite"];

/**
 * The `uq_` indexes the desired schema declares for a table.
 *
 * `builtBy: "collection"` is not incidental — it is the origin
 * `DynamicCollectionSchemaService` renders under, and a text field with no stated width means
 * different things to different origins. Building the desired side under any other origin would
 * compare two tables that were never meant to match, and the test would fail for a reason that has
 * nothing to do with uniqueness.
 */
const declaredUniqueIndexes = (
  dialect: Dialect,
  fields: { name: string; type: string; unique?: boolean }[]
): string[] =>
  (
    buildDesiredTableFromFields("dc_widgets", fields, dialect, {
      builtBy: "collection",
    }).indexes ?? []
  )
    .filter(i => i.unique && i.name.startsWith("uq_"))
    .map(i => i.name);

/** The `uq_` indexes the CREATE path actually emits for the same table. */
const emittedUniqueIndexes = (
  dialect: Dialect,
  fields: { name: string; type: string; unique?: boolean }[]
): string[] => {
  const sql = new DynamicCollectionSchemaService(
    undefined,
    dialect
  ).generateMigrationSQL("dc_widgets", fields as never, { hasStatus: false });
  return [
    ...sql.matchAll(
      /CREATE UNIQUE INDEX (?:IF NOT EXISTS )?["`](uq_[^"`]+)["`]/g
    ),
  ].map(m => m[1]);
};

describe("what the desired schema declares and what the create path emits", () => {
  it.each(DIALECTS)(
    "agree for a unique column the dialect can key, on %s",
    dialect => {
      const fields = [{ name: "email", type: "email", unique: true }];
      expect(declaredUniqueIndexes(dialect, fields).sort()).toEqual(
        emittedUniqueIndexes(dialect, fields).sort()
      );
    }
  );

  it("agree for a MySQL TEXT column, which MySQL cannot key either way", () => {
    // The case that motivated the shared rule. MySQL refuses to key an unbounded TEXT column in
    // both spellings, so the create path keeps the uniqueness inline and emits no index. Before
    // the desired schema asked the same rule it declared `uq_dc_widgets_sku` regardless, and every
    // reconcile proposed a statement MySQL rejects.
    const fields = [{ name: "sku", type: "textarea", unique: true }];
    expect(declaredUniqueIndexes("mysql", fields)).toEqual([]);
    expect(emittedUniqueIndexes("mysql", fields)).toEqual([]);
  });

  it("agree for a MySQL JSON column, which MySQL cannot index at all", () => {
    const fields = [{ name: "payload", type: "json", unique: true }];
    expect(declaredUniqueIndexes("mysql", fields)).toEqual([]);
    expect(emittedUniqueIndexes("mysql", fields)).toEqual([]);
  });

  it("still declare and emit the index where the dialect CAN key the same column", () => {
    // The positive control. Without it, a build that withheld unique indexes everywhere would
    // satisfy both cases above by agreeing on nothing.
    for (const dialect of ["postgresql", "sqlite"] as const) {
      const fields = [{ name: "sku", type: "textarea", unique: true }];
      expect(declaredUniqueIndexes(dialect, fields)).toEqual([
        "uq_dc_widgets_sku",
      ]);
      expect(emittedUniqueIndexes(dialect, fields)).toEqual([
        "uq_dc_widgets_sku",
      ]);
    }
  });
});
