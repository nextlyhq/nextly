import { describe, expect, it } from "vitest";

import type { AddColumnOp, DropColumnOp, Operation } from "../../diff/types.js";
import {
  applyResolutionsToOperations,
  type RenameResolution,
} from "../apply-resolutions.js";

const drop = (
  tableName: string,
  columnName: string,
  columnType = "text"
): DropColumnOp => ({
  type: "drop_column",
  tableName,
  columnName,
  columnType,
});

const add = (
  tableName: string,
  columnName: string,
  type = "text"
): AddColumnOp => ({
  type: "add_column",
  tableName,
  column: { name: columnName, type, nullable: true },
});

describe("applyResolutionsToOperations - empty resolutions", () => {
  it("returns input unchanged when there are no resolutions", () => {
    const ops: Operation[] = [
      drop("dc_posts", "title"),
      add("dc_posts", "name"),
    ];
    expect(applyResolutionsToOperations(ops, [])).toEqual(ops);
  });

  it("preserves non-rename ops untouched", () => {
    const ops: Operation[] = [
      {
        type: "change_column_type",
        tableName: "dc_posts",
        columnName: "x",
        fromType: "text",
        toType: "varchar",
      },
      { type: "drop_table", tableName: "dc_old" },
    ];
    expect(applyResolutionsToOperations(ops, [])).toEqual(ops);
  });
});

describe("applyResolutionsToOperations - confirmed rename", () => {
  it("merges drop+add into a single rename_column when resolution is 'rename'", () => {
    const ops: Operation[] = [
      drop("dc_posts", "title", "text"),
      add("dc_posts", "name", "text"),
    ];
    const resolutions: RenameResolution[] = [
      {
        tableName: "dc_posts",
        fromColumn: "title",
        toColumn: "name",
        choice: "rename",
      },
    ];

    const out = applyResolutionsToOperations(ops, resolutions);

    expect(out).toEqual([
      {
        type: "rename_column",
        tableName: "dc_posts",
        fromColumn: "title",
        toColumn: "name",
        fromType: "text",
        toType: "text",
      },
    ]);
  });

  it("preserves drop+add when resolution is 'drop_and_add'", () => {
    const ops: Operation[] = [
      drop("dc_posts", "title"),
      add("dc_posts", "name"),
    ];
    const resolutions: RenameResolution[] = [
      {
        tableName: "dc_posts",
        fromColumn: "title",
        toColumn: "name",
        choice: "drop_and_add",
      },
    ];

    const out = applyResolutionsToOperations(ops, resolutions);

    // Both ops survive; drop_and_add is the "no rename" path.
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ type: "drop_column", columnName: "title" });
    expect(out[1]).toMatchObject({
      type: "add_column",
      column: { name: "name" },
    });
  });
});

describe("applyResolutionsToOperations - multi-rename within one table", () => {
  it("merges multiple confirmed renames; non-confirmed pairs survive as drop+add", () => {
    const ops: Operation[] = [
      drop("dc_user", "name"),
      drop("dc_user", "phone"),
      drop("dc_user", "age", "int4"),
      add("dc_user", "full_name"),
      add("dc_user", "mobile_number"),
      add("dc_user", "dob", "date"),
    ];

    // User confirms two renames; leaves age + dob as drop_and_add.
    const resolutions: RenameResolution[] = [
      {
        tableName: "dc_user",
        fromColumn: "name",
        toColumn: "full_name",
        choice: "rename",
      },
      {
        tableName: "dc_user",
        fromColumn: "phone",
        toColumn: "mobile_number",
        choice: "rename",
      },
    ];

    const out = applyResolutionsToOperations(ops, resolutions);

    // Expect 2 rename_column + 1 drop_column (age) + 1 add_column (dob).
    const renames = out.filter(o => o.type === "rename_column");
    const drops = out.filter(o => o.type === "drop_column");
    const adds = out.filter(o => o.type === "add_column");

    expect(renames).toHaveLength(2);
    expect(drops).toHaveLength(1);
    expect(drops[0]).toMatchObject({ columnName: "age" });
    expect(adds).toHaveLength(1);
    expect(adds[0]).toMatchObject({ column: { name: "dob" } });
  });
});

describe("applyResolutionsToOperations - resolution targets a non-existent op pair", () => {
  it("ignores resolutions that don't match any drop+add pair (defensive)", () => {
    const ops: Operation[] = [drop("dc_posts", "title")];
    // No matching add_column for "name" - resolution can't apply.
    const resolutions: RenameResolution[] = [
      {
        tableName: "dc_posts",
        fromColumn: "title",
        toColumn: "name",
        choice: "rename",
      },
    ];

    const out = applyResolutionsToOperations(ops, resolutions);

    // The drop survives unchanged.
    expect(out).toEqual([drop("dc_posts", "title")]);
  });
});

describe("applyResolutionsToOperations - cross-table isolation", () => {
  it("doesn't merge drop and add from different tables", () => {
    const ops: Operation[] = [
      drop("dc_posts", "title"),
      add("dc_users", "name"),
    ];
    const resolutions: RenameResolution[] = [
      {
        tableName: "dc_posts",
        fromColumn: "title",
        toColumn: "name",
        choice: "rename",
      },
    ];

    const out = applyResolutionsToOperations(ops, resolutions);

    // Cross-table merge MUST NOT happen - the resolution refers to dc_posts
    // but the add_column is on dc_users. Both ops survive untouched.
    expect(out).toHaveLength(2);
  });
});
