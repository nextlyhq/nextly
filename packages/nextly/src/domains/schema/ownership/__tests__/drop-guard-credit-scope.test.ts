/**
 * Where an addition earns a later change its credit, and where a name looked
 * up once before a list runs still reaches what it did.
 *
 * A column or constraint a list adds to another owner's table is the list's
 * to change afterwards. The credit is given only where the text proves the
 * addition: a clause that can only add a column (`ADD COLUMN c`, or `ADD`
 * followed by a quoted name), in an ALTER TABLE the executor runs as written
 * (one that opens its statement, not one inside a routine body that may
 * never run). Anything else earns nothing, so a later change is judged as
 * its owner's.
 *
 * An index named without its table, and a PostgreSQL ALTER TABLE target, are
 * looked up in the live database once, before the list runs. Once a
 * statement of the list drops, renames or moves a relation of that name, the
 * name may reach another relation that it shadowed, so a later statement
 * naming it is refused.
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

const elementOwners: OwnerRecord[] = [
  ...owners.values(),
  // The plugin's index on its own table.
  record({
    tableName: "fx__notes",
    elementKind: "index",
    elementName: "idx_status",
  }),
];

function guard(
  statements: string[],
  dialect: SupportedDialect,
  liveIndexTables?: ReadonlyMap<string, string>
): void {
  assertNoForeignDrops({
    statements,
    stream: "app",
    owners,
    elementOwners,
    dialect,
    source: "0012_under_test",
    liveTables: new Set([...owners.keys(), "idx_status"]),
    liveIndexTables,
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

describe("an ADD clause that does not prove a column", () => {
  it.each<[string, string]>([
    // MariaDB's table-level forms: `system` and `period` are keywords here,
    // not columns. Written in lower case, as MariaDB accepts them, so the
    // word is spelled as a column of that name would be stored.
    ["ALTER TABLE fx__notes ADD system versioning", "system"],
    ["ALTER TABLE fx__notes ADD period for valid (a, b)", "period"],
    // A bare word may be a keyword of a form not listed anywhere.
    ["ALTER TABLE fx__notes ADD extra int", "extra"],
  ])("earns no credit: %s", (add, column) => {
    expect(
      refusal(() =>
        guard([add, `ALTER TABLE fx__notes MODIFY ${column} bigint`], "mysql")
      )
    ).toMatchObject({ table: "fx__notes", column });
  });

  it.each<[SupportedDialect, string]>([
    ["mysql", "ALTER TABLE fx__notes ADD `app_extra` int"],
    ["mysql", "ALTER TABLE fx__notes ADD COLUMN app_extra int"],
    ["postgresql", 'ALTER TABLE fx__notes ADD "app_extra" int'],
  ])("still credits a column the clause proves (%s): %s", (dialect, add) => {
    const change =
      dialect === "mysql"
        ? "ALTER TABLE fx__notes MODIFY app_extra bigint"
        : "ALTER TABLE fx__notes ALTER COLUMN app_extra SET NOT NULL";
    expect(() => guard([add, change], dialect)).not.toThrow();
  });
});

describe("an addition inside a routine body", () => {
  it("earns no credit for a MySQL procedure's body, which may never run", () => {
    expect(
      refusal(() =>
        guard(
          [
            "CREATE PROCEDURE add_extra() BEGIN ALTER TABLE fx__notes ADD COLUMN app_extra int; END",
            "ALTER TABLE fx__notes MODIFY app_extra bigint",
          ],
          "mysql"
        )
      )
    ).toMatchObject({ table: "fx__notes", column: "app_extra" });
  });

  it("earns no credit for a MariaDB anonymous block, whose branches may not run", () => {
    expect(
      refusal(() =>
        guard(
          [
            "BEGIN NOT ATOMIC IF 1 = 0 THEN ALTER TABLE fx__notes ADD COLUMN app_extra int; END IF; END",
            "ALTER TABLE fx__notes MODIFY app_extra bigint",
          ],
          "mysql"
        )
      )
    ).toMatchObject({ table: "fx__notes", column: "app_extra" });
  });

  it("earns no credit for a constraint added in a MySQL procedure's body", () => {
    expect(
      refusal(() =>
        guard(
          [
            "CREATE PROCEDURE add_chk() BEGIN ALTER TABLE fx__notes ADD CONSTRAINT app_chk CHECK (true); END",
            "ALTER TABLE fx__notes ALTER CHECK app_chk NOT ENFORCED",
          ],
          "mysql"
        )
      )
    ).toMatchObject({ table: "fx__notes", element: "app_chk" });
  });
});

describe("a name looked up after the list vacated it", () => {
  it("refuses an ALTER TABLE of a name an earlier DROP TABLE vacated", () => {
    // Before the list, `idx_status` reaches the app's table, which shadows
    // the plugin's index of that name on the search path; once the table is
    // dropped, the same name reaches the index.
    expect(() =>
      guard(
        [
          "DROP TABLE idx_status",
          "ALTER TABLE idx_status SET TABLESPACE other",
        ],
        "postgresql",
        new Map()
      )
    ).toThrow(NextlyError);
  });

  it.each<SupportedDialect>(["postgresql", "sqlite"])(
    "refuses a DROP INDEX of a name an earlier DROP TABLE vacated (%s)",
    dialect => {
      // No row records an index named `shadowed`, and before the list the
      // name reaches a table, so the lookup finds no index: read alone, the
      // DROP INDEX takes nothing.
      expect(() =>
        guard(
          ["DROP TABLE shadowed", "DROP INDEX shadowed"],
          dialect,
          new Map()
        )
      ).toThrow(NextlyError);
    }
  );

  it.each<string>([
    "DROP VIEW shadowed",
    "DROP MATERIALIZED VIEW IF EXISTS shadowed",
    "DROP SEQUENCE shadowed",
    "DROP FOREIGN TABLE shadowed",
    "DROP TYPE shadowed",
    "ALTER VIEW shadowed RENAME TO other",
    "ALTER MATERIALIZED VIEW shadowed SET SCHEMA archive",
    "ALTER SEQUENCE shadowed RENAME TO other",
  ])(
    "refuses an ALTER TABLE of a name another relation kind vacated: %s",
    vacating => {
      // Any PostgreSQL relation can shadow an index of the same name on the
      // search path, and ALTER TABLE reaches an index once it is gone.
      expect(() =>
        guard(
          [vacating, "ALTER TABLE shadowed SET TABLESPACE fast"],
          "postgresql",
          new Map()
        )
      ).toThrow(NextlyError);
    }
  );

  it("refuses a second DROP INDEX of a name the first one vacated", () => {
    expect(() =>
      guard(
        ["DROP INDEX app_idx", "DROP INDEX app_idx"],
        "postgresql",
        new Map([["app_idx", "app_notes"]])
      )
    ).toThrow(NextlyError);
  });

  it.each<string[]>([
    // A table the list creates again under the name is what the name reaches.
    [
      "DROP TABLE app_notes",
      "CREATE TABLE app_notes (id int)",
      "ALTER TABLE app_notes ADD COLUMN extra int",
    ],
    // So is a table renamed onto it.
    [
      "ALTER TABLE app_notes RENAME TO app_notes_old",
      "ALTER TABLE app_notes_old ADD COLUMN extra int",
    ],
    // An index dropped and created again is never looked up after the drop.
    ["DROP INDEX app_idx", "CREATE INDEX app_idx ON app_notes (id)"],
  ])(
    "allows a list whose later statements reach what it made: %s",
    (...sql) => {
      expect(() =>
        guard(sql, "postgresql", new Map([["app_idx", "app_notes"]]))
      ).not.toThrow();
    }
  );
});
