// Unit tests for the F10 PR 2 helpers that derive the journal's
// scope + per-change-kind summary from the pipeline's operation list.

import { describe, expect, it } from "vitest";

import type { Operation } from "../diff/types.js";
import {
  computeJournalScope,
  computeJournalSummaryFromOperations,
} from "../pushschema-pipeline.js";

// Tiny constructors so the tests don't need the full op shapes.
const addTable = (): Operation => ({
  type: "add_table",
  table: { name: "t", columns: [], primaryKey: undefined } as unknown as Operation extends {
    type: "add_table";
    table: infer T;
  }
    ? T
    : never,
});
const addColumn = (): Operation => ({
  type: "add_column",
  tableName: "t",
  column: { name: "c", type: "text", nullable: true } as never,
});
const dropTable = (): Operation => ({ type: "drop_table", tableName: "t" });
const dropColumn = (): Operation => ({
  type: "drop_column",
  tableName: "t",
  columnName: "c",
  columnType: "text",
});
const renameTable = (): Operation => ({
  type: "rename_table",
  fromName: "a",
  toName: "b",
});
const renameColumn = (): Operation => ({
  type: "rename_column",
  tableName: "t",
  fromColumn: "a",
  toColumn: "b",
  fromType: "text",
  toType: "text",
});
const changeType = (): Operation => ({
  type: "change_column_type",
  tableName: "t",
  columnName: "c",
  fromType: "text",
  toType: "varchar(255)",
});
const changeNullable = (): Operation => ({
  type: "change_column_nullable",
  tableName: "t",
  columnName: "c",
  fromNullable: true,
  toNullable: false,
});
const changeDefault = (): Operation => ({
  type: "change_column_default",
  tableName: "t",
  columnName: "c",
  fromDefault: undefined,
  toDefault: "''",
});

describe("computeJournalSummaryFromOperations", () => {
  it("returns zeros for empty ops", () => {
    expect(computeJournalSummaryFromOperations([])).toEqual({
      added: 0,
      removed: 0,
      renamed: 0,
      changed: 0,
    });
  });

  it("counts add_column and add_table as added", () => {
    expect(
      computeJournalSummaryFromOperations([addColumn(), addColumn(), addTable()])
    ).toEqual({ added: 3, removed: 0, renamed: 0, changed: 0 });
  });

  it("counts drop_column and drop_table as removed", () => {
    expect(
      computeJournalSummaryFromOperations([dropColumn(), dropTable()])
    ).toEqual({ added: 0, removed: 2, renamed: 0, changed: 0 });
  });

  it("counts rename_table and rename_column as renamed", () => {
    expect(
      computeJournalSummaryFromOperations([renameColumn(), renameTable()])
    ).toEqual({ added: 0, removed: 0, renamed: 2, changed: 0 });
  });

  it("counts change_column_type / nullable / default as changed", () => {
    expect(
      computeJournalSummaryFromOperations([
        changeType(),
        changeNullable(),
        changeDefault(),
      ])
    ).toEqual({ added: 0, removed: 0, renamed: 0, changed: 3 });
  });

  it("aggregates a mixed diff correctly", () => {
    expect(
      computeJournalSummaryFromOperations([
        addColumn(),
        renameColumn(),
        dropColumn(),
        changeNullable(),
        changeNullable(),
      ])
    ).toEqual({ added: 1, removed: 1, renamed: 1, changed: 2 });
  });
});

describe("computeJournalScope", () => {
  it("ui + slug -> collection scope", () => {
    expect(computeJournalScope("ui", "posts")).toEqual({
      kind: "collection",
      slug: "posts",
    });
  });

  it("code source -> global scope", () => {
    expect(computeJournalScope("code", undefined)).toEqual({ kind: "global" });
  });

  it("code source ignores any uiTargetSlug provided defensively", () => {
    expect(computeJournalScope("code", "posts")).toEqual({ kind: "global" });
  });

  it("ui without slug falls back to global (defensive)", () => {
    expect(computeJournalScope("ui", undefined)).toEqual({ kind: "global" });
  });

  it("ui with empty-string slug falls back to global (defensive)", () => {
    expect(computeJournalScope("ui", "")).toEqual({ kind: "global" });
  });
});
