import { describe, expect, it } from "vitest";

import { buildInverseOperations } from "../down-generator";
import type {
  NextlySchemaSnapshot,
  Operation,
} from "../../pipeline/diff/types";

const PREV: NextlySchemaSnapshot = {
  tables: [
    {
      name: "dc_posts",
      columns: [
        { name: "id", type: "uuid", nullable: false },
        { name: "title", type: "text", nullable: false, default: "'x'" },
      ],
    },
  ],
};

describe("buildInverseOperations", () => {
  it("inverts add_table -> drop_table", () => {
    const ops: Operation[] = [
      { type: "add_table", table: { name: "dc_tags", columns: [] } },
    ];
    expect(buildInverseOperations(ops, PREV)).toEqual([
      { type: "drop_table", tableName: "dc_tags" },
    ]);
  });

  it("inverts drop_table -> add_table using the prev snapshot spec", () => {
    const ops: Operation[] = [{ type: "drop_table", tableName: "dc_posts" }];
    expect(buildInverseOperations(ops, PREV)).toEqual([
      { type: "add_table", table: PREV.tables[0] },
    ]);
  });

  it("inverts add_column -> drop_column carrying the column type", () => {
    const ops: Operation[] = [
      {
        type: "add_column",
        tableName: "dc_posts",
        column: { name: "slug", type: "text", nullable: true },
      },
    ];
    expect(buildInverseOperations(ops, PREV)).toEqual([
      {
        type: "drop_column",
        tableName: "dc_posts",
        columnName: "slug",
        columnType: "text",
      },
    ]);
  });

  it("inverts drop_column -> add_column using the prev column spec", () => {
    const ops: Operation[] = [
      {
        type: "drop_column",
        tableName: "dc_posts",
        columnName: "title",
        columnType: "text",
      },
    ];
    expect(buildInverseOperations(ops, PREV)).toEqual([
      {
        type: "add_column",
        tableName: "dc_posts",
        column: {
          name: "title",
          type: "text",
          nullable: false,
          default: "'x'",
        },
      },
    ]);
  });

  it("inverts rename_column to the reverse rename (data-preserving)", () => {
    const ops: Operation[] = [
      {
        type: "rename_column",
        tableName: "dc_posts",
        fromColumn: "title",
        toColumn: "name",
        fromType: "text",
        toType: "text",
      },
    ];
    expect(buildInverseOperations(ops, PREV)).toEqual([
      {
        type: "rename_column",
        tableName: "dc_posts",
        fromColumn: "name",
        toColumn: "title",
        fromType: "text",
        toType: "text",
      },
    ]);
  });

  it("inverts rename_table, change_type, change_nullable, change_default", () => {
    const ops: Operation[] = [
      { type: "rename_table", fromName: "a", toName: "b" },
      {
        type: "change_column_type",
        tableName: "t",
        columnName: "c",
        fromType: "int4",
        toType: "text",
      },
      {
        type: "change_column_nullable",
        tableName: "t",
        columnName: "c",
        fromNullable: true,
        toNullable: false,
      },
      {
        type: "change_column_default",
        tableName: "t",
        columnName: "c",
        fromDefault: undefined,
        toDefault: "0",
      },
    ];
    // reverse order + each inverted
    expect(buildInverseOperations(ops, PREV)).toEqual([
      {
        type: "change_column_default",
        tableName: "t",
        columnName: "c",
        fromDefault: "0",
        toDefault: undefined,
      },
      {
        type: "change_column_nullable",
        tableName: "t",
        columnName: "c",
        fromNullable: false,
        toNullable: true,
      },
      {
        type: "change_column_type",
        tableName: "t",
        columnName: "c",
        fromType: "text",
        toType: "int4",
      },
      { type: "rename_table", fromName: "b", toName: "a" },
    ]);
  });

  it("returns [] for empty input", () => {
    expect(buildInverseOperations([], PREV)).toEqual([]);
  });

  it("throws when a dropped column is absent from the prev snapshot", () => {
    const ops: Operation[] = [
      {
        type: "drop_column",
        tableName: "dc_posts",
        columnName: "ghost",
        columnType: "text",
      },
    ];
    expect(() => buildInverseOperations(ops, PREV)).toThrow(/ghost/);
  });
});
