/**
 * `CREATE TABLE IF NOT EXISTS` under a name the same list dropped or renamed
 * away creates the table: nothing stands under the name any more. A later
 * statement naming it reaches that new table, as after a plain `CREATE
 * TABLE`, so a name looked up before the list ran (a PostgreSQL `ALTER TABLE`
 * target) is not refused as vacated.
 *
 * Where a table of the name may still stand, the create may make nothing and
 * fills nothing: before any drop of the name; after the list created a table
 * of that name, under any schema, since a temporary table shadows a real one
 * and its drop leaves the real one standing; when the drop or the create
 * names a schema, since an unqualified name may reach another one; or after
 * a statement that may change which schema an unqualified name reaches.
 */
import { describe, expect, it } from "vitest";

import type { SupportedDialect } from "../../../../database/schema-registry";
import { NextlyError } from "../../../../errors/nextly-error";
import { assertNoForeignDrops } from "../drop-guard";
import type { OwnerRecord } from "../owner-registry";

const DIALECTS: SupportedDialect[] = ["postgresql", "mysql", "sqlite"];

/** `legacy_orders` has no owner row, so it is the app's; `fx__notes` is the plugin's. */
const owners = new Map<string, OwnerRecord>([
  [
    "fx__notes",
    {
      tableName: "fx__notes",
      ownerKind: "plugin",
      ownerId: "fx",
      migratedBy: "plugin:fx",
      ownerVersion: "1.0.0",
      schemaVersion: 1,
      state: "active",
    },
  ],
]);

function guard(
  statements: string[],
  stream: string,
  dialect: SupportedDialect
): void {
  assertNoForeignDrops({
    statements,
    stream,
    owners,
    elementOwners: [...owners.values()],
    dialect,
    source: "0009_under_test",
    liveTables: new Set([...owners.keys(), "legacy_orders"]),
  });
}

/** The refusal's message, or a failure when nothing was refused. */
function refusal(run: () => void): string {
  try {
    run();
  } catch (error) {
    expect(NextlyError.is(error)).toBe(true);
    return (error as NextlyError).message;
  }
  return expect.unreachable("must be refused");
}

describe.each(DIALECTS)(
  "CREATE TABLE IF NOT EXISTS after the name was vacated, on %s",
  dialect => {
    it("fills a name the app's migration dropped", () => {
      expect(() =>
        guard(
          [
            "DROP TABLE legacy_orders",
            "CREATE TABLE IF NOT EXISTS legacy_orders (id INT)",
            "ALTER TABLE legacy_orders ADD COLUMN note INT",
          ],
          "app",
          dialect
        )
      ).not.toThrow();
    });

    it("fills a name a plugin's migration dropped from its own table", () => {
      expect(() =>
        guard(
          [
            "DROP TABLE fx__notes",
            "CREATE TABLE IF NOT EXISTS fx__notes (id INT)",
            "ALTER TABLE fx__notes ADD COLUMN note INT",
          ],
          "plugin:fx",
          dialect
        )
      ).not.toThrow();
    });

    it("fills a name the migration renamed away", () => {
      expect(() =>
        guard(
          [
            "ALTER TABLE legacy_orders RENAME TO legacy_orders_old",
            "CREATE TABLE IF NOT EXISTS legacy_orders (id INT)",
            "ALTER TABLE legacy_orders ADD COLUMN note INT",
          ],
          "app",
          dialect
        )
      ).not.toThrow();
    });
  }
);

describe("CREATE TABLE IF NOT EXISTS where a table of the name may stand, on postgresql", () => {
  const vacated = /names legacy_orders after an earlier statement/;

  it("fills nothing before the name is vacated", () => {
    expect(
      refusal(() =>
        guard(
          [
            "CREATE TABLE IF NOT EXISTS legacy_orders (id INT)",
            "DROP TABLE legacy_orders",
            "ALTER TABLE legacy_orders ADD COLUMN note INT",
          ],
          "app",
          "postgresql"
        )
      )
    ).toMatch(vacated);
  });

  it("fills nothing after the list created a table of the name, which may have shadowed a real one", () => {
    expect(
      refusal(() =>
        guard(
          [
            "CREATE TEMPORARY TABLE legacy_orders (id INT)",
            "DROP TABLE legacy_orders",
            "CREATE TABLE IF NOT EXISTS legacy_orders (id INT)",
            "ALTER TABLE legacy_orders ADD COLUMN note INT",
          ],
          "app",
          "postgresql"
        )
      )
    ).toMatch(vacated);
  });

  it("fills nothing after the search path may have changed, which may find another table of the name", () => {
    expect(
      refusal(() =>
        guard(
          [
            "DROP TABLE legacy_orders",
            "SET search_path TO scratch, public",
            "CREATE TABLE IF NOT EXISTS legacy_orders (id INT)",
            "ALTER TABLE legacy_orders ADD COLUMN note INT",
          ],
          "app",
          "postgresql"
        )
      )
    ).toMatch(vacated);
  });

  it.each([
    [
      "the temporary schema named",
      "CREATE TABLE pg_temp.legacy_orders (id INT)",
    ],
    [
      "the temporary schema and keyword",
      "CREATE TEMP TABLE pg_temp.legacy_orders (id INT)",
    ],
    ["another schema named", "CREATE TABLE scratch.legacy_orders (id INT)"],
  ])(
    "fills nothing after the list created a table of the name with %s",
    (_spelling, created) => {
      expect(
        refusal(() =>
          guard(
            [
              created,
              "DROP TABLE legacy_orders",
              "CREATE TABLE IF NOT EXISTS legacy_orders (id INT)",
              "ALTER TABLE legacy_orders ADD COLUMN note INT",
            ],
            "app",
            "postgresql"
          )
        )
      ).toMatch(vacated);
    }
  );

  it("fills nothing after a drop that named the schema, which an unqualified create may not reach", () => {
    expect(
      refusal(() =>
        guard(
          [
            "DROP TABLE public.legacy_orders",
            "CREATE TABLE IF NOT EXISTS legacy_orders (id INT)",
            "ALTER TABLE legacy_orders ADD COLUMN note INT",
          ],
          "app",
          "postgresql"
        )
      )
    ).toMatch(vacated);
  });

  it("fills nothing under a create that names the schema", () => {
    expect(
      refusal(() =>
        guard(
          [
            "DROP TABLE legacy_orders",
            "CREATE TABLE IF NOT EXISTS public.legacy_orders (id INT)",
            "ALTER TABLE legacy_orders ADD COLUMN note INT",
          ],
          "app",
          "postgresql"
        )
      )
    ).toMatch(vacated);
  });

  it("is the control: a plain CREATE fills the name", () => {
    expect(() =>
      guard(
        [
          "DROP TABLE legacy_orders",
          "CREATE TABLE legacy_orders (id INT)",
          "ALTER TABLE legacy_orders ADD COLUMN note INT",
        ],
        "app",
        "postgresql"
      )
    ).not.toThrow();
  });
});
