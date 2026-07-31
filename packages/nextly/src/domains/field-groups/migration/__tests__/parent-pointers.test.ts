import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { identifierCaseRules } from "../../../schema/utils/resolve-catalog-name";
import {
  assertNoStaleParentPointers,
  ownedDataTableNames,
  parentPointerTables,
  PARENT_TABLE_COLUMN,
} from "../parent-pointers";
import type { ManifestEntry } from "../manifest";
import type { TableColumns } from "../reconcile";

const PRESERVING = identifierCaseRules({ dialect: "postgresql" });
/** MySQL as configured to keep table names, where only COLUMNS fold. */
const FOLDING = identifierCaseRules({
  dialect: "mysql",
  lowerCaseTableNames: 0,
});
/** MySQL as configured to lowercase table names, where both fold. */
const FOLDING_TABLES = identifierCaseRules({
  dialect: "mysql",
  lowerCaseTableNames: 1,
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
      owned: ["comp_hero", "comp_cta"],
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
      owned: ["dc_pages", "comp_hero_locales", "comp_hero"],
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
      owned: ["handwritten"],
    });
    expect(tables).toEqual(["handwritten"]);
  });

  // 🔴 Nextly runs inside the user's own database, beside tables it did not
  // create. A predicate that recognised field-group storage by shape alone
  // would classify an application table carrying the same column as storage to
  // rewrite, and every rename step would then write into it — silently changing
  // any value that happened to match a renamed name.
  it("ignores a table Nextly does not own, whatever its shape", () => {
    const tables = parentPointerTables({
      columns: [dataTable("app_tree"), dataTable("comp_hero")],
      identifierCase: PRESERVING,
      owned: ["comp_hero"],
    });
    expect(tables).toEqual(["comp_hero"]);
  });

  // Ownership is matched under the server's rules too, and those differ between
  // tables and columns on MySQL: `lower_case_table_names=1` reports a
  // lowercased name for a table stored under a mixed-case one, so an exact
  // comparison would read a table Nextly owns as one it does not. With the
  // setting off, the two spellings really are different tables and the same
  // comparison must NOT match.
  it("matches an owned name under the server's own table rules", () => {
    const columns = [dataTable("comp_hero")];
    expect(
      parentPointerTables({
        columns,
        identifierCase: FOLDING_TABLES,
        owned: ["COMP_HERO"],
      })
    ).toEqual(["comp_hero"]);
    expect(
      parentPointerTables({
        columns,
        identifierCase: FOLDING,
        owned: ["COMP_HERO"],
      })
    ).toEqual([]);
  });

  // MySQL compares column names case-insensitively on every server, so a
  // catalog reporting `_PARENT_TABLE` is reporting the same column.
  it("matches the column under the server's own case rules", () => {
    const columns = [{ table: "comp_hero", columns: ["_PARENT_TABLE"] }];
    const owned = ["comp_hero"];
    expect(
      parentPointerTables({ columns, identifierCase: FOLDING, owned })
    ).toEqual(["comp_hero"]);
    expect(
      parentPointerTables({ columns, identifierCase: PRESERVING, owned })
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
  const OWNED = ["comp_inner", "comp_outer"];

  it("passes when no row addresses a renamed-away name", async () => {
    const { query, statements } = recorder();
    await expect(
      assertNoStaleParentPointers({
        query,
        columns,
        identifierCase: PRESERVING,
        owned: OWNED,
        maxParams: 65535,
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
        owned: OWNED,
        maxParams: 65535,
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
        owned: OWNED,
        maxParams: 65535,
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
      owned: OWNED,
      maxParams: 65535,
      staleNames: ["comp_outer", "comp_aside", "comp_hero"],
    });

    expect(statements).toHaveLength(2);
    expect(statements[0]?.params).toEqual([
      "comp_outer",
      "comp_aside",
      "comp_hero",
    ]);
  });

  // 🔴 SQLite advertises 999 bound parameters where the other two advertise
  // 65535, and exceeding it fails the statement outright. This runs AFTER every
  // rename has committed, so an over-long list would strand a finished
  // migration in flight rather than merely reporting slowly.
  it("splits the stale names by the driver's parameter limit", async () => {
    const { query, statements } = recorder();
    const staleNames = Array.from({ length: 7 }, (_, i) => `comp_${String(i)}`);

    await assertNoStaleParentPointers({
      query,
      columns,
      identifierCase: PRESERVING,
      owned: OWNED,
      maxParams: 3,
      staleNames,
    });

    // Three batches per table, two tables, and no batch over the limit.
    expect(statements).toHaveLength(6);
    for (const statement of statements) {
      expect(statement.params.length).toBeLessThanOrEqual(3);
    }
    // Every name is still asked about — chunking must not drop any.
    expect(statements.slice(0, 3).flatMap(s => s.params)).toEqual(staleNames);
  });

  // A limit below one would produce empty batches and loop forever asking
  // nothing; it is clamped rather than trusted.
  it("still asks every name when the reported limit is nonsense", async () => {
    const { query, statements } = recorder();
    await assertNoStaleParentPointers({
      query,
      columns,
      identifierCase: PRESERVING,
      owned: OWNED,
      maxParams: 0,
      staleNames: ["comp_outer", "comp_aside"],
    });
    expect(statements.slice(0, 2).flatMap(s => s.params)).toEqual([
      "comp_outer",
      "comp_aside",
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
        owned: OWNED,
        maxParams: 65535,
        staleNames: [],
      })
    ).resolves.toBeUndefined();
    expect(statements).toEqual([]);
  });
});

describe("ownedDataTableNames", () => {
  const entries: ManifestEntry[] = [
    { kind: "table", from: "comp_hero", to: "fg_hero" },
    {
      kind: "column",
      from: "_component_type",
      to: "_field_group_type",
      table: "fg_hero",
    },
    {
      kind: "registry",
      from: "dynamic_components",
      to: "dynamic_field_groups",
    },
  ];

  // A step addresses whichever spelling the catalog currently holds, and a
  // resumed run can meet either: some renames have committed, some have not.
  it("claims both spellings of every renamed table", () => {
    const owned = ownedDataTableNames({ rows: [], entries });
    expect(owned).toContain("comp_hero");
    expect(owned).toContain("fg_hero");
  });

  // A field group whose table was named through `dbName` is renamed by nothing
  // and appears in no entry, yet it still holds instances that can be nested
  // inside a group that IS renamed. Deriving the set from the plan alone would
  // leave its pointers stale.
  it("claims a registry table the plan renames nothing of", () => {
    expect(
      ownedDataTableNames({ rows: [{ tableName: "handwritten" }], entries })
    ).toContain("handwritten");
  });

  // Neither the registry nor the discriminator column is addressed by an
  // instance, so neither belongs in a set used to decide what to rewrite.
  it("claims no name from a registry or column entry", () => {
    const owned = ownedDataTableNames({ rows: [], entries });
    expect(owned).not.toContain("dynamic_components");
    expect(owned).not.toContain("dynamic_field_groups");
    expect(owned).not.toContain("_component_type");
  });

  it("claims each name once when the registry and the plan agree", () => {
    const owned = ownedDataTableNames({
      rows: [{ tableName: "comp_hero" }],
      entries,
    });
    expect(owned.filter(name => name === "comp_hero")).toHaveLength(1);
  });
});
