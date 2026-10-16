/**
 * Whether a migration may change, in place, a column, index or constraint that
 * another owner holds. Dropping or renaming one is refused elsewhere; this file
 * covers the in-place changes: a type, a nullability, a default, a redefinition.
 */
import { describe, expect, it } from "vitest";

import type { SupportedDialect } from "../../../../database/schema-registry";
import { NextlyError } from "../../../../errors/nextly-error";
import type { ContributedElements } from "../../pipeline/diff/types";
import { assertNoForeignDrops, indexesNamedWithoutTable } from "../drop-guard";
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
  ["fx_remote", record({ tableName: "fx_remote" })],
]);

/** `status` on the app's table is a column the plugin contributed. */
const elementOwners: OwnerRecord[] = [
  ...owners.values(),
  record({
    tableName: "app_notes",
    elementKind: "column",
    elementName: "status",
  }),
  // An index and a foreign key the plugin contributed to the app's table.
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
  record({
    tableName: "app_notes",
    elementKind: "check",
    elementName: "chk_status",
  }),
  // A partition's index, the plugin's, on the plugin's table.
  record({
    tableName: "fx__notes",
    elementKind: "index",
    elementName: "fx_idx",
  }),
];

function guard(
  statements: string[],
  stream: string,
  dialect: SupportedDialect = "postgresql",
  ownedElements?: Record<string, ContributedElements>,
  columnOverrides?: Array<{ table: string; column: string }>
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
    columnOverrides,
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

describe("an in-place change to an index or constraint another owner holds", () => {
  it.each<[SupportedDialect, string]>([
    [
      "postgresql",
      "ALTER TABLE app_notes ALTER CONSTRAINT fk_owner DEFERRABLE",
    ],
    ["postgresql", "ALTER INDEX idx_status SET TABLESPACE other"],
    ["postgresql", "ALTER INDEX IF EXISTS idx_status SET (fillfactor = 70)"],
    ["mysql", "ALTER TABLE app_notes ALTER INDEX idx_status INVISIBLE"],
    ["mysql", "ALTER TABLE app_notes ALTER CHECK chk_status NOT ENFORCED"],
  ])("is refused to the app's migration on %s: %s", (dialect, statement) => {
    expect(refusal(() => guard([statement], "app", dialect))).toMatchObject({
      belongsTo: "plugin:fx",
    });
  });

  it.each<[SupportedDialect, string]>([
    [
      "postgresql",
      "ALTER TABLE app_notes ALTER CONSTRAINT fk_owner DEFERRABLE",
    ],
    ["postgresql", "ALTER INDEX idx_status SET TABLESPACE other"],
    ["mysql", "ALTER TABLE app_notes ALTER INDEX idx_status INVISIBLE"],
  ])("is the contributing plugin's to change on %s: %s", (dialect, sql) => {
    expect(() => guard([sql], "plugin:fx", dialect)).not.toThrow();
  });

  it.each<[SupportedDialect, string]>([
    ["postgresql", "ALTER INDEX app_idx SET TABLESPACE other"],
    ["mysql", "ALTER TABLE app_notes ALTER INDEX app_idx INVISIBLE"],
  ])("leaves the app's own index alone on %s: %s", (dialect, sql) => {
    expect(() => guard([sql], "app", dialect)).not.toThrow();
  });
});

describe("the app's override of a plugin column's storage", () => {
  const override = [{ table: "app_notes", column: "status" }];

  it("lets the app change the overridden column in place", () => {
    expect(() =>
      guard(
        ["ALTER TABLE app_notes ALTER COLUMN status TYPE varchar(40)"],
        "app",
        "postgresql",
        undefined,
        override
      )
    ).not.toThrow();
  });

  it("still refuses a drop of the overridden column", () => {
    expect(() =>
      guard(
        ["ALTER TABLE app_notes DROP COLUMN status"],
        "app",
        "postgresql",
        undefined,
        override
      )
    ).toThrow();
  });

  it("still refuses an in-place change to a column the override does not name", () => {
    const log = refusal(() =>
      guard(
        ["ALTER TABLE fx__notes ALTER COLUMN body TYPE int"],
        "app",
        "postgresql",
        undefined,
        override
      )
    );
    expect(log).toMatchObject({ table: "fx__notes", column: "body" });
  });
});

describe("the remaining PostgreSQL ALTER INDEX forms", () => {
  it.each<string>([
    "ALTER INDEX idx_status ATTACH PARTITION other_idx",
    "ALTER INDEX idx_status DEPENDS ON EXTENSION citext",
    "ALTER INDEX idx_status NO DEPENDS ON EXTENSION citext",
  ])("refuses %s to the app's migration", sql => {
    expect(refusal(() => guard([sql], "app", "postgresql"))).toMatchObject({
      belongsTo: "plugin:fx",
    });
  });
});

describe("an attribute reset and a validation on another owner's objects", () => {
  it("refuses RESET of a plugin column's attributes", () => {
    expect(
      refusal(() =>
        guard(
          ["ALTER TABLE app_notes ALTER COLUMN status RESET (n_distinct)"],
          "app",
          "postgresql"
        )
      )
    ).toMatchObject({ table: "app_notes", column: "status" });
  });

  it("refuses VALIDATE CONSTRAINT on another owner's constraint", () => {
    expect(
      refusal(() =>
        guard(
          ["ALTER TABLE app_notes VALIDATE CONSTRAINT fk_owner"],
          "app",
          "postgresql"
        )
      )
    ).toMatchObject({ belongsTo: "plugin:fx" });
  });
});

describe("a table-level change to another owner's table", () => {
  it.each<[SupportedDialect, string]>([
    ["postgresql", "ALTER TABLE fx__notes SET ACCESS METHOD heap"],
    ["postgresql", "ALTER TABLE fx__notes SET TABLESPACE other"],
    ["mysql", "ALTER TABLE fx__notes ENGINE=InnoDB"],
  ])("is refused to the app's migration on %s: %s", (dialect, sql) => {
    expect(refusal(() => guard([sql], "app", dialect))).toMatchObject({
      table: "fx__notes",
      belongsTo: "plugin:fx",
    });
  });

  it("leaves the app's own table's storage to the app", () => {
    expect(() =>
      guard(["ALTER TABLE app_notes SET TABLESPACE other"], "app", "postgresql")
    ).not.toThrow();
  });
});

describe("live index discovery covers in-place index changes", () => {
  it("names an index an ALTER INDEX changes without its table", () => {
    expect(
      indexesNamedWithoutTable(
        ["ALTER INDEX idx_body SET TABLESPACE other"],
        "postgresql"
      )
    ).toEqual(["idx_body"]);
  });

  it("refuses the change to a plugin table's index the database places there", () => {
    expect(() =>
      assertNoForeignDrops({
        statements: ["ALTER INDEX idx_body SET TABLESPACE other"],
        stream: "app",
        owners,
        elementOwners,
        dialect: "postgresql",
        source: "0010_under_test",
        liveTables: new Set([...owners.keys(), "users"]),
        liveIndexTables: new Map([["idx_body", "fx__notes"]]),
      })
    ).toThrow();
  });
});

describe("an in-place refusal is logged as a change", () => {
  it("names the changer, not a dropper", () => {
    const log = refusal(() =>
      guard(
        ["ALTER TABLE app_notes ALTER COLUMN status TYPE int"],
        "app",
        "postgresql"
      )
    );
    expect(log).toHaveProperty("changedBy", "app");
    expect(log).not.toHaveProperty("droppedBy");
  });
});

describe("a form the guard cannot read, on another owner's table, is refused", () => {
  it("refuses attaching another owner's partition index to the app's index", () => {
    expect(
      refusal(() =>
        guard(
          ["ALTER INDEX app_idx ATTACH PARTITION fx_idx"],
          "app",
          "postgresql"
        )
      )
    ).toMatchObject({ element: "fx_idx", belongsTo: "plugin:fx" });
  });

  it("refuses an ALTER of a foreign table the reader does not model", () => {
    expect(
      refusal(() =>
        guard(
          ["ALTER FOREIGN TABLE fx_remote ALTER COLUMN status TYPE bigint"],
          "app",
          "postgresql"
        )
      )
    ).toMatchObject({ table: "fx_remote", belongsTo: "plugin:fx" });
  });

  it("refuses MariaDB's wait spelling before the first change, on a foreign table", () => {
    expect(
      refusal(() =>
        guard(
          ["ALTER TABLE fx__notes NOWAIT MODIFY status varchar(40)"],
          "app",
          "mysql"
        )
      )
    ).toMatchObject({ table: "fx__notes", belongsTo: "plugin:fx" });
  });

  it("refuses an unmodelled clause on a plugin table", () => {
    expect(
      refusal(() =>
        guard(
          ["ALTER TABLE fx__notes DISABLE TRIGGER ALL"],
          "app",
          "postgresql"
        )
      )
    ).toMatchObject({ table: "fx__notes" });
  });

  it("refuses the bulk ALTER INDEX form, which names no index", () => {
    expect(() =>
      guard(
        ["ALTER INDEX ALL IN TABLESPACE old SET TABLESPACE new"],
        "app",
        "postgresql"
      )
    ).toThrow();
  });

  it("keeps an unmodelled clause on the app's own table allowed", () => {
    expect(() =>
      guard(["ALTER TABLE app_notes DISABLE TRIGGER ALL"], "app", "postgresql")
    ).not.toThrow();
  });
});
