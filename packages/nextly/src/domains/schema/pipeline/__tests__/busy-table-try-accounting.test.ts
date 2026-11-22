/**
 * What a schema pipeline apply counts of its tries for a busy table: which statements a try that
 * ended waiting left applied, how statements are handed over one at a time, and what an apply
 * whose earlier tries committed part of it reports in all.
 */
import { describe, expect, it } from "vitest";

import type { Operation } from "../diff/types";
import {
  committedOf,
  isSchemaStatement,
  statementsOneByOne,
  withEarlierTries,
  type PlannedApply,
} from "../pushschema-pipeline";

const addColumn = (table: string, name: string) =>
  ({
    type: "add_column",
    tableName: table,
    column: { name, type: "text", nullable: true },
  }) as unknown as Operation;

describe("the statements a MySQL try left applied", () => {
  it("keeps the row changes before a schema statement that waited, which committed them", () => {
    // ALTER, UPDATE finished; the next ALTER waited after committing the UPDATE.
    expect(committedOf([true, false], "mysql", true)).toBe(2);
  });

  it("rolls back the row changes after the last schema statement where a row change waited", () => {
    // ALTER, UPDATE finished; a second UPDATE waited for a row: the first UPDATE rolled back.
    expect(committedOf([true, false], "mysql", false)).toBe(1);
    expect(committedOf([false, false], "mysql", false)).toBe(0);
  });

  it("keeps every statement on SQLite, where each committed as it ran", () => {
    expect(committedOf([true, false], "sqlite", false)).toBe(2);
  });

  it("knows a schema statement past a leading comment", () => {
    expect(
      isSchemaStatement("/* nextly-lock:x */ ALTER TABLE t ADD c int")
    ).toBe(true);
    expect(isSchemaStatement("-- note\nDROP TABLE t")).toBe(true);
    expect(isSchemaStatement("UPDATE t SET c = 1")).toBe(false);
  });
});

describe("statements handed over one at a time", () => {
  it("splits SQLite's elements at their statement breakpoints", () => {
    expect(
      statementsOneByOne(
        [
          "ALTER TABLE t ADD a text;\n--> statement-breakpoint\nALTER TABLE t ADD b text;",
          "CREATE INDEX i ON t (a);",
        ],
        "sqlite"
      )
    ).toEqual([
      "ALTER TABLE t ADD a text;",
      "ALTER TABLE t ADD b text;",
      "CREATE INDEX i ON t (a);",
    ]);
  });

  it("leaves MySQL's as they are", () => {
    expect(statementsOneByOne(["ALTER TABLE t ADD a text"], "mysql")).toEqual([
      "ALTER TABLE t ADD a text",
    ]);
  });
});

describe("an apply whose earlier tries committed part of it", () => {
  const last: PlannedApply = {
    statementsExecuted: 1,
    resolvedOps: [addColumn("t", "later")],
    renamesApplied: 0,
    moved: [],
  };

  it("adds what earlier tries applied, once, and what the last try planned again only once", () => {
    const earlier = {
      resolvedOps: [addColumn("t", "late"), addColumn("t", "later")],
      moved: [],
    };
    // The same change, its keys in another order: still one change.
    const reordered = {
      resolvedOps: [
        {
          column: { type: "text", nullable: true, name: "late" },
          tableName: "t",
          type: "add_column",
        } as unknown as Operation,
      ],
      moved: [],
    };
    const all = withEarlierTries(last, [earlier, reordered], 1);
    expect(all.statementsExecuted).toBe(2);
    expect(all.resolvedOps).toEqual([
      addColumn("t", "late"),
      addColumn("t", "later"),
    ]);
  });
});
