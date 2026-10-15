/**
 * Whether a migration may change, in place, a column, index or constraint that
 * another owner holds. Dropping or renaming one is refused elsewhere; this file
 * covers the in-place changes: a type, a nullability, a default, a redefinition.
 */
import { describe, expect, it } from "vitest";

import type { SupportedDialect } from "../../../../database/schema-registry";
import { NextlyError } from "../../../../errors/nextly-error";
import type { ContributedElements } from "../../pipeline/diff/types";
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
    source: "0010_under_test",
    liveTables: new Set([...owners.keys(), "users"]),
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

describe("an in-place change to a column another owner holds", () => {
  it.each<[SupportedDialect, string]>([
    ["postgresql", "ALTER TABLE app_notes ALTER COLUMN status TYPE int"],
    ["postgresql", "ALTER TABLE app_notes ALTER status TYPE int"],
    ["postgresql", "ALTER TABLE app_notes ALTER COLUMN status SET NOT NULL"],
    ["postgresql", "ALTER TABLE app_notes ALTER COLUMN status DROP NOT NULL"],
    ["postgresql", "ALTER TABLE app_notes ALTER COLUMN status SET DEFAULT 'x'"],
    ["postgresql", "ALTER TABLE app_notes ALTER COLUMN status DROP DEFAULT"],
    ["mysql", "ALTER TABLE app_notes MODIFY status varchar(40)"],
    ["mysql", "ALTER TABLE app_notes MODIFY COLUMN status varchar(40)"],
    ["mysql", "ALTER TABLE app_notes CHANGE status status varchar(40)"],
    ["mysql", "ALTER TABLE app_notes ALTER status SET DEFAULT 'x'"],
    ["mysql", "ALTER TABLE app_notes ALTER COLUMN status DROP DEFAULT"],
  ])("is refused to the app's migration on %s: %s", (dialect, statement) => {
    expect(refusal(() => guard([statement], "app", dialect))).toMatchObject({
      table: "app_notes",
      column: "status",
      belongsTo: "plugin:fx",
    });
  });

  it.each<[SupportedDialect, string]>([
    ["postgresql", "ALTER TABLE app_notes ALTER COLUMN status TYPE int"],
    ["mysql", "ALTER TABLE app_notes MODIFY status varchar(40)"],
  ])("is refused even behind a clause the app may run: %s", (dialect, sql) => {
    expect(() =>
      guard([`${sql}, ADD COLUMN extra int`], "app", dialect)
    ).toThrow();
  });

  it.each<[SupportedDialect, string]>([
    ["postgresql", "ALTER TABLE app_notes ALTER COLUMN status TYPE int"],
    ["mysql", "ALTER TABLE app_notes MODIFY status varchar(40)"],
  ])("is the contributing plugin's to change on %s: %s", (dialect, sql) => {
    expect(() => guard([sql], "plugin:fx", dialect)).not.toThrow();
  });

  it.each<[SupportedDialect, string]>([
    ["postgresql", "ALTER TABLE app_notes ALTER COLUMN body TYPE text"],
    ["mysql", "ALTER TABLE app_notes MODIFY body text"],
  ])("leaves the app's own column alone on %s: %s", (dialect, sql) => {
    expect(() => guard([sql], "app", dialect)).not.toThrow();
  });

  it("refuses a change to a plugin's column on the plugin's table", () => {
    const log = refusal(() =>
      guard(
        ["ALTER TABLE fx__notes ALTER COLUMN body TYPE int"],
        "app",
        "postgresql"
      )
    );
    expect(log).toMatchObject({ table: "fx__notes", belongsTo: "plugin:fx" });
  });
});
