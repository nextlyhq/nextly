/**
 * On SQLite the alter generator renders no statement for a column whose type moves, since SQLite
 * has none: it tells the caller (`onSqliteTypeChange`), which rebuilds the table with the new type,
 * as it does for a nullability change. Only a change of the column's TYPE is told; a change the
 * column's type does not follow (an index on the field) is not, and PostgreSQL and MySQL alter
 * the column in place and tell nothing.
 */
import { describe, expect, it } from "vitest";

import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { getColumnDescriptor } from "../../schema/services/field-column-descriptor";
import { indexNameForColumn } from "../../schema/services/index-name";
import type { SqliteTypeChange } from "../../schema/services/sqlite-nullability-rebuild";
import {
  DynamicCollectionSchemaService,
  type SupportedDialect,
} from "../services/dynamic-collection-schema-service";

const field = (overrides: Record<string, unknown>): FieldDefinition =>
  ({ required: false, ...overrides }) as unknown as FieldDefinition;

/** What the generator tells the caller, and the statements it renders, for one change. */
function told(
  dialect: SupportedDialect,
  before: FieldDefinition,
  after: FieldDefinition,
  /** The index names the live table holds, as the caller reads them. */
  indexNames?: ReadonlySet<string>
): { types: [string, SqliteTypeChange][]; sql: string } {
  const types: [string, SqliteTypeChange][] = [];
  const sql = new DynamicCollectionSchemaService(
    undefined,
    dialect
  ).generateAlterTableMigration("single_hero", [before], [after], {
    isSingle: true,
    tableHasRows: true,
    onSqliteTypeChange: (column, change) => types.push([column, change]),
    ...(indexNames === undefined ? {} : { indexNames }),
  });
  return { types, sql };
}

const SCORE_TEXT = field({ name: "score", type: "text" });
const SCORE_NUMBER = field({ name: "score", type: "number" });

describe("a column's type change, told to the caller on SQLite", () => {
  it("tells the caller the new type of a column whose type moves, rendering no statement for it", () => {
    const { types, sql } = told("sqlite", SCORE_TEXT, SCORE_NUMBER);

    expect(types).toEqual([
      [
        "score",
        {
          type: getColumnDescriptor(SCORE_NUMBER, "sqlite", "collection")
            ?.dialectType,
          formerUnique: false,
          unique: false,
        },
      ],
    ]);
    expect(sql).not.toMatch(/score/i);
  });

  // The rebuild drops only the key Nextly made for a relationship's column, and an older one-to-one's
  // inline UNIQUE only where the field after is not unique: told both, with the type.
  it("tells whether the field before was unique, and whether the one after is", () => {
    const { types } = told(
      "sqlite",
      SCORE_TEXT,
      field({ name: "score", type: "number", unique: true })
    );

    expect(types).toEqual([
      ["score", expect.objectContaining({ formerUnique: false, unique: true })],
    ]);
  });

  it("tells nothing for a change the column's type does not follow", () => {
    const { types } = told(
      "sqlite",
      SCORE_TEXT,
      field({ name: "score", type: "text", index: true })
    );

    expect(types).toEqual([]);
  });

  it.each(["postgresql", "mysql"] as const)(
    "tells nothing on %s, which alters the column in place",
    dialect => {
      const { types, sql } = told(dialect, SCORE_TEXT, SCORE_NUMBER);

      expect(types).toEqual([]);
      expect(sql).toMatch(/score/i);
    }
  );
});

// A relationship's column is indexed whatever its `.index` says; a plain field's only on request.
// A type change across that line adds or drops the index as the rules before and after differ, on
// every dialect, or the table keeps an index its file does not declare.
describe("a type change across a relationship, and its column's index", () => {
  const AUTHOR = field({
    name: "author",
    type: "relationship",
    relationTo: "posts",
  });
  const AUTHOR_NUMBER = field({ name: "author", type: "number" });

  it.each(["sqlite", "postgresql", "mysql"] as const)(
    "drops the relationship's index when it becomes a plain field (%s)",
    dialect => {
      // The live table holds the relationship's index, as the caller reads it (MySQL drops only an
      // index it is told is there).
      const { sql } = told(
        dialect,
        AUTHOR,
        AUTHOR_NUMBER,
        new Set([indexNameForColumn("single_hero", "author")])
      );

      expect(sql).toMatch(/DROP INDEX[^;]*author/i);
    }
  );

  it.each(["sqlite", "postgresql", "mysql"] as const)(
    "adds the index a field becoming a relationship takes (%s)",
    dialect => {
      const { sql } = told(dialect, AUTHOR_NUMBER, AUTHOR);

      expect(sql).toMatch(/CREATE INDEX[^;]*author/i);
    }
  );
});
