/**
 * Who may drop a table or a column that a record does or does not claim.
 *
 * A table with no owner row is the app's to drop — the app stream carries
 * every collection table, and none has a row — but never a plugin's: it may
 * be the app's data from before the registry existed. A core table is core's
 * though no row names it. A column is held by the stream its element row
 * names, or by the stream whose earlier migrations contributed it, and
 * otherwise belongs to its table.
 */
import { describe, expect, it } from "vitest";

import type { SupportedDialect } from "../../../../database/schema-registry";
import { NextlyError } from "../../../../errors/nextly-error";
import type { ContributedElements } from "../../pipeline/diff/types";
import { assertNoForeignDrops } from "../drop-guard";
import type { OwnerRecord } from "../owner-registry";

const DIALECTS: SupportedDialect[] = ["postgresql", "mysql", "sqlite"];

function record(over: Partial<OwnerRecord>): OwnerRecord {
  return {
    tableName: "unused",
    ownerKind: "plugin",
    ownerId: "fx",
    migratedBy: "plugin:fx",
    ownerVersion: "1.0.0",
    schemaVersion: 1,
    state: "active",
    ...over,
  };
}

/** `app_notes` is the app's; `fx__notes` is the plugin's. */
const owners = new Map<string, OwnerRecord>([
  [
    "app_notes",
    record({
      tableName: "app_notes",
      ownerKind: "app",
      ownerId: "app",
      migratedBy: "app",
    }),
  ],
  ["fx__notes", record({ tableName: "fx__notes" })],
]);

/** `status` on the app's table is a column the plugin contributed. */
const elementOwners: OwnerRecord[] = [
  ...owners.values(),
  record({
    tableName: "app_notes",
    elementKind: "column",
    elementName: "status",
  }),
];

function guard(
  statements: string[],
  stream: string,
  dialect: SupportedDialect = "postgresql",
  ownedElements?: Record<string, ContributedElements>
): void {
  assertNoForeignDrops({
    statements,
    stream,
    owners,
    elementOwners,
    ownedElements,
    dialect,
    source: "0009_under_test",
    // The database holds the recorded tables, a collection's table and core
    // users; a table a list creates under any other name is new.
    liveTables: new Set([...owners.keys(), "legacy_orders", "users"]),
  });
}

/** The refusal's log context, or a failure when nothing was refused. */
function refusal(run: () => void): Record<string, unknown> {
  try {
    run();
  } catch (error) {
    expect(NextlyError.is(error)).toBe(true);
    expect((error as NextlyError).code).toBe("DROP_OF_FOREIGN_TABLE");
    return (error as NextlyError).logContext ?? {};
  }
  return expect.unreachable("must be refused");
}

describe.each(DIALECTS)("a table no owner row claims, on %s", dialect => {
  it("is refused to a plugin migration", () => {
    expect(
      refusal(() => guard(["DROP TABLE legacy_orders"], "plugin:fx", dialect))
    ).toMatchObject({
      table: "legacy_orders",
      droppedBy: "plugin:fx",
      belongsTo: null,
    });
  });

  it("is refused to a plugin migration renaming it", () => {
    expect(
      refusal(() =>
        guard(
          ["ALTER TABLE legacy_orders RENAME TO fx__orders"],
          "plugin:fx",
          dialect
        )
      )
    ).toMatchObject({ table: "legacy_orders", renamedBy: "plugin:fx" });
  });

  it("is the app's own to drop", () => {
    // The control: a collection's table has no row, and the app's migration
    // removing the collection drops it.
    expect(() =>
      guard(["DROP TABLE legacy_orders"], "app", dialect)
    ).not.toThrow();
  });

  it("is the plugin's to drop when the same list created it", () => {
    expect(() =>
      guard(
        [
          "CREATE TABLE fx__scratch (id INT)",
          "ALTER TABLE fx__scratch RENAME TO fx__scratch2",
          "DROP TABLE fx__scratch2",
        ],
        "plugin:fx",
        dialect
      )
    ).not.toThrow();
  });

  it("is not the plugin's when the create may have created nothing", () => {
    // `IF NOT EXISTS` leaves an existing table in place, so the drop after
    // it takes that table.
    expect(() =>
      guard(
        [
          "CREATE TABLE IF NOT EXISTS legacy_orders (id INT)",
          "DROP TABLE legacy_orders",
        ],
        "plugin:fx",
        dialect
      )
    ).toThrow(NextlyError);
  });

  it("is not the plugin's after the table it created was dropped once", () => {
    // A temporary table can shadow a real one by name: the first drop takes
    // the temporary one, the second the real one.
    expect(() =>
      guard(
        [
          "CREATE TEMPORARY TABLE legacy_orders (id INT)",
          "DROP TABLE legacy_orders",
          "DROP TABLE legacy_orders",
        ],
        "plugin:fx",
        dialect
      )
    ).toThrow(NextlyError);
  });
});

