/**
 * The generators and the desired schema agree about a unique column.
 *
 * "Is this column's uniqueness a named index" is answered by the CREATE statements, the ADD COLUMN
 * statements, and the desired schema the diff compares a live table against. Any two of them
 * disagreeing shows up as a reconcile proposing an index the server refuses, once per attempt,
 * indefinitely. These pin the agreement rather than any one side of it.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../../errors";
import { DynamicCollectionSchemaService } from "../../../../dynamic-collections/services/dynamic-collection-schema-service";
import { uniquenessCanBeAnIndex } from "../../../services/index-name";
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

/** The structured refusals a NextlyError carries, flattened for assertion. */
function refusalMessages(run: () => unknown): string[] {
  try {
    run();
  } catch (error) {
    if (!(error instanceof NextlyError)) throw error;
    const data = error.publicData as
      | { errors?: { path?: string; code?: string; message?: string }[] }
      | undefined;
    return (data?.errors ?? []).map(e => `${e.path} ${e.code} ${e.message}`);
  }
  return [];
}

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

describe("uniqueness a dialect cannot enforce", () => {
  const unkeyable = [
    { name: "sku", type: "textarea", unique: true },
  ] as unknown as never[];

  it("is refused by the collection add-column path before any DDL is generated", () => {
    // MySQL commits each DDL statement separately, so an ADD COLUMN followed by a constraint it
    // rejects leaves the column WITHOUT its guarantee — and a bare column is exactly what the
    // desired schema declares for an unkeyable type, so the next reconcile finds nothing to fix
    // and the uniqueness is gone silently. Refusing first is what keeps the table untouched.
    const service = new DynamicCollectionSchemaService(undefined, "mysql");
    const reported = refusalMessages(() =>
      service.generateAlterTableMigration("dc_widgets", [], unkeyable)
    );

    expect(reported).toHaveLength(1);
    expect(reported[0]).toContain("fields.sku");
    expect(reported[0]).toContain("UNIQUE_NOT_ENFORCEABLE_ON_DIALECT");
    // A refusal that does not say what to do instead is only a wall.
    expect(reported[0]).toContain("remove the unique flag");
    expect(reported[0]).toContain("short-variant text field");
  });

  it("names a remedy the column mapper can actually deliver", () => {
    // The remedy has to be checked against the mapper, not just read. A maximum length is the
    // intuitive advice and it is inert: only the short text variant reaches a bounded VARCHAR,
    // while every unkeyable type stays TEXT/JSON however it is bounded. A message naming an
    // ineffective remedy sends the user to change a setting that cannot resolve the refusal.
    const service = new DynamicCollectionSchemaService(undefined, "mysql");

    const shortText = service.mapFieldTypeToSQL(
      "text",
      undefined,
      { variant: "short" },
      { maxLength: 120 }
    );
    expect(shortText).toMatch(/^varchar\(/i);
    expect(uniquenessCanBeAnIndex(shortText, "mysql")).toBe(true);

    for (const type of ["textarea", "richText", "code", "json", "chips"]) {
      const bounded = service.mapFieldTypeToSQL(type, undefined, undefined, {
        maxLength: 120,
      });
      expect(uniquenessCanBeAnIndex(bounded, "mysql")).toBe(false);
    }
  });

  it("is allowed on a dialect that CAN enforce it", () => {
    // The control: without it, a service that refused every unique add would satisfy the case
    // above while breaking the feature.
    for (const dialect of ["postgresql", "sqlite"] as const) {
      const service = new DynamicCollectionSchemaService(undefined, dialect);
      expect(() =>
        service.generateAlterTableMigration("dc_widgets", [], unkeyable)
      ).not.toThrow();
    }
  });
});
