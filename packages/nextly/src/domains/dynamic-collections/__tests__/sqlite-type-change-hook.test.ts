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
  after: FieldDefinition
): { types: [string, SqliteTypeChange][]; sql: string } {
  const types: [string, SqliteTypeChange][] = [];
  const sql = new DynamicCollectionSchemaService(
    undefined,
    dialect
  ).generateAlterTableMigration("single_hero", [before], [after], {
    isSingle: true,
    tableHasRows: true,
    onSqliteTypeChange: (column, change) => types.push([column, change]),
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
          fromRelationship: false,
          unique: false,
        },
      ],
    ]);
    expect(sql).not.toMatch(/score/i);
  });

  // The rebuild drops only the key Nextly made for a relationship's column, and an older one's
  // inline UNIQUE only where the field after is not unique: told both, with the type.
  it("tells whether the field before was a relationship, and whether the one after is unique", () => {
    const { types } = told(
      "sqlite",
      SCORE_TEXT,
      field({ name: "score", type: "number", unique: true })
    );

    expect(types).toEqual([
      [
        "score",
        expect.objectContaining({ fromRelationship: false, unique: true }),
      ],
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
