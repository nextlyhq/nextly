/**
 * The single-statement readers a plugin module's effects are judged by
 * (`moduleEffects`): which table a statement creates, writes into, or drops
 * or renames away, each by the name it is written with.
 */
import { describe, expect, it } from "vitest";

import {
  tableInsertedInto,
  tableNamedByCreate,
  tablesRemovedBy,
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

describe("tablesRemovedBy", () => {
  it.each([
    [
      "postgresql",
      'DROP TABLE IF EXISTS "p__a", p__b CASCADE',
      ["p__a", "p__b"],
    ],
    ["sqlite", 'ALTER TABLE "__new_p__t" RENAME TO "p__t"', ["__new_p__t"]],
    ["postgresql", "ALTER TABLE IF EXISTS ONLY p__t RENAME TO p__u", ["p__t"]],
    ["mysql", "RENAME TABLE p__a TO p__x, p__b TO p__y", ["p__a", "p__b"]],
  ] as const)("reads %s: %s", (dialect, statement, removed) => {
    expect(tablesRemovedBy(statement, dialect)).toEqual(removed);
  });

  it.each([
    // A column rename keeps the table.
    'ALTER TABLE p__t RENAME COLUMN "a" TO "b"',
    "DROP INDEX p__t_idx",
    // A qualified name may reach another table than the one created.
    "DROP TABLE scratch.p__t",
    "INSERT INTO p__t VALUES (1)",
  ])("reads nothing removed by: %s", statement => {
    expect(tablesRemovedBy(statement, "postgresql")).toEqual([]);
  });
});
