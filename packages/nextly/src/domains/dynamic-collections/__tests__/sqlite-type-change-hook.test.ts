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
): { types: [string, string][]; sql: string } {
  const types: [string, string][] = [];
  const sql = new DynamicCollectionSchemaService(
    undefined,
    dialect
  ).generateAlterTableMigration("single_hero", [before], [after], {
    isSingle: true,
    tableHasRows: true,
    onSqliteTypeChange: (column, type) => types.push([column, type]),
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
        getColumnDescriptor(SCORE_NUMBER, "sqlite", "collection")?.dialectType,
      ],
    ]);
    expect(sql).not.toMatch(/score/i);
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
