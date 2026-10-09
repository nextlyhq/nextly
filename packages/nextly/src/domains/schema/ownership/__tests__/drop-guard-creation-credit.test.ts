/**
 * When a statement list's own CREATE lets it drop a table: only for a table
 * that did not exist before the list ran.
 *
 * A CREATE naming a table that already exists cannot have made it. Whatever
 * it did make — in another schema, under another case, after the search path
 * moved — a later statement naming the existing table reaches the existing
 * table, so the creation earns the list nothing there. Each side door below
 * names `auth__identities`, which another plugin holds and the database
 * already has, and each is refused.
 *
 * The rules that read the text — a local, lower-case name, and no statement
 * that may change what an unqualified name reaches — are kept as well, and
 * are tested here with a live reading that does not see the table, so each
 * is shown to hold on its own.
 */
import { describe, expect, it } from "vitest";

import type { SupportedDialect } from "../../../../database/schema-registry";
import { NextlyError } from "../../../../errors/nextly-error";
import { assertNoForeignDrops, tablesCreatedBy } from "../drop-guard";
import type { OwnerRecord } from "../owner-registry";

const DIALECTS: SupportedDialect[] = ["postgresql", "mysql", "sqlite"];

/** `fx__notes` is the plugin's; `auth__identities` another plugin's. */
const owners = new Map<string, OwnerRecord>(
  [
    ["fx__notes", "fx"],
    ["auth__identities", "auth"],
  ].map(([tableName, plugin]) => [
    tableName,
    {
      tableName,
      ownerKind: "plugin",
      ownerId: plugin,
      migratedBy: `plugin:${plugin}`,
      ownerVersion: "1.0.0",
      schemaVersion: 1,
      state: "active",
    },
  ])
);

/** The tables the database holds before a list runs. */
const LIVE: ReadonlySet<string> = new Set([...owners.keys(), "users"]);

/** A live reading that missed every table. */
const NOTHING_LIVE: ReadonlySet<string> = new Set();

