/**
 * ALTER TABLE spellings the guard must read rather than skip, and what it
 * does with a clause it cannot read on a table other owners have elements on.
 *
 * MariaDB writes `WAIT n` or `NOWAIT` before an ALTER TABLE's clauses, and
 * `IF EXISTS` inside `MODIFY`, `CHANGE`, `ALTER COLUMN` and `RENAME COLUMN`;
 * its `CONVERT TABLE x TO PARTITION` absorbs another table, and its
 * `CREATE OR REPLACE INDEX` drops the index it replaces. Each is read for
 * what it takes.
 *
 * A clause the guard cannot read is refused on another owner's table, and
 * on the app's own table too when another owner has a column, index or
 * constraint on it: the clause may change those (`CONVERT TO CHARACTER SET`
 * rewrites every column). Table options that change none of them stay
 * allowed.
 */
import { describe, expect, it } from "vitest";

import type { SupportedDialect } from "../../../../database/schema-registry";
import { NextlyError } from "../../../../errors/nextly-error";
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

function appTable(tableName: string): [string, OwnerRecord] {
  return [
    tableName,
    record({ tableName, ownerKind: "app", ownerId: "app", migratedBy: "app" }),
  ];
}

/**
 * `app_notes` and `app_plain` are the app's; `fx__notes` is the plugin's.
 * The plugin contributed a column, an index and a foreign key to
 * `app_notes`; nobody contributed anything to `app_plain`.
 */
const owners = new Map<string, OwnerRecord>([
  appTable("app_notes"),
  appTable("app_plain"),
  ["fx__notes", record({ tableName: "fx__notes" })],
]);

const elementOwners: OwnerRecord[] = [
  ...owners.values(),
  record({
    tableName: "app_notes",
    elementKind: "column",
    elementName: "status",
  }),
  record({
    tableName: "app_notes",
    elementKind: "index",
    elementName: "idx_status",
  }),
  record({
    tableName: "app_notes",
    elementKind: "fk",
    elementName: "fk_owner",
  }),
];

