/**
 * A PostgreSQL statement that reaches a table's descendants: the tables that
 * inherit from it, and its partitions. `ALTER TABLE parent ...` without
 * `ONLY`, `TRUNCATE parent` without `ONLY`, and `DROP TABLE parent` all act
 * on every descendant too, and the text names none of them. The live reading
 * (`readLiveTables`) carries each named table's descendants, and a statement
 * that reaches one the stream does not hold is refused.
 *
 * The live database is stood in for here; the integration suite beside this
 * file reads a real inheritance tree.
 */
import { describe, expect, it } from "vitest";

import type { SupportedDialect } from "../../../../database/schema-registry";
import { NextlyError } from "../../../../errors/nextly-error";
import { assertNoForeignDrops, type LiveTables } from "../drop-guard";
import type { OwnerRecord } from "../owner-registry";

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

/**
 * `app_parent` and `app_child` are the app's; `fx__child`, which inherits
 * from `app_parent`, is the plugin's.
 */
const owners = new Map<string, OwnerRecord>([
  [
    "app_parent",
    record({
      tableName: "app_parent",
      ownerKind: "app",
      ownerId: "app",
      migratedBy: "app",
    }),
  ],
  ["fx__child", record({ tableName: "fx__child" })],
]);

/** The live tables, with `app_parent`'s descendants as PostgreSQL has them. */
function live(descendants: ReadonlyArray<readonly [string, string[]]>) {
  const tables: LiveTables = Object.assign(
    new Set(["app_parent", "app_child", "fx__child", "app_base"]),
    { descendants: new Map(descendants) }
  );
  return tables;
}

const PLUGIN_CHILD = live([["app_parent", ["fx__child"]]]);
const APP_CHILD = live([["app_parent", ["app_child"]]]);

function guard(
  statements: string[],
  liveTables: LiveTables = PLUGIN_CHILD,
  dialect: SupportedDialect = "postgresql",
  stream = "app"
): void {
  assertNoForeignDrops({
    statements,
    stream,
    owners,
    elementOwners: [...owners.values()],
    dialect,
    source: "0011_under_test",
    liveTables,
  });
}

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

describe("a PostgreSQL statement that reaches another owner's descendant table", () => {
  it.each<string>([
    "ALTER TABLE app_parent ADD COLUMN extra int",
    "ALTER TABLE app_parent ALTER COLUMN name SET NOT NULL",
    "ALTER TABLE app_parent DROP COLUMN name",
    "ALTER TABLE app_parent RENAME COLUMN name TO title",
    "ALTER TABLE IF EXISTS app_parent ADD CONSTRAINT app_chk CHECK (true)",
    "ALTER TABLE app_parent * ADD COLUMN extra int",
    "ALTER TABLE app_parent DISABLE TRIGGER ALL",
  ])("refuses %s, which alters the plugin's child too", sql => {
    expect(refusal(() => guard([sql]))).toMatchObject({
      table: "fx__child",
      parent: "app_parent",
      belongsTo: "plugin:fx",
    });
  });

  it("refuses a TRUNCATE without ONLY, which empties the child too", () => {
    expect(refusal(() => guard(["TRUNCATE app_parent"]))).toMatchObject({
      table: "fx__child",
      parent: "app_parent",
      belongsTo: "plugin:fx",
    });
  });

  it("refuses a DROP of the parent, which takes the child or its partition", () => {
    expect(
      refusal(() => guard(["DROP TABLE app_parent CASCADE"]))
    ).toMatchObject({
      table: "fx__child",
      parent: "app_parent",
      belongsTo: "plugin:fx",
    });
  });

  it("follows the parent through a rename earlier in the list", () => {
    expect(
      refusal(() =>
        guard([
          "ALTER TABLE app_parent RENAME TO app_base2",
          "ALTER TABLE app_base2 ADD COLUMN extra int",
        ])
      )
    ).toMatchObject({ table: "fx__child", parent: "app_parent" });
  });

  it("refuses detaching the plugin's partition from the app's table", () => {
    expect(
      refusal(() =>
        guard(["ALTER TABLE app_parent DETACH PARTITION fx__child"])
      )
    ).toMatchObject({ table: "fx__child", belongsTo: "plugin:fx" });
  });

  it("reads an ALTER FOREIGN TABLE's table past ONLY, not as a table named only", () => {
    // Its clauses are not read, so the plugin's table is refused as an
    // unmodelled change, whatever the app's own tables are.
    expect(
      refusal(() =>
        guard(
          ["ALTER FOREIGN TABLE ONLY fx__child OPTIONS (ADD x 'y')"],
          live([])
        )
      )
    ).toMatchObject({ table: "fx__child", belongsTo: "plugin:fx" });
  });

  it("refuses an ALTER FOREIGN TABLE without ONLY on the app's parent", () => {
    expect(
      refusal(() =>
        guard(["ALTER FOREIGN TABLE app_parent OPTIONS (ADD x 'y')"])
      )
    ).toMatchObject({ table: "fx__child", parent: "app_parent" });
  });

  it("refuses an ALTER TYPE ... CASCADE, which alters every table typed by it", () => {
    expect(() =>
      guard(["ALTER TYPE app_row ADD ATTRIBUTE extra int CASCADE"])
    ).toThrow(NextlyError);
  });
});

describe("what still reaches only what the stream holds", () => {
  it.each<string>([
    "ALTER TABLE ONLY app_parent ALTER COLUMN name SET DEFAULT 'x'",
    "ALTER TABLE IF EXISTS ONLY app_parent DROP CONSTRAINT app_chk",
    "TRUNCATE ONLY app_parent",
    // Renaming or moving the table, and attaching a partition, act on the
    // table named alone; PostgreSQL takes no ONLY on them.
    "ALTER TABLE app_parent RENAME TO app_base2",
    "ALTER TABLE app_parent SET SCHEMA archive",
    "ALTER TABLE app_parent ATTACH PARTITION app_child FOR VALUES IN (1)",
  ])("allows %s", sql => {
    expect(() => guard([sql])).not.toThrow();
  });

  it("allows altering a parent whose descendants the stream holds", () => {
    expect(() =>
      guard(["ALTER TABLE app_parent ADD COLUMN extra int"], APP_CHILD)
    ).not.toThrow();
  });

  it("allows a table with no descendants", () => {
    expect(() =>
      guard(["ALTER TABLE app_parent ADD COLUMN extra int"], live([]))
    ).not.toThrow();
  });

  it.each<SupportedDialect>(["mysql", "sqlite"])(
    "reads no inheritance on %s, which has none",
    dialect => {
      expect(() =>
        guard(
          ["ALTER TABLE app_parent ADD COLUMN extra int"],
          live([]),
          dialect
        )
      ).not.toThrow();
    }
  );
});
