/**
 * Statements that remove another owner's table or columns without a DROP
 * TABLE the guard can read in their text, and the rule that refuses each.
 *
 * Every refusal here is reached through `assertNoForeignDrops`, the check
 * each executing path makes before a migration's first statement runs. Each
 * case names `users`, a table the app holds, from a plugin's module, and
 * each has a control: the legitimate shape the rule must still allow.
 */
import { describe, expect, it } from "vitest";

import type { SupportedDialect } from "../../../../database/schema-registry";
import { splitSqlStatements } from "../../migrate/split-sql";
import {
  assertNoForeignDrops,
  columnsAfter,
  UnparsableDropTarget,
} from "../drop-guard";
import type { OwnerRecord } from "../owner-registry";

/** `users` is the app's; `fx__notes` the plugin's own. */
const owners = new Map<string, OwnerRecord>(
  [
    ["users", "app", "app"],
    ["fx__notes", "plugin", "fx"],
  ].map(([tableName, ownerKind, ownerId]) => [
    tableName,
    {
      tableName,
      ownerKind: ownerKind as OwnerRecord["ownerKind"],
      ownerId,
      migratedBy: ownerKind === "app" ? "app" : `plugin:${ownerId}`,
      ownerVersion: null,
      schemaVersion: null,
      state: "active",
    },
  ])
);

/** The tables the database holds before a module runs. */
const LIVE: ReadonlySet<string> = new Set(owners.keys());

const DIALECTS: SupportedDialect[] = ["postgresql", "mysql", "sqlite"];

/**
 * Judges `sql`, split as the runner splits it, as a module of `plugin:fx`
 * run against a database holding `LIVE` — or, with `unread`, one whose
 * tables were not read.
 */
function guard(sql: string, dialect: SupportedDialect, unread = false): void {
  assertNoForeignDrops({
    statements: splitSqlStatements(sql, dialect),
    stream: "plugin:fx",
    owners,
    elementOwners: [],
    dialect,
    source: "plugin:fx/0002_under_test",
    liveTables: unread ? undefined : LIVE,
  });
}

/** The refusal's log context, or a failure when nothing was refused. */
function foreignRefusal(run: () => void): Record<string, unknown> {
  try {
    run();
  } catch (error) {
    expect(error).not.toBeInstanceOf(UnparsableDropTarget);
    expect((error as { code?: string }).code).toBe("DROP_OF_FOREIGN_TABLE");
    return (error as { logContext?: Record<string, unknown> }).logContext ?? {};
  }
  return expect.unreachable("must be refused");
}

/** The reason `guard` refused `sql` as unreadable, or a failure. */
function unreadableReason(sql: string, dialect: SupportedDialect): string {
  try {
    guard(sql, dialect);
  } catch (error) {
    expect(error).toBeInstanceOf(UnparsableDropTarget);
    return (error as UnparsableDropTarget).reason;
  }
  return expect.unreachable("must be refused");
}

/**
 * A PostgreSQL function or procedure runs its body when it is called, and a
 * body written as a quoted string is data to the lexer: a drop in it, or a
 * search-path change that voids creation credit, would pass unread.
 */
describe("a PostgreSQL routine whose body is a quoted string", () => {
  it.each([
    [
      "a function dropping another owner's table",
      "CREATE FUNCTION fx_wipe() RETURNS void LANGUAGE plpgsql AS 'BEGIN DROP TABLE users; END';\nSELECT fx_wipe();",
    ],
    [
      "OR REPLACE, with LANGUAGE after the body",
      "CREATE OR REPLACE FUNCTION fx_wipe() RETURNS void AS 'BEGIN DROP TABLE users; END' LANGUAGE plpgsql;",
    ],
    [
      "a procedure",
      "CREATE PROCEDURE fx_wipe() LANGUAGE sql AS 'DROP TABLE users';\nCALL fx_wipe();",
    ],
    [
      "an escape-string body",
      "CREATE FUNCTION fx_wipe() RETURNS void LANGUAGE sql AS E'DROP TABLE users';",
    ],
    [
      "a unicode-escape string body",
      "CREATE FUNCTION fx_wipe() RETURNS void LANGUAGE sql AS U&'DROP TABLE users';",
    ],
    [
      "a function defined inside a DO block",
      "DO $$ BEGIN CREATE FUNCTION fx_wipe() RETURNS void LANGUAGE sql AS 'DROP TABLE users'; END $$;",
    ],
    [
      "a body hiding a search-path change behind creation credit",
      [
        "CREATE TABLE fx__scratch (id int);",
        "CREATE FUNCTION fx_move() RETURNS void LANGUAGE plpgsql AS 'BEGIN PERFORM set_config(''search_path'', ''x'', false); END';",
        "SELECT fx_move();",
        "DROP TABLE fx__scratch;",
      ].join("\n"),
    ],
  ])("is refused: %s", (_shape, sql) => {
    expect(unreadableReason(sql, "postgresql")).toMatch(
      /body written as a quoted string/
    );
  });

  it("reads a dollar-quoted body as code, and judges the drop in it", () => {
    expect(() =>
      guard(
        "CREATE FUNCTION fx_wipe() RETURNS void LANGUAGE plpgsql AS $$ BEGIN DROP TABLE users; END $$;",
        "postgresql"
      )
    ).toThrow(/different owner/);
  });

  it.each([
    [
      "a dollar-quoted body dropping the plugin's own table",
      "CREATE OR REPLACE FUNCTION fx_reset(label text DEFAULT CAST('a' AS text)) RETURNS void LANGUAGE plpgsql AS $body$ BEGIN DROP TABLE fx__notes; END $body$;\nSELECT fx_reset();",
    ],
    [
      "a SQL-standard body",
      "CREATE FUNCTION fx_count() RETURNS bigint LANGUAGE sql BEGIN ATOMIC SELECT count(*) AS total FROM fx__notes; END;",
    ],
  ])("allows %s", (_shape, sql) => {
    expect(() => guard(sql, "postgresql")).not.toThrow();
  });
});