function guard(
  statements: string[],
  dialect: SupportedDialect,
  liveTables: ReadonlySet<string> | undefined,
  stream = "plugin:fx"
): void {
  assertNoForeignDrops({
    statements,
    stream,
    owners,
    elementOwners: [...owners.values()],
    dialect,
    source: "0009_under_test",
    liveTables,
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

/** `name` quoted the way `dialect` quotes a name. */
function quoted(dialect: SupportedDialect, name: string): string {
  return dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
}

/** A CREATE of `name`, then an unqualified drop of `auth__identities`. */
function createThenDrop(name: string): string[] {
  return [`CREATE TABLE ${name} (id INT)`, "DROP TABLE auth__identities"];
}

describe.each(DIALECTS)(
  "a CREATE of a table that already exists, on %s",
  dialect => {
    it.each<[string, string[]]>([
      ["a schema-qualified create", createThenDrop("scratch.auth__identities")],
      [
        "a quoted mixed-case create",
        createThenDrop(quoted(dialect, "Auth__Identities")),
      ],
      ["an unquoted mixed-case create", createThenDrop("Auth__Identities")],
      [
        "a create between calls that move the search path",
        [
          "SELECT fx_switch_search_path()",
          "CREATE TABLE auth__identities (id INT)",
          "SELECT fx_restore_search_path()",
          "DROP TABLE auth__identities",
        ],
      ],
      [
        "a plain create, which the database would refuse",
        createThenDrop("auth__identities"),
      ],
    ])("%s earns the drop nothing", (_shape, statements) => {
      for (const stream of ["plugin:fx", "app"]) {
        expect(
          refusal(() => guard(statements, dialect, LIVE, stream))
        ).toMatchObject({
          table: "auth__identities",
          droppedBy: stream,
          belongsTo: "plugin:auth",
        });
      }
    });

    it("earns a rename of the created table onto an existing name nothing", () => {
      expect(
        refusal(() =>
          guard(
            [
              "CREATE TABLE fx__tmp (id INT)",
              "SELECT fx_switch_search_path()",
              "ALTER TABLE fx__tmp RENAME TO auth__identities",
              "SELECT fx_restore_search_path()",
              "DROP TABLE auth__identities",
            ],
            dialect,
            LIVE
          )
        )
      ).toMatchObject({ table: "auth__identities", belongsTo: "plugin:auth" });
    });

    it("credits nothing when the live tables were not read", () => {
      expect(
        refusal(() =>
          guard(
            ["CREATE TABLE fx__scratch (id INT)", "DROP TABLE fx__scratch"],
            dialect,
            undefined
          )
        )
      ).toMatchObject({ table: "fx__scratch", belongsTo: null });
    });

    it("still lets a module drop a new table it created", () => {
      expect(() =>
        guard(
          [
            "CREATE TABLE fx__scratch (id INT, total INT)",
            "ALTER TABLE fx__scratch DROP COLUMN total",
            "ALTER TABLE fx__scratch RENAME TO fx__scratch2",
            "DROP TABLE fx__scratch2",
          ],
          dialect,
          LIVE
        )
      ).not.toThrow();
      expect(() =>
        guard(
          [
            `CREATE TABLE ${quoted(dialect, "fx__scratch")} (id INT)`,
            `DROP TABLE ${quoted(dialect, "fx__scratch")}`,
          ],
          dialect,
          LIVE
        )
      ).not.toThrow();
    });

    it("refuses a quoted mixed-case create even where the live reading missed the table", () => {
      expect(
        refusal(() =>
          guard(
            createThenDrop(quoted(dialect, "Auth__Identities")),
            dialect,
            NOTHING_LIVE
          )
        )
      ).toMatchObject({ table: "auth__identities", belongsTo: "plugin:auth" });
    });
  }
);

describe("PostgreSQL's folding of an unquoted name", () => {
  it("lets a mixed-case unquoted scratch table be dropped by its folded name", () => {
    expect(() =>
      guard(
        ["CREATE TABLE Fx__Scratch (id INT)", "DROP TABLE fx__scratch"],
        "postgresql",
        LIVE
      )
    ).not.toThrow();
  });

  it.each<SupportedDialect>(["mysql", "sqlite"])(
    "is not assumed on %s, which keeps the case it was given",
    dialect => {
      expect(
        refusal(() =>
          guard(createThenDrop("Auth__Identities"), dialect, NOTHING_LIVE)
        )
      ).toMatchObject({ table: "auth__identities", belongsTo: "plugin:auth" });
    }
  );
});

describe("a PostgreSQL list that may change what an unqualified name reaches", () => {
  // Read with a live reading that missed the table, so each case is refused
  // by the reading of the text alone.
  it.each<[string, string[]]>([
    [
      "a quoted set_config",
      [
        "CREATE SCHEMA scratch",
        `SELECT "set_config"('search_path', 'scratch', false)`,
        "CREATE TABLE auth__identities (id INT)",
        `SELECT "set_config"('search_path', 'public', false)`,
        "DROP TABLE auth__identities",
      ],
    ],
    [
      "a schema-qualified quoted set_config",
      [
        `SELECT "pg_catalog"."set_config"('search_path', 'scratch', false)`,
        "CREATE TABLE auth__identities (id INT)",
        "DROP TABLE auth__identities",
      ],
    ],
    [
      "SET ROLE and RESET ROLE inside DO bodies",
      [
        "DO $$ BEGIN SET ROLE alice; END $$",
        "CREATE TABLE auth__identities (id INT)",
        "DO $$ BEGIN RESET ROLE; END $$",
        "DROP TABLE auth__identities",
      ],
    ],
    [
      "DISCARD inside a function body",
      [
        "CREATE FUNCTION fx_discard() RETURNS void LANGUAGE plpgsql AS $$ BEGIN DISCARD TEMP; END $$",
        "CREATE TABLE auth__identities (id INT)",
        "DROP TABLE auth__identities",
      ],
    ],
    [
      "ALTER SCHEMA ... RENAME",
      [
        "CREATE TABLE auth__identities (id INT)",
        "ALTER SCHEMA alice RENAME TO alice_old",
        "DROP TABLE auth__identities",
      ],
    ],
    [
      "CREATE SCHEMA, which may become the $user schema",
      [
        "CREATE SCHEMA alice",
        "CREATE TABLE auth__identities (id INT)",
        "DROP TABLE auth__identities",
      ],
    ],
    [
      "SET SCHEMA, which sets the search path",
      [
        "SET SCHEMA 'scratch'",
        "CREATE TABLE auth__identities (id INT)",
        "DROP TABLE auth__identities",
      ],
    ],
  ])("%s loses the creation's credit", (_shape, statements) => {
    expect(
      refusal(() => guard(statements, "postgresql", NOTHING_LIVE))
    ).toMatchObject({ table: "auth__identities", belongsTo: "plugin:auth" });
  });

  it("keeps the credit through a SET clause of an ALTER TABLE", () => {
    expect(() =>
      guard(
        [
          "CREATE TABLE fx__scratch (id INT, total INT)",
          "ALTER TABLE fx__scratch ALTER COLUMN total SET DEFAULT 0",
          "DROP TABLE fx__scratch",
        ],
        "postgresql",
        LIVE
      )
    ).not.toThrow();
  });
});

describe("tablesCreatedBy", () => {
  it("names the local tables a list creates, and what it renames them to", () => {
    expect(
      tablesCreatedBy(
        [
          "CREATE TABLE fx__a (id INT)",
          'CREATE TEMPORARY TABLE "fx__b" (id INT)',
          "CREATE TABLE scratch.fx__c (id INT)",
          "CREATE TABLE IF NOT EXISTS fx__d (id INT)",
          'CREATE TABLE "__new_fx__notes" (id INT)',
          "ALTER TABLE fx__a RENAME TO fx__e",
        ],
        "postgresql"
      ).sort()
    ).toEqual(["fx__a", "fx__b", "fx__e"]);
  });

  it("names nothing for a list it cannot read", () => {
    expect(
      tablesCreatedBy(
        ["CREATE TABLE fx__a (id INT)", "EXECUTE 'DROP TABLE x'"],
        "postgresql"
      )
    ).toEqual([]);
  });
});
