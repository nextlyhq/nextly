/**
 * Statements that take another owner's table, column or data without a DROP
 * or an ALTER TABLE naming it as such:
 *
 * - PostgreSQL's `ALTER INDEX t RENAME TO zz`, which renames a TABLE too.
 * - PostgreSQL's `ALTER VIEW|MATERIALIZED VIEW|FOREIGN TABLE t RENAME
 *   [COLUMN]` and `ALTER TYPE t RENAME ATTRIBUTE`, which rename a plain
 *   table's column.
 * - Partition changes: PostgreSQL's `ATTACH PARTITION` and `PARTITION OF`,
 *   MySQL's `DROP|TRUNCATE|EXCHANGE PARTITION`.
 * - `TRUNCATE`.
 * - A SQLite rebuild of another owner's table whose twin keeps every column
 *   and element but not the key, a unique constraint, a column's type, NOT
 *   NULL or default, or whose table has triggers.
 * - A PostgreSQL name over 63 bytes, which the database cuts to 63.
 *
 * Each refusal is paired with the stream's own use of the same form.
 */
import { describe, expect, it } from "vitest";

import type { SupportedDialect } from "../../../../database/schema-registry";
import { NextlyError } from "../../../../errors/nextly-error";
import { assertNoForeignDrops, type LiveElements } from "../drop-guard";
import type { OwnerRecord } from "../owner-registry";

import { liveShape } from "./live-shape";

function record(tableName: string, migratedBy: string): OwnerRecord {
  return {
    tableName,
    ownerKind: migratedBy === "app" ? "app" : "plugin",
    ownerId: migratedBy.replace(/^plugin:/, ""),
    migratedBy,
    ownerVersion: null,
    schemaVersion: null,
    state: "active",
  };
}

/** 63 bytes: the longest name PostgreSQL stores. */
const LONG_OTHER = `other__${"a".repeat(56)}`;

/** `other__t` and the long table are plugin other's; `fx__*` plugin fx's; `app_notes` the app's. */
const owners = new Map<string, OwnerRecord>(
  [
    record("other__t", "plugin:other"),
    record(LONG_OTHER, "plugin:other"),
    record("fx__notes", "plugin:fx"),
    record("fx__p", "plugin:fx"),
    record("app_notes", "app"),
  ].map(row => [row.tableName, row])
);

