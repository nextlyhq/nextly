/**
 * Which indexes the creating SQL writes on a component column, per dialect and field shape.
 *
 * A component relation that references one entry gets a plain index, as a collection's does. A
 * relation holding a JSON list gets none on any dialect: no lookup reads a whole list, MySQL
 * refuses a plain index on a JSON column, and on PostgreSQL a btree entry over a long list exceeds
 * the row size and refuses the save. A many-to-many naming its target in `relationTo` is such a
 * list, although it names one collection, because a component has no junction table.
 *
 * A unique column the dialect can key carries its uniqueness as `uq_` and no plain index besides,
 * and a field asking to be indexed gets `idx_` only where the dialect can index its column.
 *
 * The desired schema the diff compares a live table against answers the same questions, so the
 * creator and it are held to one answer here: a disagreement makes every reconcile propose an
 * index the creator never wrote, or drop one it did.
 */
import { describe, expect, it } from "vitest";

import type { FieldConfig } from "../../../../collections/fields/types";
import { buildDesiredTableFromComponentFields } from "../../../schema/pipeline/diff/build-from-fields";
import { FieldGroupSchemaService } from "../field-group-schema-service";

type Dialect = "postgresql" | "mysql" | "sqlite";

const TABLE = "comp_card";
const COLUMN = "subject";
const DIALECTS: Dialect[] = ["postgresql", "mysql", "sqlite"];
const IDX = `idx_${TABLE}_${COLUMN}`;
const UQ = `uq_${TABLE}_${COLUMN}`;

const everywhere = (names: string[]): Record<Dialect, string[]> => ({
  postgresql: names,
  mysql: names,
  sqlite: names,
});

/** Each shape of the `subject` field, and the indexes its column carries per dialect. */
const SHAPES: Record<
  string,
  { field: Record<string, unknown>; expected: Record<Dialect, string[]> }
> = {
  // The code-first spelling: `relationTo` names one collection, while the value is a JSON list.
  "a many-to-many naming its target in relationTo": {
    field: {
      type: "relationship",
      relationTo: "users",
      options: { relationType: "manyToMany" },
    },
    expected: everywhere([]),
  },
  // The Builder spelling names the target on `options`.
  "a many-to-many naming its target in options": {
    field: {
      type: "relationship",
      options: { relationType: "manyToMany", target: "users" },
    },
    expected: everywhere([]),
  },
  "a hasMany relationship": {
    field: { type: "relationship", relationTo: "users", hasMany: true },
    expected: everywhere([]),
  },
  "a polymorphic relationship": {
    field: { type: "relationship", relationTo: ["users", "posts"] },
    expected: everywhere([]),
  },
  "an upload of several files": {
    field: { type: "upload", relationTo: "media", hasMany: true },
    expected: everywhere([]),
  },
  // Asking for an index does not give a list one: it would serve no lookup and refuse long lists.
  "an indexed many-to-many": {
    field: {
      type: "relationship",
      relationTo: "users",
      options: { relationType: "manyToMany" },
      index: true,
    },
    expected: everywhere([]),
  },
  "an indexed hasMany relationship": {
    field: {
      type: "relationship",
      relationTo: "users",
      hasMany: true,
      index: true,
    },
    expected: everywhere([]),
  },
  // A single polymorphic reference is one `{ relationTo, value }` object, not a list, so an index
  // it asks for is kept where the dialect can index its JSON column.
  "an indexed polymorphic reference to one entry": {
    field: {
      type: "relationship",
      relationTo: ["users", "posts"],
      index: true,
    },
    expected: { postgresql: [IDX], mysql: [], sqlite: [IDX] },
  },
  "an indexed polymorphic hasMany relationship": {
    field: {
      type: "relationship",
      relationTo: ["users", "posts"],
      hasMany: true,
      index: true,
    },
    expected: everywhere([]),
  },
  // A reference to one entry is a scalar column, indexable on every dialect.
  "a relationship to one entry": {
    field: { type: "relationship", relationTo: "users" },
    expected: everywhere([IDX]),
  },
  "an upload of one file": {
    field: { type: "upload", relationTo: "media" },
    expected: everywhere([IDX]),
  },
  "a unique relationship to one entry": {
    field: { type: "relationship", relationTo: "users", unique: true },
    expected: everywhere([UQ]),
  },
  "an indexed bounded text": {
    field: { type: "text", maxLength: 100, index: true },
    expected: everywhere([IDX]),
  },
  "a unique indexed bounded text": {
    field: { type: "text", maxLength: 100, index: true, unique: true },
    expected: everywhere([UQ]),
  },
  // A text with no `maxLength` is an unbounded TEXT column on MySQL, which it indexes only by a
  // key prefix (`indexKeysOn` below holds the key itself).
  "an indexed unbounded text": {
    field: { type: "text", index: true },
    expected: everywhere([IDX]),
  },
  "an indexed textarea": {
    field: { type: "textarea", index: true },
    expected: everywhere([IDX]),
  },
  // MySQL cannot index a JSON column; the others can.
  "an indexed JSON field": {
    field: { type: "json", index: true },
    expected: { postgresql: [IDX], mysql: [], sqlite: [IDX] },
  },
};