function guard(
  statements: string[],
  dialect: SupportedDialect = "mysql"
): void {
  assertNoForeignDrops({
    statements,
    stream: "app",
    owners,
    elementOwners,
    dialect,
    source: "0013_under_test",
    liveTables: new Set(owners.keys()),
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

describe("MariaDB's lock wait before the clauses", () => {
  it.each<[string, Record<string, unknown>]>([
    ["ALTER TABLE app_notes NOWAIT DROP COLUMN status", { column: "status" }],
    [
      "ALTER TABLE app_notes WAIT 5 DROP INDEX idx_status",
      { element: "idx_status" },
    ],
    [
      "ALTER TABLE app_notes NOWAIT DROP FOREIGN KEY fk_owner",
      { element: "fk_owner" },
    ],
    [
      "ALTER TABLE app_notes NOWAIT MODIFY status varchar(9)",
      { column: "status" },
    ],
    [
      "ALTER TABLE app_notes WAIT 1 RENAME COLUMN status TO s2",
      { column: "status" },
    ],
  ])("reads the clause after it: %s", (sql, taken) => {
    expect(refusal(() => guard([sql]))).toMatchObject({
      table: "app_notes",
      belongsTo: "plugin:fx",
      ...taken,
    });
  });
});

describe("MariaDB's IF EXISTS inside a column clause", () => {
  it.each<string>([
    "ALTER TABLE app_notes MODIFY IF EXISTS status varchar(9)",
    "ALTER TABLE app_notes MODIFY COLUMN IF EXISTS status varchar(9)",
    "ALTER TABLE app_notes CHANGE IF EXISTS status status varchar(9)",
    "ALTER TABLE app_notes CHANGE COLUMN IF EXISTS status s2 varchar(9)",
    "ALTER TABLE app_notes RENAME COLUMN IF EXISTS status TO s2",
    "ALTER TABLE app_notes ALTER COLUMN IF EXISTS status SET DEFAULT 'x'",
  ])("reads the column past it: %s", sql => {
    expect(refusal(() => guard([sql]))).toMatchObject({
      table: "app_notes",
      column: "status",
      belongsTo: "plugin:fx",
    });
  });
});

describe("MariaDB forms that take another owner's table or index", () => {
  it("refuses converting the plugin's table into a partition of the app's", () => {
    expect(
      refusal(() =>
        guard([
          "ALTER TABLE app_plain CONVERT TABLE fx__notes TO PARTITION p2 VALUES LESS THAN (10)",
        ])
      )
    ).toMatchObject({ table: "fx__notes", belongsTo: "plugin:fx" });
  });

  it.each<string>([
    "CREATE OR REPLACE INDEX idx_status ON app_notes (status)",
    "CREATE OR REPLACE UNIQUE INDEX idx_status ON app_notes (status)",
  ])("refuses replacing the plugin's index: %s", sql => {
    expect(refusal(() => guard([sql]))).toMatchObject({
      table: "app_notes",
      element: "idx_status",
      belongsTo: "plugin:fx",
    });
  });

  it("allows replacing the app's own index", () => {
    expect(() =>
      guard(["CREATE OR REPLACE INDEX app_idx ON app_plain (id)"])
    ).not.toThrow();
  });
});

describe("a clause the guard cannot read, on a table other owners have elements on", () => {
  it.each<[SupportedDialect, string]>([
    ["mysql", "ALTER TABLE app_notes CONVERT TO CHARACTER SET latin1"],
    ["mysql", "ALTER TABLE app_notes ADD system versioning"],
    ["postgresql", "ALTER TABLE app_notes DISABLE TRIGGER ALL"],
  ])("is refused on %s: %s", (dialect, sql) => {
    expect(refusal(() => guard([sql], dialect))).toMatchObject({
      table: "app_notes",
      belongsTo: "plugin:fx",
    });
  });

  it.each<[SupportedDialect, string]>([
    ["mysql", "ALTER TABLE app_plain CONVERT TO CHARACTER SET latin1"],
    ["postgresql", "ALTER TABLE app_plain DISABLE TRIGGER ALL"],
  ])("is allowed on %s where only the app has elements: %s", (dialect, sql) => {
    expect(() => guard([sql], dialect)).not.toThrow();
  });

  it.each<string>([
    "ALTER TABLE app_notes COMMENT = 'notes'",
    "ALTER TABLE app_notes AUTO_INCREMENT = 100",
    "ALTER TABLE app_notes ALGORITHM = INPLACE, LOCK = NONE",
    "ALTER TABLE app_notes ROW_FORMAT = DYNAMIC",
    "ALTER TABLE app_notes FORCE",
    "ALTER TABLE app_notes ORDER BY id",
    "ALTER TABLE app_notes DEFAULT CHARACTER SET utf8mb4",
    "ALTER TABLE app_notes CHARSET = utf8mb4 COLLATE = utf8mb4_bin",
  ])("allows a table option that changes no element: %s", sql => {
    expect(() => guard([sql])).not.toThrow();
  });

  it("still refuses a table option on the plugin's own table", () => {
    expect(
      refusal(() => guard(["ALTER TABLE fx__notes COMMENT = 'notes'"]))
    ).toMatchObject({ table: "fx__notes", belongsTo: "plugin:fx" });
  });

  it("refuses an ADD followed by a bare word on the plugin's table", () => {
    expect(
      refusal(() => guard(["ALTER TABLE fx__notes ADD system versioning"]))
    ).toMatchObject({ table: "fx__notes", belongsTo: "plugin:fx" });
  });

  it.each<SupportedDialect>(["postgresql", "sqlite"])(
    "reads a bare word after ADD as a column on %s, whose grammar has no other form",
    dialect => {
      expect(() =>
        guard(["ALTER TABLE fx__notes ADD app_extra int"], dialect)
      ).not.toThrow();
    }
  );

  it.each<string>([
    "ALTER TABLE fx__notes ADD COLUMN app_extra int",
    "ALTER TABLE fx__notes ADD `app_extra` int",
    "ALTER TABLE fx__notes ADD INDEX app_idx (id)",
    "ALTER TABLE fx__notes ADD CONSTRAINT app_chk CHECK (id > 0)",
  ])("still allows a proven addition to the plugin's table: %s", sql => {
    expect(() => guard([sql])).not.toThrow();
  });
});