function guard(
  statements: string[],
  stream: string,
  dialect: SupportedDialect,
  extra: {
    owners?: Map<string, OwnerRecord>;
    liveIndexTables?: ReadonlyMap<string, string>;
    liveTables?: ReadonlySet<string>;
    liveColumns?: Map<string, Set<string>>;
    liveElements?: LiveElements;
  } = {}
): void {
  const rows = extra.owners ?? owners;
  assertNoForeignDrops({
    statements,
    stream,
    owners: rows,
    elementOwners: [...rows.values()],
    dialect,
    source: "0042_under_test",
    liveTables: new Set(rows.keys()),
    liveIndexTables: new Map(),
    ...extra,
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

describe("PostgreSQL's ALTER INDEX ... RENAME of a table", () => {
  it("refuses renaming another owner's table through it, and the drop after", () => {
    expect(
      refusal(() =>
        guard(
          ["ALTER INDEX other__t RENAME TO zz", "DROP TABLE zz"],
          "app",
          "postgresql"
        )
      )
    ).toMatchObject({
      table: "other__t",
      renamedBy: "app",
      belongsTo: "plugin:other",
    });
  });

  it("refuses a core table renamed through it", () => {
    expect(
      refusal(() =>
        guard(["ALTER INDEX IF EXISTS users RENAME TO zz"], "app", "postgresql")
      )
    ).toMatchObject({ table: "users", belongsTo: "core" });
  });

  it("refuses an unclaimed live table renamed through it by a plugin", () => {
    expect(
      refusal(() =>
        guard(
          ["ALTER INDEX blog_posts RENAME TO zz"],
          "plugin:fx",
          "postgresql",
          {
            liveTables: new Set([...owners.keys(), "blog_posts"]),
          }
        )
      )
    ).toMatchObject({ table: "blog_posts", belongsTo: null });
  });

  it("allows a genuine rename of the stream's own index", () => {
    // The control: the live database has the name as an index on fx's table.
    expect(() =>
      guard(
        ["ALTER INDEX fx__notes_label_idx RENAME TO fx__notes_title_idx"],
        "plugin:fx",
        "postgresql",
        { liveIndexTables: new Map([["fx__notes_label_idx", "fx__notes"]]) }
      )
    ).not.toThrow();
  });

  it("allows renaming an index the same list creates", () => {
    // Neither an index nor a table of the name exists before the list runs.
    expect(() =>
      guard(
        [
          "CREATE INDEX fx__notes_tmp_idx ON fx__notes (id)",
          "ALTER INDEX fx__notes_tmp_idx RENAME TO fx__notes_id_idx",
        ],
        "plugin:fx",
        "postgresql"
      )
    ).not.toThrow();
  });

  it("allows the table's own stream to rename it through ALTER INDEX", () => {
    expect(() =>
      guard(["ALTER INDEX other__t RENAME TO zz"], "plugin:other", "postgresql")
    ).not.toThrow();
  });
});

describe("PostgreSQL's column renames through another relation kind", () => {
  it.each([
    "ALTER VIEW other__t RENAME COLUMN a TO b",
    "ALTER VIEW IF EXISTS other__t RENAME a TO b",
    "ALTER MATERIALIZED VIEW other__t RENAME COLUMN a TO b",
    "ALTER FOREIGN TABLE IF EXISTS ONLY other__t RENAME a TO b",
    "ALTER FOREIGN TABLE other__t * RENAME COLUMN a TO b",
    "ALTER TYPE other__t RENAME ATTRIBUTE a TO b CASCADE",
  ])("refuses %s on another owner's table", statement => {
    expect(
      refusal(() => guard([statement], "app", "postgresql"))
    ).toMatchObject({
      table: "other__t",
      column: "a",
      belongsTo: "plugin:other",
    });
  });

  it.each([
    "ALTER TABLE other__t RENAME COLUMN a TO b",
    "ALTER VIEW other__t RENAME COLUMN a TO b",
    "ALTER TYPE other__t RENAME ATTRIBUTE a TO b",
  ])("allows the table's own stream %s", statement => {
    expect(() =>
      guard([statement], "plugin:other", "postgresql")
    ).not.toThrow();
  });

  it("reads a view's own rename as nothing taken", () => {
    // `RENAME TO` renames the view itself, which PostgreSQL refuses on a table.
    expect(() =>
      guard(["ALTER VIEW other__t RENAME TO v2"], "app", "postgresql")
    ).not.toThrow();
  });
});

describe("partition changes", () => {
  it("refuses attaching another owner's table as a partition, and dropping the parent", () => {
    expect(
      refusal(() =>
        guard(
          [
            "CREATE TABLE p (LIKE app_notes) PARTITION BY LIST (id)",
            "ALTER TABLE p ATTACH PARTITION app_notes DEFAULT",
            "DROP TABLE p",
          ],
          "plugin:fx",
          "postgresql"
        )
      )
    ).toMatchObject({ table: "app_notes", belongsTo: "app" });
  });

  it.each([
    "CREATE TABLE p PARTITION OF app_notes DEFAULT",
    "CREATE TABLE IF NOT EXISTS p PARTITION OF app_notes FOR VALUES IN (1)",
    "ALTER TABLE app_notes DETACH PARTITION p",
  ])("refuses changing another owner's partitions: %s", statement => {
    expect(
      refusal(() => guard([statement], "plugin:fx", "postgresql"))
    ).toMatchObject({ table: "app_notes", belongsTo: "app" });
  });

  it.each([
    "ALTER TABLE app_notes DROP PARTITION p0",
    "ALTER TABLE app_notes TRUNCATE PARTITION ALL",
    "ALTER TABLE app_notes EXCHANGE PARTITION p0 WITH TABLE fx__notes",
    "ALTER TABLE fx__notes EXCHANGE PARTITION p0 WITH TABLE app_notes",
  ])("refuses MySQL's %s", statement => {
    expect(
      refusal(() => guard([statement], "plugin:fx", "mysql"))
    ).toMatchObject({ table: "app_notes", belongsTo: "app" });
  });

  it("allows the stream's own partition changes", () => {
    expect(() =>
      guard(
        [
          "CREATE TABLE fx__q (LIKE fx__notes) PARTITION BY LIST (id)",
          "ALTER TABLE fx__p ATTACH PARTITION fx__notes DEFAULT",
          "ALTER TABLE fx__p DETACH PARTITION fx__notes",
          "CREATE TABLE fx__r PARTITION OF fx__p DEFAULT",
        ],
        "plugin:fx",
        "postgresql"
      )
    ).not.toThrow();
    expect(() =>
      guard(
        [
          "ALTER TABLE fx__notes DROP PARTITION p0",
          "ALTER TABLE fx__notes TRUNCATE PARTITION p1",
          "ALTER TABLE fx__notes EXCHANGE PARTITION p2 WITH TABLE fx__p",
        ],
        "plugin:fx",
        "mysql"
      )
    ).not.toThrow();
  });
});

describe("TRUNCATE", () => {
  it.each([
    ["postgresql", "TRUNCATE app_notes"],
    ["postgresql", "TRUNCATE TABLE ONLY fx__notes, app_notes RESTART IDENTITY"],
    ["postgresql", "DO $$ BEGIN TRUNCATE app_notes; END $$"],
    ["mysql", "TRUNCATE TABLE app_notes"],
    ["sqlite", "TRUNCATE app_notes"],
  ] as const)("refuses on %s: %s", (dialect, statement) => {
    expect(
      refusal(() => guard([statement], "plugin:fx", dialect))
    ).toMatchObject({
      table: "app_notes",
      droppedBy: "plugin:fx",
      belongsTo: "app",
    });
  });

  it("refuses PostgreSQL's CASCADE, which empties tables it does not name", () => {
    expect(() =>
      guard(["TRUNCATE fx__notes CASCADE"], "plugin:fx", "postgresql")
    ).toThrow(/cannot be read/);
  });

  it("allows truncating the stream's own table", () => {
    expect(() =>
      guard(
        ["TRUNCATE TABLE fx__notes RESTART IDENTITY RESTRICT"],
        "plugin:fx",
        "postgresql"
      )
    ).not.toThrow();
    expect(() =>
      guard(["TRUNCATE TABLE fx__notes"], "plugin:fx", "mysql")
    ).not.toThrow();
  });

  it("does not read the TRUNCATE privilege or trigger event as a TRUNCATE", () => {
    expect(() =>
      guard(
        [
          "GRANT TRUNCATE ON app_notes TO reader",
          "CREATE TRIGGER t BEFORE TRUNCATE ON fx__notes EXECUTE FUNCTION f()",
        ],
        "plugin:fx",
        "postgresql"
      )
    ).not.toThrow();
  });
});

describe("a SQLite rebuild of another owner's table", () => {
  /** The rebuild of `fx__notes` through a twin of `body`. */
  function rebuild(body: string): string[] {
    return [
      `CREATE TABLE "__new_fx__notes" (${body})`,
      'INSERT INTO "__new_fx__notes" ("id", "label", "code") SELECT "id", "label", "code" FROM "fx__notes"',
      'DROP TABLE "fx__notes"',
      'ALTER TABLE "__new_fx__notes" RENAME TO "fx__notes"',
    ];
  }

  /** `fx__notes` in the database: a key, a NOT NULL default, a unique column. */
  const live = liveShape(
    { id: "TEXT", label: "VARCHAR ( 20 )", code: "TEXT" },
    {
      notNull: ["id", "label"],
      defaults: { label: "'x'" },
      unique: ["code"],
    }
  );

  const KEEPS_ALL =
    `"id" TEXT PRIMARY KEY NOT NULL, "label" varchar(20) NOT NULL DEFAULT ('x'), "code" TEXT UNIQUE, ` +
    `CONSTRAINT "fx__notes_other_ck" CHECK ("label" <> '')`;

  function judge(body: string, stream: string, shape = live): void {
    guard(rebuild(body), stream, "sqlite", {
      liveColumns: new Map([["fx__notes", new Set(["id", "label", "code"])]]),
      liveElements: new Map([
        [
          "fx__notes",
          { index: new Set(), fk: new Set(), check: new Set(), shape },
        ],
      ]),
    });
  }

  it("allows a twin that keeps the key, the unique constraint and every column's definition", () => {
    expect(() => judge(KEEPS_ALL, "plugin:other")).not.toThrow();
    // Declared as table constraints instead, which keeps the same.
    expect(() =>
      judge(
        `"id" TEXT NOT NULL, "label" VARCHAR(20) NOT NULL DEFAULT 'x', "code" TEXT, ` +
          `PRIMARY KEY ("id"), CONSTRAINT "u" UNIQUE ("code")`,
        "plugin:other"
      )
    ).not.toThrow();
  });

  it.each([
    [
      "the primary key",
      `"id" TEXT NOT NULL, "label" varchar(20) NOT NULL DEFAULT 'x', "code" TEXT UNIQUE`,
    ],
    [
      "the unique constraint",
      `"id" TEXT PRIMARY KEY NOT NULL, "label" varchar(20) NOT NULL DEFAULT 'x', "code" TEXT`,
    ],
    [
      "a column's NOT NULL",
      `"id" TEXT PRIMARY KEY NOT NULL, "label" varchar(20) DEFAULT 'x', "code" TEXT UNIQUE`,
    ],
    [
      "a column's default",
      `"id" TEXT PRIMARY KEY NOT NULL, "label" varchar(20) NOT NULL, "code" TEXT UNIQUE`,
    ],
    [
      "a column's default, changed",
      `"id" TEXT PRIMARY KEY NOT NULL, "label" varchar(20) NOT NULL DEFAULT 'y', "code" TEXT UNIQUE`,
    ],
    [
      "a column's type",
      `"id" INTEGER PRIMARY KEY NOT NULL, "label" varchar(20) NOT NULL DEFAULT 'x', "code" TEXT UNIQUE`,
    ],
  ])("refuses a twin that strips %s", (_what, body) => {
    expect(refusal(() => judge(body, "plugin:other"))).toMatchObject({
      table: "fx__notes",
      droppedBy: "plugin:other",
      belongsTo: "plugin:fx",
    });
  });

  it("refuses a rebuild of a table with triggers, which no twin can declare", () => {
    expect(
      refusal(() => judge(KEEPS_ALL, "plugin:other", { ...live, triggers: 1 }))
    ).toMatchObject({ table: "fx__notes", belongsTo: "plugin:fx" });
  });

  it("refuses a rebuild of a table whose shape was not read", () => {
    expect(() =>
      guard(rebuild(KEEPS_ALL), "plugin:other", "sqlite", {
        liveColumns: new Map([["fx__notes", new Set(["id", "label", "code"])]]),
        liveElements: new Map([
          ["fx__notes", { index: new Set(), fk: new Set(), check: new Set() }],
        ]),
      })
    ).toThrow(/strip the keys, column definitions or triggers/);
  });

  it("lets the table's own stream rebuild it as it likes", () => {
    expect(() =>
      judge(`"id" INTEGER, "label" TEXT, "code" TEXT`, "plugin:fx", {
        ...live,
        triggers: 1,
      })
    ).not.toThrow();
  });
});

describe("PostgreSQL's 63-byte names", () => {
  it("refuses a longer name that reaches another owner's table", () => {
    expect(
      refusal(() =>
        guard([`DROP TABLE ${LONG_OTHER}zzzz`], "app", "postgresql")
      )
    ).toMatchObject({ table: LONG_OTHER, belongsTo: "plugin:other" });
  });

  it("matches an owner row recorded longer than PostgreSQL stores", () => {
    const longRow = record(`${LONG_OTHER}tail`, "plugin:other");
    expect(
      refusal(() =>
        guard([`DROP TABLE ${LONG_OTHER}`], "app", "postgresql", {
          owners: new Map([[longRow.tableName, longRow]]),
        })
      )
    ).toMatchObject({ table: LONG_OTHER, belongsTo: "plugin:other" });
  });

  it("cuts at a whole character", () => {
    // `é` is two bytes; at byte 63 it does not fit, so the stored name ends
    // before it, at 62 bytes.
    const stored = `other__${"a".repeat(55)}`;
    const multiByte = record(stored, "plugin:other");
    expect(
      refusal(() =>
        guard([`DROP TABLE "${stored}é"`], "app", "postgresql", {
          owners: new Map([[stored, multiByte]]),
        })
      )
    ).toMatchObject({ table: stored, belongsTo: "plugin:other" });
  });

  it("allows a long name within the limit, and the same text elsewhere", () => {
    // The control: the app's own 63-byte table, and on SQLite, which keeps
    // every byte, the longer name is another table.
    expect(() =>
      guard([`DROP TABLE app_${"b".repeat(59)}`], "app", "postgresql")
    ).not.toThrow();
    expect(() =>
      guard([`DROP TABLE ${LONG_OTHER}zzzz`], "app", "sqlite")
    ).not.toThrow();
  });
});