describe("a create inside a routine body", () => {
  it("creates nothing where it is written, so a later drop is judged", () => {
    expect(() =>
      guard(
        [
          "CREATE FUNCTION f() RETURNS void AS $$ CREATE TABLE legacy_orders (id int); $$ LANGUAGE sql",
          "DROP TABLE legacy_orders",
        ],
        "plugin:fx"
      )
    ).toThrow(NextlyError);
  });
});

describe.each(DIALECTS)("a core table, on %s", dialect => {
  it("is refused to an app migration although no row names it", () => {
    expect(
      refusal(() => guard(["DROP TABLE users"], "app", dialect))
    ).toMatchObject({ table: "users", belongsTo: "core", ownerId: "nextly" });
  });

  it("is refused to a plugin migration", () => {
    expect(() => guard(["DROP TABLE users"], "plugin:fx", dialect)).toThrow(
      NextlyError
    );
  });
});

describe("a column another stream's element row records", () => {
  it.each<[SupportedDialect, string]>([
    ["postgresql", "ALTER TABLE app_notes DROP COLUMN status"],
    [
      "postgresql",
      "ALTER TABLE app_notes DROP COLUMN IF EXISTS status CASCADE",
    ],
    ["postgresql", 'ALTER TABLE ONLY "app_notes" DROP "status"'],
    ["mysql", "ALTER TABLE `app_notes` DROP `status`"],
    ["mysql", "ALTER TABLE app_notes DROP COLUMN status"],
    ["sqlite", 'ALTER TABLE "app_notes" DROP COLUMN "status"'],
    // Behind a clause the app is entitled to, in the same statement.
    [
      "postgresql",
      "ALTER TABLE app_notes ADD COLUMN extra int, DROP COLUMN status",
    ],
    ["mysql", "ALTER TABLE app_notes ADD COLUMN extra int, DROP status"],
    // A rename takes the column from the name its row records.
    ["postgresql", "ALTER TABLE app_notes RENAME COLUMN status TO state"],
    ["postgresql", "ALTER TABLE app_notes RENAME status TO state"],
    ["sqlite", 'ALTER TABLE "app_notes" RENAME "status" TO "state"'],
    ["mysql", "ALTER TABLE app_notes RENAME COLUMN status TO state"],
    ["mysql", "ALTER TABLE app_notes CHANGE status state varchar(20)"],
    ["mysql", "ALTER TABLE app_notes CHANGE COLUMN status state varchar(20)"],
    // Upper case, as PostgreSQL folds it.
    ["postgresql", "ALTER TABLE APP_NOTES DROP COLUMN STATUS"],
  ])("is refused to the app's migration on %s: %s", (dialect, statement) => {
    expect(refusal(() => guard([statement], "app", dialect))).toMatchObject({
      table: "app_notes",
      column: "status",
      droppedBy: "app",
      belongsTo: "plugin:fx",
    });
  });

  it.each<[SupportedDialect, string]>([
    ["postgresql", "ALTER TABLE app_notes DROP COLUMN status"],
    ["mysql", "ALTER TABLE app_notes DROP status"],
    ["sqlite", 'ALTER TABLE "app_notes" DROP COLUMN "status"'],
  ])("is the recorded stream's to drop on %s: %s", (dialect, statement) => {
    // The control: the plugin that contributed it removes it.
    expect(() => guard([statement], "plugin:fx", dialect)).not.toThrow();
  });

  it.each<[SupportedDialect, string]>([
    // Another column, the app's own, on the app's own table.
    ["postgresql", "ALTER TABLE app_notes DROP COLUMN body"],
    ["mysql", "ALTER TABLE app_notes DROP body"],
    // Clauses that drop something other than the column.
    ["postgresql", "ALTER TABLE app_notes ALTER COLUMN status DROP DEFAULT"],
    ["postgresql", "ALTER TABLE app_notes ALTER COLUMN status DROP NOT NULL"],
    ["postgresql", "ALTER TABLE app_notes DROP CONSTRAINT status"],
    ["mysql", "ALTER TABLE app_notes DROP INDEX status"],
    ["mysql", "ALTER TABLE app_notes DROP CHECK status"],
    ["mysql", "ALTER TABLE app_notes ALTER status DROP DEFAULT"],
    // A redefinition that keeps the name.
    ["mysql", "ALTER TABLE app_notes CHANGE status status varchar(40)"],
    ["mysql", "ALTER TABLE app_notes MODIFY status varchar(40)"],
    // The table renamed, not the column.
    ["postgresql", "ALTER TABLE app_notes RENAME TO app_notes_v2"],
    ["mysql", "ALTER TABLE app_notes RENAME AS app_notes_v2"],
  ])("leaves what takes no foreign column alone on %s: %s", (dialect, sql) => {
    expect(() => guard([sql], "app", dialect)).not.toThrow();
  });
});