/**
 * MariaDB's `CREATE OR REPLACE TABLE` drops the table of that name, when
 * there is one, and creates it anew. Read only as a CREATE it took
 * another owner's table and its rows with no drop on record. It runs on the
 * MySQL dialect; the others reject the syntax, and read it the same way.
 */
describe.each(DIALECTS)("CREATE OR REPLACE TABLE on %s", dialect => {
  it.each([
    "CREATE OR REPLACE TABLE users (id int)",
    "CREATE OR REPLACE TEMPORARY TABLE users (id int)",
  ])("is the drop of the table it replaces: %s", sql => {
    expect(foreignRefusal(() => guard(sql, dialect))).toMatchObject({
      table: "users",
      droppedBy: "plugin:fx",
      belongsTo: "app",
    });
  });

  it("refuses the pair with IF NOT EXISTS, which MariaDB rejects", () => {
    expect(
      unreadableReason(
        "CREATE OR REPLACE TABLE IF NOT EXISTS users (id int)",
        dialect
      )
    ).toMatch(/CREATE OR REPLACE TABLE/);
  });

  it("credits a table no live table of the name stood for", () => {
    expect(() =>
      guard(
        "CREATE OR REPLACE TABLE fx__fresh (id int);\nCREATE OR REPLACE TABLE fx__fresh (id int, label text);\nDROP TABLE fx__fresh;",
        dialect
      )
    ).not.toThrow();
  });

  it("drops the table of the name when the live tables were not read", () => {
    expect(
      foreignRefusal(() =>
        guard("CREATE OR REPLACE TABLE fx__fresh (id int)", dialect, true)
      )
    ).toMatchObject({ table: "fx__fresh", belongsTo: null });
  });

  it("leaves a plain CREATE TABLE a creation, as before", () => {
    // The control: without OR REPLACE a CREATE of an existing table fails in
    // the database and drops nothing, and a new one is the module's own.
    expect(() =>
      guard(
        "CREATE TABLE users (id int);\nCREATE TABLE fx__fresh (id int);\nDROP TABLE fx__fresh;",
        dialect
      )
    ).not.toThrow();
  });

  it("stops following the replaced table's columns", () => {
    const live = new Map([["users", new Set(["id", "email"])]]);
    expect(
      columnsAfter(["CREATE OR REPLACE TABLE users (id int)"], dialect, live)
    ).toEqual(new Map());
    // The control: a statement on another table leaves them followed.
    expect(
      columnsAfter(["CREATE TABLE fx__other (id int)"], dialect, live)
    ).toEqual(live);
  });
});

/**
 * PostgreSQL's CASCADE on a DROP of anything but a table also drops what
 * depends on the object: the columns of a dropped type or domain, in
 * whoever's table, a generated column calling a dropped function, a table
 * typed by a dropped type. None of it is named in the text, so it is
 * refused; without CASCADE the database refuses the drop while anything
 * depends on the object.
 */
describe("CASCADE on a PostgreSQL DROP of something other than a table", () => {
  it.each([
    "DROP TYPE user_role CASCADE",
    "DROP TYPE IF EXISTS fx_kind, user_role CASCADE",
    "DROP DOMAIN email CASCADE",
    "DROP EXTENSION postgis CASCADE",
    "DROP FUNCTION fx_slug(text) CASCADE",
    "DROP PROCEDURE fx_reset() CASCADE",
    "DROP VIEW fx_summary CASCADE",
    "DROP MATERIALIZED VIEW fx_totals CASCADE",
    "DROP SEQUENCE fx_counter CASCADE",
    "DROP INDEX fx_notes_label_idx CASCADE",
    "ALTER TYPE user_profile DROP ATTRIBUTE bio CASCADE",
    "DO $$ BEGIN DROP TYPE user_role CASCADE; END $$",
  ])("is refused: %s", statement => {
    expect(unreadableReason(statement, "postgresql")).toMatch(
      /CASCADE on a DROP of anything but a table/
    );
  });

  it("refuses a schema drop with or without CASCADE, as before", () => {
    for (const statement of ["DROP SCHEMA fx", "DROP SCHEMA fx CASCADE"]) {
      expect(unreadableReason(statement, "postgresql")).toMatch(
        /DROP SCHEMA removes tables without naming them/
      );
    }
  });

  it.each([
    [
      "a type the module created, dropped without CASCADE",
      "CREATE TYPE fx_kind AS ENUM ('a', 'b');\nDROP TYPE fx_kind;",
    ],
    ["RESTRICT", "DROP TYPE fx_kind RESTRICT"],
    [
      "a table drop with CASCADE, which generated migrations write",
      "DROP TABLE fx__notes CASCADE",
    ],
    [
      "an ALTER TABLE dropping its own column or constraint with CASCADE",
      "ALTER TABLE fx__notes DROP COLUMN label CASCADE, DROP CONSTRAINT fx__notes_pk CASCADE",
    ],
  ])("allows %s", (_shape, sql) => {
    expect(() => guard(sql, "postgresql")).not.toThrow();
  });

  it("leaves MySQL's CASCADE, which it ignores, as before", () => {
    expect(() => guard("DROP VIEW fx_summary CASCADE", "mysql")).not.toThrow();
  });
});
