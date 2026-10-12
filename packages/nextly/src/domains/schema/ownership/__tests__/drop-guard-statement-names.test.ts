/**
 * The single-statement readers a plugin module's effects are judged by
 * (`moduleEffects`): which table a statement creates, whether it creates it
 * empty, which table it writes into or drops, each by the name it is written
 * with, and which copies are a rebuild's.
 */
import { describe, expect, it } from "vitest";

import { sqliteTableRebuildStatements } from "../../pipeline/sql-templates/sqlite-rebuild";
import {
  createsEmptyTable,
  rebuildCopyStatements,
  tableInsertedInto,
  tableNamedByCreate,
  tablesDroppedIn,
} from "../drop-guard";

describe("tableNamedByCreate", () => {
  it("names the table created, a rebuild's copy under its own name", () => {
    expect(
      tableNamedByCreate('CREATE TABLE "__new_p__things" (id text)', "sqlite")
    ).toBe("__new_p__things");
    expect(
      tableNamedByCreate(
        "CREATE TEMPORARY TABLE IF NOT EXISTS scratch.P__Tmp (id int)",
        "postgresql"
      )
    ).toBe("p__tmp");
    expect(
      tableNamedByCreate("CREATE INDEX i ON p__things (id)", "postgresql")
    ).toBeUndefined();
  });
});

describe("createsEmptyTable", () => {
  it.each([
    ["postgresql", "CREATE TABLE p__copy (id int, label text)"],
    // A column's own AS, inside the body, is no query.
    [
      "postgresql",
      "CREATE TABLE p__copy (id int GENERATED ALWAYS AS IDENTITY, twice int GENERATED ALWAYS AS (id * 2) STORED)",
    ],
    // Table options after the body, a parenthesised one included.
    [
      "postgresql",
      "CREATE TABLE p__copy (id int) PARTITION BY RANGE (id) WITH (fillfactor = 70)",
    ],
    [
      "mysql",
      "CREATE TABLE p__copy (id int) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='as select'",
    ],
    [
      "mysql",
      "CREATE TABLE p__copy (id int) PARTITION BY RANGE (id) (PARTITION p0 VALUES LESS THAN (10))",
    ],
    ["sqlite", 'CREATE TABLE "p__copy" ("id" text PRIMARY KEY) WITHOUT ROWID'],
    // An expression partition key is parenthesised twice, and is no query.
    [
      "postgresql",
      "CREATE TABLE p__copy (id int) PARTITION BY RANGE ((id + 1))",
    ],
    [
      "mysql",
      "CREATE TABLE p__copy (id int) PARTITION BY HASH ((id + 1)) PARTITIONS 4",
    ],
    [
      "postgresql",
      "CREATE TABLE p__copy AS SELECT * FROM p__things WITH NO DATA",
    ],
    ["mysql", "CREATE TABLE p__copy LIKE p__things"],
    ["postgresql", "CREATE TABLE p__copy (LIKE p__things INCLUDING ALL)"],
    [
      "postgresql",
      "CREATE TABLE p__copy PARTITION OF p__things FOR VALUES IN (1)",
    ],
  ] as const)("reads %s creating an empty table: %s", (dialect, sql) => {
    expect(createsEmptyTable(sql, dialect)).toBe(true);
  });

  it.each([
    ["postgresql", "CREATE TABLE p__copy AS SELECT * FROM p__things"],
    ["postgresql", "CREATE TABLE IF NOT EXISTS p__copy AS TABLE p__things"],
    ["postgresql", "CREATE TABLE p__copy (a, b) AS VALUES (1, 2)"],
    ["postgresql", "CREATE TABLE p__copy AS EXECUTE fill_copy"],
    ["sqlite", 'CREATE TABLE "p__copy" AS SELECT id FROM p__things'],
    ["mysql", "CREATE TABLE p__copy (id int) SELECT id FROM p__things"],
    ["mysql", "CREATE TABLE p__copy (id int) IGNORE SELECT id FROM p__things"],
    ["mysql", "CREATE TABLE p__copy ENGINE=InnoDB AS SELECT id FROM p__things"],
    ["mysql", "CREATE TABLE p__copy (SELECT id FROM p__things)"],
    ["mysql", "CREATE TABLE p__copy (id int) (SELECT id FROM p__things)"],
    [
      "mysql",
      "CREATE TABLE p__copy ((SELECT id FROM p__a) UNION (SELECT id FROM p__b))",
    ],
    ["mysql", "CREATE TABLE p__copy TABLE p__things"],
    ["mysql", "CREATE TABLE p__copy VALUES ROW(1), ROW(2)"],
    // Not a CREATE TABLE at all, or one it cannot read.
    ["postgresql", "INSERT INTO p__copy SELECT * FROM p__things"],
    ["postgresql", "CREATE TABLE p__copy (id int); SELECT 1"],
  ] as const)(
    "does not read %s creating an empty table: %s",
    (dialect, sql) => {
      expect(createsEmptyTable(sql, dialect)).toBe(false);
    }
  );
});

describe("tableInsertedInto", () => {
  it("names the table written into, through each dialect's INSERT forms", () => {
    expect(
      tableInsertedInto("INSERT OR IGNORE INTO p__t (id) VALUES (1)", "sqlite")
    ).toBe("p__t");
    expect(
      tableInsertedInto("INSERT IGNORE INTO `p__t` (id) VALUES (1)", "mysql")
    ).toBe("p__t");
    expect(
      tableInsertedInto("UPDATE p__t SET id = 1", "postgresql")
    ).toBeUndefined();
  });
});

describe("tablesDroppedIn", () => {
  it.each([
    [
      "postgresql",
      'DROP TABLE IF EXISTS "p__a", p__b CASCADE',
      ["p__a", "p__b"],
    ],
    ["mysql", "DROP TEMPORARY TABLE p__tmp", ["p__tmp"]],
  ] as const)("reads %s: %s", (dialect, statement, dropped) => {
    expect(tablesDroppedIn(statement, dialect)).toEqual(dropped);
  });

  it.each([
    // A renamed table lives on under its new name.
    'ALTER TABLE "__new_p__t" RENAME TO "p__t"',
    "RENAME TABLE p__a TO p__x",
    'ALTER TABLE p__t RENAME COLUMN "a" TO "b"',
    "DROP INDEX p__t_idx",
    // A qualified name may reach another table than the one created.
    "DROP TABLE scratch.p__t",
    "INSERT INTO p__t VALUES (1)",
  ])("reads nothing dropped by: %s", statement => {
    expect(tablesDroppedIn(statement, "postgresql")).toEqual([]);
  });
});

describe("rebuildCopyStatements", () => {
  const things = {
    name: "p__things",
    columns: [
      { name: "id", type: "text", nullable: false, primaryKey: true },
      { name: "label", type: "text", nullable: false },
    ],
    indexes: [],
  };

  it("finds a generated rebuild's copy of the table's own rows", () => {
    const rebuild = sqliteTableRebuildStatements(things);
    const copy = rebuild.findIndex(statement =>
      statement.startsWith('INSERT INTO "__new_p__things"')
    );
    expect(copy).toBeGreaterThan(0);
    expect([...rebuildCopyStatements(rebuild, "sqlite")]).toEqual([copy]);
  });

  it("finds no copy whose rows come from another table", () => {
    const rebuild = sqliteTableRebuildStatements(things).map(statement =>
      statement.replace('FROM "p__things"', 'FROM "p__legacy"')
    );
    expect(rebuildCopyStatements(rebuild, "sqlite").size).toBe(0);
  });
});