describe("a column no element row records", () => {
  it("belongs to its table: the app may not drop a plugin table's column", () => {
    expect(
      refusal(() => guard(["ALTER TABLE fx__notes DROP COLUMN body"], "app"))
    ).toMatchObject({
      table: "fx__notes",
      column: "body",
      belongsTo: "plugin:fx",
    });
  });

  it("is a plugin's own on its own table", () => {
    expect(() =>
      guard(["ALTER TABLE fx__notes DROP COLUMN body"], "plugin:fx")
    ).not.toThrow();
  });

  it("is the stream's when its earlier migrations contributed it", () => {
    // Every module of a fresh install runs in one migrate, and element rows
    // are written once it ends: the contribution is known from the modules.
    const statement = ["ALTER TABLE fx__notes DROP COLUMN app_extra"];
    expect(() => guard(statement, "app")).toThrow(NextlyError);
    expect(() =>
      guard(statement, "app", "postgresql", {
        fx__notes: {
          columns: ["app_extra"],
          indexes: [],
          foreignKeys: [],
          checks: [],
        },
      })
    ).not.toThrow();
  });

  it("on a core table is the app's, whose migrations carry what is contributed there", () => {
    expect(() =>
      guard(["ALTER TABLE users DROP COLUMN loyalty_tier"], "app")
    ).not.toThrow();
    expect(() =>
      guard(["ALTER TABLE users DROP COLUMN loyalty_tier"], "plugin:fx")
    ).toThrow(NextlyError);
  });

  it("on a table nothing claims is refused to a plugin", () => {
    expect(
      refusal(() =>
        guard(["ALTER TABLE legacy_orders DROP COLUMN total"], "plugin:fx")
      )
    ).toMatchObject({
      table: "legacy_orders",
      column: "total",
      belongsTo: null,
    });
  });

  it("on a table the same list created is the stream's", () => {
    expect(() =>
      guard(
        [
          "CREATE TABLE fx__scratch (id INT, total INT)",
          "ALTER TABLE fx__scratch DROP COLUMN total",
        ],
        "plugin:fx"
      )
    ).not.toThrow();
  });
});

describe("a column whose name cannot be read", () => {
  it("is refused rather than guessed at", () => {
    expect(() => guard(["ALTER TABLE app_notes DROP COLUMN"], "app")).toThrow(
      /cannot be read/
    );
  });
});