function fieldsWith(field: Record<string, unknown>): unknown[] {
  return [
    { name: "heading", type: "text" },
    { name: COLUMN, ...field },
  ];
}

/** The index names the creating SQL writes on the `subject` column, sorted. */
function creatorIndexes(
  dialect: Dialect,
  field: Record<string, unknown>
): string[] {
  const sql = new FieldGroupSchemaService(dialect).generateMigrationSQL(
    TABLE,
    fieldsWith(field) as unknown as FieldConfig[]
  );
  return [...sql.matchAll(indexStatement())]
    .map(match => match[1] ?? "")
    .sort();
}

/** A CREATE INDEX on the `subject` column alone, its name and its key part captured. */
function indexStatement(): RegExp {
  return new RegExp(
    `CREATE (?:UNIQUE )?INDEX (?:IF NOT EXISTS )?["\`]([^"\`]+)["\`] ON ["\`][^"\`]+["\`] ?\\((["\`]${COLUMN}["\`](?:\\(\\d+\\))?)\\)`,
    "g"
  );
}

/** The key part each CREATE INDEX on the `subject` column names, as written. */
function indexKeysOn(
  dialect: Dialect,
  field: Record<string, unknown>
): string[] {
  const sql = new FieldGroupSchemaService(dialect).generateMigrationSQL(
    TABLE,
    fieldsWith(field) as unknown as FieldConfig[]
  );
  return [...sql.matchAll(indexStatement())].map(match => match[2] ?? "");
}

/** The index names the desired schema declares on the `subject` column, sorted. */
function desiredIndexes(
  dialect: Dialect,
  field: Record<string, unknown>
): string[] {
  const table = buildDesiredTableFromComponentFields(
    TABLE,
    fieldsWith(field) as never,
    dialect,
    { builtBy: "fieldGroup" }
  );
  return (table.indexes ?? [])
    .filter(index => index.columns.includes(COLUMN))
    .map(index => index.name)
    .sort();
}

describe.each(DIALECTS)("a component column's indexes on %s", dialect => {
  describe.each(Object.entries(SHAPES))("%s", (_label, shape) => {
    const expected = shape.expected[dialect];

    it(`gets ${expected.length > 0 ? expected.join(" and ") : "no index"} from the creating SQL`, () => {
      expect(creatorIndexes(dialect, shape.field)).toEqual(expected);
    });

    it("gets the indexes the desired schema declares", () => {
      expect(creatorIndexes(dialect, shape.field)).toEqual(
        desiredIndexes(dialect, shape.field)
      );
    });
  });
});

// MySQL refuses a plain index on a TEXT column (error 1170), so the key is the column's first 191
// characters, the longest prefix InnoDB keys under utf8mb4 on every row format: the shared rule the
// collection and the schema pipeline index by. A bounded text is a VARCHAR, keyed whole; PostgreSQL
// and SQLite index the whole value of every one.
describe("the key an indexed text column is indexed by", () => {
  const quote = (dialect: Dialect) => (dialect === "mysql" ? "`" : '"');
  const whole = (dialect: Dialect) =>
    `${quote(dialect)}${COLUMN}${quote(dialect)}`;

  it.each([
    ["an unbounded text", { type: "text", index: true }],
    ["a textarea", { type: "textarea", index: true }],
  ])("%s on MySQL is keyed by its first 191 characters", (_label, field) => {
    expect(indexKeysOn("mysql", field)).toEqual(["`subject`(191)"]);
  });

  it("a bounded text on MySQL is keyed whole", () => {
    expect(
      indexKeysOn("mysql", { type: "text", maxLength: 100, index: true })
    ).toEqual(["`subject`"]);
  });

  it.each(["postgresql", "sqlite"] as const)(
    "an unbounded text on %s is keyed whole",
    dialect => {
      expect(indexKeysOn(dialect, { type: "text", index: true })).toEqual([
        whole(dialect),
      ]);
    }
  );
});
