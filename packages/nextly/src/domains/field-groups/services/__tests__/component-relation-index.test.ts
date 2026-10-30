/**
 * Which relation columns of a component table the creating SQL indexes, per dialect.
 *
 * A component relation that names one collection gets a plain index, as a collection's does. A
 * many-to-many names one collection too, but a component has no junction table, so its ids live
 * on the row as a JSON list. MySQL refuses a plain index on a JSON column ("supports indexing only
 * via generated columns on a specified JSON path"), and the index statement runs after the
 * `CREATE TABLE` has committed, so emitting it there fails the save with the table already made.
 * PostgreSQL and SQLite index the value, so they keep the index.
 *
 * The desired schema the diff compares a live table against answers the same question, so the
 * creator and it are held to one answer here: a disagreement makes every reconcile propose an
 * index the creator never wrote (or drop one it did).
 */
import { describe, expect, it } from "vitest";

import type { FieldConfig } from "../../../../collections/fields/types";
import { buildDesiredTableFromComponentFields } from "../../../schema/pipeline/diff/build-from-fields";
import { FieldGroupSchemaService } from "../field-group-schema-service";

type Dialect = "postgresql" | "mysql" | "sqlite";

const TABLE = "comp_card";
const DIALECTS: Dialect[] = ["postgresql", "mysql", "sqlite"];

/** Each relation shape a component row stores, and whether its column is indexed per dialect. */
const SHAPES: Record<
  string,
  { field: Record<string, unknown>; indexedOn: Dialect[] }
> = {
  // The code-first spelling: `relationTo` names the target, so the field reads as a reference to
  // one collection, while its value is a JSON list.
  "a many-to-many naming its target in relationTo": {
    field: {
      name: "related",
      type: "relationship",
      relationTo: "users",
      options: { relationType: "manyToMany" },
    },
    indexedOn: ["postgresql", "sqlite"],
  },
  // The Builder spelling names the target on `options`, which no index rule reads as a single
  // reference, so it is unindexed everywhere, as before.
  "a many-to-many naming its target in options": {
    field: {
      name: "related",
      type: "relationship",
      options: { relationType: "manyToMany", target: "users" },
    },
    indexedOn: [],
  },
  // A reference to one row is a scalar column, indexable on every dialect.
  "a relationship to one entry": {
    field: { name: "related", type: "relationship", relationTo: "users" },
    indexedOn: ["postgresql", "mysql", "sqlite"],
  },
  "a hasMany relationship": {
    field: {
      name: "related",
      type: "relationship",
      relationTo: "users",
      hasMany: true,
    },
    indexedOn: [],
  },
};

/** The index names the creating SQL writes on the `related` column. */
function creatorIndexes(dialect: Dialect, field: unknown): string[] {
  const sql = new FieldGroupSchemaService(dialect).generateMigrationSQL(TABLE, [
    { name: "heading", type: "text" },
    field,
  ] as unknown as FieldConfig[]);
  return [
    ...sql.matchAll(
      /CREATE (?:UNIQUE )?INDEX (?:IF NOT EXISTS )?["`]([^"`]+)["`] ON ["`][^"`]+["`]\(["`]related["`]\)/g
    ),
  ].map(match => match[1] ?? "");
}

/** The index names the desired schema declares on the `related` column. */
function desiredIndexes(dialect: Dialect, field: unknown): string[] {
  const table = buildDesiredTableFromComponentFields(
    TABLE,
    [{ name: "heading", type: "text" }, field] as never,
    dialect,
    { builtBy: "fieldGroup" }
  );
  return (table.indexes ?? [])
    .filter(index => index.columns.includes("related"))
    .map(index => index.name);
}

describe.each(DIALECTS)("a component relation's index on %s", dialect => {
  describe.each(Object.entries(SHAPES))("%s", (_label, shape) => {
    const indexed = shape.indexedOn.includes(dialect);

    it(`is ${indexed ? "indexed" : "not indexed"} by the creating SQL`, () => {
      expect(creatorIndexes(dialect, shape.field)).toEqual(
        indexed ? [`idx_${TABLE}_related`] : []
      );
    });

    it("gets the index the desired schema declares", () => {
      expect(creatorIndexes(dialect, shape.field)).toEqual(
        desiredIndexes(dialect, shape.field)
      );
    });
  });
});
