import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { identifierCaseRules } from "../../../schema/utils/resolve-catalog-name";
import {
  assertNoStaleParentPointers,
  parentPointerTables,
  PARENT_TABLE_COLUMN,
} from "../parent-pointers";
import type { TableColumns } from "../reconcile";

const PRESERVING = identifierCaseRules({ dialect: "postgresql" });
const FOLDING = identifierCaseRules({
  dialect: "mysql",
  lowerCaseTableNames: 0,
});

/** A component data table's shape, as the catalog reports it. */
function dataTable(name: string): TableColumns {
  return {
    table: name,
    columns: ["id", "_parent_id", PARENT_TABLE_COLUMN, "_parent_field"],
  };
}

describe("parentPointerTables", () => {
  it("selects tables carrying the parent-pointer column", () => {
    const tables = parentPointerTables({
      columns: [dataTable("comp_hero"), dataTable("comp_cta")],
      identifierCase: PRESERVING,
    });
    expect(tables).toEqual(["comp_hero", "comp_cta"]);
  });

  // A collection table has no pointer column, and a localization companion keys
  // on `_parent` instead. Scanning either would be work with no rows to find,
  // and updating one would write a column that means something else.
  it("ignores tables that store no embedded instances", () => {
    const tables = parentPointerTables({
      columns: [
        { table: "dc_pages", columns: ["id", "title", "slug"] },
        { table: "comp_hero_locales", columns: ["_parent", "_locale", "body"] },
        dataTable("comp_hero"),
      ],
      identifierCase: PRESERVING,
    });
    expect(tables).toEqual(["comp_hero"]);
  });

  // The identity of a table is its shape, not its name: a group named through
  // `dbName` carries no recognisable prefix, and a table orphaned by a deleted
  // registry row appears in no plan. A pointer missed in either is content that
  // stops resolving.
  it("selects a table whose name carries no field-group prefix", () => {
    const tables = parentPointerTables({
      columns: [dataTable("handwritten")],
      identifierCase: PRESERVING,
    });
    expect(tables).toEqual(["handwritten"]);
  });

  // MySQL compares column names case-insensitively on every server, so a
  // catalog reporting `_PARENT_TABLE` is reporting the same column.
  it("matches the column under the server's own case rules", () => {
    const columns = [{ table: "comp_hero", columns: ["_PARENT_TABLE"] }];
    expect(parentPointerTables({ columns, identifierCase: FOLDING })).toEqual([
      "comp_hero",
    ]);
    expect(
      parentPointerTables({ columns, identifierCase: PRESERVING })
    ).toEqual([]);
  });
});

describe("assertNoStaleParentPointers", () => {
  /**
   * A stand-in that compiles what it is handed through a real Drizzle dialect,
   * which is what an adapter hands its driver. Inspecting the template object
   * instead would accept identifiers this dialect refuses to quote.
   */
  function recorder(rowsFor: Record<string, string> = {}) {
    const statements: { sql: string; params: unknown[] }[] = [];
    const query = async (statement: SQL) => {
      const compiled = new PgDialect().sqlToQuery(statement);
      statements.push({ sql: compiled.sql, params: compiled.params });
      const table = /FROM "(.+?)"/.exec(compiled.sql.replace(/\s+/g, " "))?.[1];
      const held = table === undefined ? undefined : rowsFor[table];
      // The WHERE is applied rather than ignored. A double that answered every
      // query with a row would pass a filter that matches nothing, which is
      // exactly the distinction this function exists to draw.
      if (held === undefined || !compiled.params.includes(held)) return [];
      return [{ [PARENT_TABLE_COLUMN]: held }];
    };
    return { query, statements };
  }

  const columns = [dataTable("comp_inner"), dataTable("comp_outer")];

  it("passes when no row addresses a renamed-away name", async () => {
    const { query, statements } = recorder();
    await expect(
      assertNoStaleParentPointers({
        query,
        columns,
        identifierCase: PRESERVING,
        staleNames: ["comp_outer"],
      })
    ).resolves.toBeUndefined();
    expect(statements).toHaveLength(2);
  });

  // The failure this exists for: a data table no step ever observed, or one that
  // gained a stale pointer while the run was in flight. Refusing before the
  // marker settles keeps the damage to a migration an operator must finish
  // rather than content a reader finds missing.
  it("refuses when a row still addresses a renamed-away name", async () => {
    const { query } = recorder({ comp_inner: "comp_outer" });
    await expect(
      assertNoStaleParentPointers({
        query,
        columns,
        identifierCase: PRESERVING,
        staleNames: ["comp_outer"],
      })
    ).rejects.toMatchObject({
      logContext: {
        reason: "a parent pointer still names storage this run renamed away",
        table: "comp_inner",
        pointer: "comp_outer",
      },
    });
  });

  // A pointer at a table this run never renamed is a legitimate parent, not a
  // leftover: every top-level instance holds one.
  it("accepts a pointer at a table the run did not rename", async () => {
    const { query } = recorder({ comp_inner: "dc_pages" });
    await expect(
      assertNoStaleParentPointers({
        query,
        columns,
        identifierCase: PRESERVING,
        staleNames: ["comp_outer"],
      })
    ).resolves.toBeUndefined();
  });

  // One pass per table rather than one per table per rename: the whole set of
  // renamed-away names is asked at once, so a plan with fifty field groups costs
  // fifty scans rather than two and a half thousand.
  it("asks every renamed-away name in a single statement per table", async () => {
    const { query, statements } = recorder();
    await assertNoStaleParentPointers({
      query,
      columns,
      identifierCase: PRESERVING,
      staleNames: ["comp_outer", "comp_aside", "comp_hero"],
    });

    expect(statements).toHaveLength(2);
    expect(statements[0]?.params).toEqual([
      "comp_outer",
      "comp_aside",
      "comp_hero",
    ]);
  });

  // Nothing was renamed, so no name can be stale and every scan would be waste.
  it("reads nothing when the run renamed no tables", async () => {
    const { query, statements } = recorder({ comp_inner: "comp_outer" });
    await expect(
      assertNoStaleParentPointers({
        query,
        columns,
        identifierCase: PRESERVING,
        staleNames: [],
      })
    ).resolves.toBeUndefined();
    expect(statements).toEqual([]);
  });
});
