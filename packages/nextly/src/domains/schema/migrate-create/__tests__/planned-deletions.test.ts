// What a planned migration deletes, read from its operations: every table and
// column it drops, every type change that clears values, and every row a
// person's answer removes. One list, which the file's header names and the
// command lists, counts and asks consent for.
import { describe, expect, it } from "vitest";

import type { Operation } from "../../pipeline/diff/types";
import { plannedDeletions } from "../planned-deletions";

const dropTable = (tableName: string): Operation => ({
  type: "drop_table",
  tableName,
});
const dropColumn = (tableName: string, columnName: string): Operation => ({
  type: "drop_column",
  tableName,
  columnName,
  columnType: "text",
});

describe("plannedDeletions", () => {
  it("names a table the config no longer declares", () => {
    expect(plannedDeletions({ operations: [dropTable("dc_posts")] })).toEqual([
      { kind: "table", table: "dc_posts", reason: "no longer in the config" },
    ]);
  });

  it("names a dropped column, and a declined rename as the rename declined", () => {
    expect(
      plannedDeletions({
        operations: [
          dropColumn("dc_pages", "summary"),
          {
            type: "add_column",
            tableName: "dc_pages",
            column: { name: "excerpt", type: "text", nullable: true },
          },
          dropColumn("dc_pages", "legacy"),
        ],
        declinedRenames: [
          { tableName: "dc_pages", fromColumn: "summary", toColumn: "excerpt" },
        ],
      })
    ).toEqual([
      {
        kind: "column",
        table: "dc_pages",
        column: "legacy",
        reason: "no longer in the config",
      },
      {
        kind: "column",
        table: "dc_pages",
        column: "summary",
        reason: "rename to excerpt declined",
      },
    ]);
  });

  it("names every rename declined for one column", () => {
    const [deletion] = plannedDeletions({
      operations: [dropColumn("dc_pages", "summary")],
      declinedRenames: [
        { tableName: "dc_pages", fromColumn: "summary", toColumn: "excerpt" },
        { tableName: "dc_pages", fromColumn: "summary", toColumn: "teaser" },
      ],
    });
    expect(deletion).toMatchObject({
      reason: "rename to excerpt or teaser declined",
    });
  });

  it("names a type change that clears values as a deletion in its column", () => {
    expect(
      plannedDeletions({
        operations: [
          {
            type: "change_column_type",
            tableName: "dc_products",
            columnName: "price",
            fromType: "text",
            toType: "integer",
            clearsValues: true,
          },
          // A type change that keeps every value deletes nothing.
          {
            type: "change_column_type",
            tableName: "dc_products",
            columnName: "title",
            fromType: "varchar(100)",
            toType: "varchar(255)",
          },
        ],
      })
    ).toEqual([
      {
        kind: "column",
        table: "dc_products",
        column: "price",
        clearsSome: true,
        reason: "text to integer clears the values integer cannot hold",
      },
    ]);
  });

  it("names the rows a person's answer removes, and not the rows it fills", () => {
    expect(
      plannedDeletions({
        operations: [],
        resolutions: [
          {
            tableName: "dc_posts",
            columnName: "author",
            kind: "delete_nonconforming",
          },
          {
            tableName: "dc_posts",
            columnName: "title",
            kind: "fill",
            value: "x",
          },
        ],
      })
    ).toEqual([
      {
        kind: "rows",
        table: "dc_posts",
        reason: "rows with no author removed, so the column can be required",
      },
    ]);
  });

  it("deletes nothing for operations that keep every value", () => {
    expect(
      plannedDeletions({
        operations: [
          { type: "rename_table", fromName: "dc_a", toName: "dc_b" },
          {
            type: "rename_column",
            tableName: "dc_b",
            fromColumn: "x",
            toColumn: "y",
            fromType: "text",
            toType: "text",
          },
          {
            type: "drop_index",
            tableName: "dc_b",
            index: { name: "dc_b_y_idx", columns: ["y"], unique: false },
          },
        ],
      })
    ).toEqual([]);
  });

  it("lists tables before columns, each in name order, whatever the plan's order", () => {
    const listed = plannedDeletions({
      operations: [
        dropColumn("dc_b", "z"),
        dropTable("dc_z"),
        dropColumn("dc_a", "y"),
        dropTable("dc_c"),
      ],
    }).map(d =>
      d.kind === "column"
        ? `${d.table}.${d.column}`
        : d.kind === "unnamed"
          ? d.description
          : d.table
    );
    expect(listed).toEqual(["dc_c", "dc_z", "dc_a.y", "dc_b.z"]);
  });
});
