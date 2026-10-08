/**
 * SQLite cannot drop a column a check constraint names in place, so the
 * pipeline removes such a column by rebuilding its table: a twin declaring
 * every column but that one, the rows copied, the table dropped and the twin
 * renamed back. The table and its rows survive under the owner's name, so the
 * block is judged as the column drop it is — the app may remove what it
 * contributed to a core table, as `ALTER TABLE ... DROP COLUMN` may on the
 * other dialects — while a column the stream does not hold is refused, and a
 * block that does not keep its table is still the table drop it is.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import { diffSnapshots } from "../../pipeline/diff/diff";
import type { TableSpec } from "../../pipeline/diff/types";
import { generateStatements } from "../../pipeline/sql-templates";
import { assertNoForeignDrops } from "../drop-guard";
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

/** A table with `id`, `title`, and `extra` columns, one check naming `extra` when it is there. */
function table(name: string, extra?: string): TableSpec {
  return {
    name,
    columns: [
      { name: "id", type: "text", nullable: false, primaryKey: true },
      { name: "title", type: "text", nullable: false },
      ...(extra ? [{ name: extra, type: "text", nullable: true }] : []),
    ],
    checks: extra
      ? [{ name: `${name}_${extra}_check`, sql: `"${extra}" IN ('a', 'b')` }]
      : [],
    foreignKeys: [],
    indexes: [],
  };
}

/**
 * The SQLite statements the pipeline renders to remove `column` and its
 * check from `name`.
 */
function removal(name: string, column: string): string[] {
  const after = table(name);
  const ops = diffSnapshots(
    { tables: [table(name, column)] },
    { tables: [after] }
  );
  return generateStatements(ops, "sqlite", [after]);
}

/** `fx__notes` is the plugin's; `blog_posts` is a collection, with no row. */
const owners = new Map<string, OwnerRecord>([
  ["fx__notes", record({ tableName: "fx__notes" })],
]);

/** Element rows: `blog_posts.mood` is the plugin's, `fx__notes.flag` another plugin's. */
const elementOwners: OwnerRecord[] = [
  ...owners.values(),
  record({
    tableName: "blog_posts",
    elementKind: "column",
    elementName: "mood",
  }),
  record({
    tableName: "fx__notes",
    elementKind: "column",
    elementName: "flag",
    ownerId: "other",
    migratedBy: "plugin:other",
  }),
];

/**
 * Judges the pipeline's removal of `column` from `name` for `stream`, with
 * `live` as the columns the table has in the database.
 */
function guard(
  name: string,
  column: string,
  stream: string,
  live: string[]
): void {
  assertNoForeignDrops({
    statements: removal(name, column),
    stream,
    owners,
    elementOwners,
    dialect: "sqlite",
    source: "0009_under_test",
    liveColumns: new Map([[name, new Set(live)]]),
    // The rebuilt table exists; the pipeline's guard table is made fresh.
    liveTables: new Set([name, ...owners.keys()]),
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

describe("a SQLite rebuild that removes a column", () => {
  it("is rendered as a rebuild of the table", () => {
    // The premise: on SQLite the column goes by a rebuild, with no
    // ALTER TABLE ... DROP COLUMN anywhere.
    const statements = removal("users", "tier");
    expect(statements).toContain('DROP TABLE "users"');
    expect(statements.some(s => /DROP COLUMN/i.test(s))).toBe(false);
  });

  it("lets the app remove the enum it contributed to core users", () => {
    expect(() =>
      guard("users", "tier", "app", ["id", "title", "tier"])
    ).not.toThrow();
  });

  it("lets a plugin remove its own contributed enum on a collection table", () => {
    expect(() =>
      guard("blog_posts", "mood", "plugin:fx", ["id", "title", "mood"])
    ).not.toThrow();
  });

  it("refuses a plugin removing another owner's column through it", () => {
    expect(
      refusal(() =>
        guard("fx__notes", "flag", "plugin:fx", ["id", "title", "flag"])
      )
    ).toMatchObject({
      table: "fx__notes",
      column: "flag",
      droppedBy: "plugin:fx",
      belongsTo: "plugin:other",
    });
  });

  it("refuses a plugin removing a column of core users through it", () => {
    expect(
      refusal(() =>
        guard("users", "tier", "plugin:fx", ["id", "title", "tier"])
      )
    ).toMatchObject({ table: "users", column: "tier", belongsTo: "core" });
  });

  it("refuses a plugin removing an unclaimed collection column through it", () => {
    expect(
      refusal(() =>
        guard("blog_posts", "rating", "plugin:fx", ["id", "title", "rating"])
      )
    ).toMatchObject({ table: "blog_posts", column: "rating", belongsTo: null });
  });

  it("is still the drop of the table when the twin declares a column the table lacks", () => {
    // The twin declares `title`, which the live table does not have, so
    // nothing says the copy keeps the rows: the block is read as the drop
    // of `users` it may be.
    expect(
      refusal(() => guard("users", "tier", "plugin:fx", ["id", "tier"]))
    ).toMatchObject({ table: "users", droppedBy: "plugin:fx" });
    expect(() => guard("users", "tier", "app", ["id", "tier"])).toThrow(
      /different owner/
    );
  });

  it("is still the drop of the table when its live columns were not read", () => {
    expect(() =>
      assertNoForeignDrops({
        statements: removal("users", "tier"),
        stream: "app",
        owners,
        elementOwners,
        dialect: "sqlite",
        source: "0009_under_test",
      })
    ).toThrow(/different owner/);
  });
});
