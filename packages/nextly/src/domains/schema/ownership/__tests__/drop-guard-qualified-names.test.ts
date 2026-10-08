/**
 * A table the same statement list created is that list's to drop — but only
 * when the drop reaches the table the create made. A qualified name may reach
 * a different table of the same name, and a list that changes the search path
 * or the default database changes what an unqualified name reaches between
 * the create and the drop. Neither may lend a protected table's name the
 * credit of a creation.
 */
import { describe, expect, it } from "vitest";

import type { SupportedDialect } from "../../../../database/schema-registry";
import { NextlyError } from "../../../../errors/nextly-error";
import { assertNoForeignDrops } from "../drop-guard";
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
const LIVE_TABLES: ReadonlySet<string> = new Set([...owners.keys(), "users"]);

function guard(
  statements: string[],
  stream: string,
  dialect: SupportedDialect,
  liveColumns?: Map<string, Set<string>>
): void {
  assertNoForeignDrops({
    statements,
    stream,
    owners,
    elementOwners: [...owners.values()],
    dialect,
    source: "0009_under_test",
    liveColumns,
    liveTables: LIVE_TABLES,
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

describe.each(DIALECTS)("a qualified create, on %s", dialect => {
  it.each([
    [
      "then an unqualified drop",
      [
        "CREATE TABLE scratch.auth__identities (id INT)",
        "DROP TABLE auth__identities",
      ],
      "drop",
    ],
    [
      "then an unqualified rename",
      [
        "CREATE TABLE scratch.auth__identities (id INT)",
        "ALTER TABLE auth__identities RENAME TO gone",
      ],
      "rename",
    ],
    [
      "in another database, then an unqualified drop",
      [
        "CREATE TABLE otherdb.auth__identities (id INT)",
        "DROP TABLE auth__identities",
      ],
      "drop",
    ],
  ])(
    "%s does not lend another owner's table its credit",
    (_shape, statements, act) => {
      for (const stream of ["plugin:fx", "app"]) {
        expect(refusal(() => guard(statements, stream, dialect))).toMatchObject(
          {
            table: "auth__identities",
            [act === "rename" ? "renamedBy" : "droppedBy"]: stream,
            belongsTo: "plugin:auth",
          }
        );
      }
    }
  );

  it("does not lend a core table its credit", () => {
    expect(
      refusal(() =>
        guard(
          ["CREATE TABLE scratch.users (id INT)", "DROP TABLE users"],
          "app",
          dialect
        )
      )
    ).toMatchObject({ table: "users", droppedBy: "app", belongsTo: "core" });
  });

  it("does not lend the plugin's own create a qualified drop's credit", () => {
    // An unqualified create may land in another schema than the one a
    // qualified drop names, which may hold the protected table.
    expect(
      refusal(() =>
        guard(
          ["CREATE TABLE users (id INT)", "DROP TABLE public.users"],
          "app",
          dialect
        )
      )
    ).toMatchObject({ table: "users", belongsTo: "core" });
    expect(
      refusal(() =>
        guard(
          [
            "CREATE TABLE auth__identities (id INT)",
            "ALTER TABLE public.auth__identities DROP COLUMN provider",
          ],
          "plugin:fx",
          dialect
        )
      )
    ).toMatchObject({ table: "auth__identities", column: "provider" });
  });

  it("still lets the module drop the table it created under an unqualified name", () => {
    expect(() =>
      guard(
        [
          "CREATE TABLE fx__scratch (id INT)",
          "ALTER TABLE fx__scratch RENAME TO fx__scratch2",
          "ALTER TABLE fx__scratch2 DROP COLUMN id",
          "DROP TABLE fx__scratch2",
        ],
        "plugin:fx",
        dialect
      )
    ).not.toThrow();
    expect(() =>
      guard(
        [
          "CREATE TEMPORARY TABLE fx__scratch (id INT)",
          "DROP TABLE fx__scratch",
        ],
        "plugin:fx",
        dialect
      )
    ).not.toThrow();
  });
});

describe("a qualified rename target on mysql", () => {
  it("moves the created table away, so the name it leaves reaches the original", () => {
    expect(
      refusal(() =>
        guard(
          [
            "CREATE TABLE fx__tmp (id INT)",
            "RENAME TABLE fx__tmp TO otherdb.auth__identities",
            "DROP TABLE auth__identities",
          ],
          "plugin:fx",
          "mysql"
        )
      )
    ).toMatchObject({ table: "auth__identities", belongsTo: "plugin:auth" });
  });
});

describe("sqlite's temp schema", () => {
  it("is the one qualifier whose table an unqualified name reaches", () => {
    expect(() =>
      guard(
        ["CREATE TABLE temp.fx__scratch (id INT)", "DROP TABLE fx__scratch"],
        "plugin:fx",
        "sqlite"
      )
    ).not.toThrow();
  });

  it("does not make main a local qualifier", () => {
    expect(() =>
      guard(
        ["CREATE TABLE main.users (id INT)", "DROP TABLE users"],
        "app",
        "sqlite"
      )
    ).toThrow(/different owner/);
    expect(() =>
      guard(
        ["CREATE TEMP TABLE users (id INT)", "DROP TABLE main.users"],
        "app",
        "sqlite"
      )
    ).toThrow(/different owner/);
  });
});

describe("a list that may change what an unqualified name reaches", () => {
  it.each<[string, SupportedDialect, string[]]>([
    [
      "SET search_path before the create",
      "postgresql",
      [
        "SET search_path = scratch",
        "CREATE TABLE users (id INT)",
        "DROP TABLE users",
      ],
    ],
    [
      "SET LOCAL search_path before the create",
      "postgresql",
      [
        "SET LOCAL search_path TO scratch",
        "CREATE TABLE users (id INT)",
        "DROP TABLE users",
      ],
    ],
    [
      "set_config before the create",
      "postgresql",
      [
        "SELECT set_config('search_path', 'scratch', true)",
        "CREATE TABLE users (id INT)",
        "DROP TABLE users",
      ],
    ],
    [
      "SET search_path between the create and the drop",
      "postgresql",
      [
        "CREATE TABLE users (id INT)",
        "SET search_path = public",
        "DROP TABLE users",
      ],
    ],
    [
      "SET ROLE, which changes the $user schema",
      "postgresql",
      [
        "SET ROLE scratch_owner",
        "CREATE TABLE users (id INT)",
        "DROP TABLE users",
      ],
    ],
    [
      "DISCARD TEMP, which drops the temporary table that shadowed it",
      "postgresql",
      ["CREATE TEMP TABLE users (id INT)", "DISCARD TEMP", "DROP TABLE users"],
    ],
    [
      "USE before the create",
      "mysql",
      [
        "USE otherdb",
        "CREATE TABLE users (id INT)",
        "USE app",
        "DROP TABLE users",
      ],
    ],
  ])("%s loses the creation's credit", (_shape, dialect, statements) => {
    expect(refusal(() => guard(statements, "app", dialect))).toMatchObject({
      table: "users",
      belongsTo: "core",
    });
  });

  it("does not trust a rebuild block either", () => {
    // After the SET the twin and the rename back land in `scratch`, while
    // the DROP still reaches the table the plugin is rebuilding.
    const rebuild = [
      'CREATE TABLE "__new_auth__identities" ("id" INT, "provider" TEXT)',
      'INSERT INTO "__new_auth__identities" ("id", "provider") SELECT "id", "provider" FROM "auth__identities"',
      'DROP TABLE "auth__identities"',
      'ALTER TABLE "__new_auth__identities" RENAME TO "auth__identities"',
    ];
    const live = new Map([["auth__identities", new Set(["id", "provider"])]]);
    expect(() => guard(rebuild, "plugin:fx", "postgresql", live)).not.toThrow();
    expect(
      refusal(() =>
        guard(
          ["SET search_path = scratch, public", ...rebuild],
          "plugin:fx",
          "postgresql",
          live
        )
      )
    ).toMatchObject({ table: "auth__identities", belongsTo: "plugin:auth" });
  });

  it("does not trust a rebuild block spelled with qualified names", () => {
    expect(
      refusal(() =>
        guard(
          [
            'CREATE TABLE scratch."__new_auth__identities" ("id" INT)',
            'INSERT INTO scratch."__new_auth__identities" ("id") SELECT "id" FROM "auth__identities"',
            'DROP TABLE "auth__identities"',
            'ALTER TABLE scratch."__new_auth__identities" RENAME TO "auth__identities"',
          ],
          "plugin:fx",
          "postgresql",
          new Map([["auth__identities", new Set(["id"])]])
        )
      )
    ).toMatchObject({ table: "auth__identities", belongsTo: "plugin:auth" });
  });
});
