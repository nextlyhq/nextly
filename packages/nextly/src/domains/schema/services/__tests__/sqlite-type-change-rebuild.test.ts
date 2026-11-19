/**
 * A SQLite migration's rebuild that changes a column's type (`types`), on a real database, run as a
 * Single's save runs it (`applyMigrationWhole` with a busy-table wait).
 *
 * - A value the new type's affinity converts arrives converted.
 * - The change's own judgement of the values runs on the rebuild's transaction before the copy,
 *   reading the table as the copy would carry it; its refusal leaves nothing changed. SQLite would
 *   otherwise keep a value it cannot convert in its old storage class.
 * - The declared type is the one asked for, with no modifier left over from the old declaration.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import type Database from "better-sqlite3";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";

import { applyMigrationWhole } from "../apply-migration-statements";

let adapter: ReturnType<typeof createSqliteAdapter>;
let sqlite: Database.Database;

beforeEach(async () => {
  adapter = createSqliteAdapter({ memory: true });
  await adapter.connect();
  sqlite = adapter.getDrizzle<{ $client: Database.Database }>().$client;
});

/** The table rebuilt with `score` of `type`, as a Single's save rebuilds it. */
const changeScoreTo = (type: string, judge?: (db: unknown) => Promise<void>) =>
  applyMigrationWhole({
    db: adapter.getDrizzle(),
    dialect: "sqlite",
    migrationSQL: "",
    entity: "single",
    busyTable: {
      adapter: adapter as unknown as DrizzleAdapter,
      notify: () => {},
    },
    sqliteNullability: {
      adapter: adapter as unknown as DrizzleAdapter,
      tableName: "single_home",
      required: new Map(),
      types: new Map([["score", type]]),
      ...(judge === undefined ? {} : { judge }),
    },
  });

const declared = () =>
  (
    sqlite
      .prepare(
        "SELECT type FROM pragma_table_info('single_home') WHERE name = 'score'"
      )
      .get() as { type: string }
  ).type.toLowerCase();

const stored = () =>
  sqlite
    .prepare("SELECT score, typeof(score) AS class FROM single_home")
    .get() as { score: unknown; class: string };

describe("a SQLite rebuild that changes a column's type", () => {
  it("converts a value the new type takes", async () => {
    sqlite.exec(`
      CREATE TABLE single_home (id TEXT PRIMARY KEY, score TEXT);
      INSERT INTO single_home VALUES ('h1', '12');
    `);

    await changeScoreTo("integer");

    expect(declared()).toBe("integer");
    expect(stored()).toEqual({ score: 12, class: "integer" });
  });

  // SQLite keeps a value it cannot convert ("abc" stays text in an integer column), so the
  // change's own judgement runs first, on the rebuild's transaction, where no write can come
  // between it and the copy: what it reads is what the copy would carry.
  it("judges the values on its own transaction before the copy, and refuses with nothing changed", async () => {
    sqlite.exec(`
      CREATE TABLE single_home (id TEXT PRIMARY KEY, score TEXT);
      INSERT INTO single_home VALUES ('h1', 'abc');
    `);
    const seen: unknown[] = [];

    const refusal = await changeScoreTo("integer", async db => {
      const rows = await Promise.resolve(
        (db as { all(query: unknown): unknown }).all(
          sql`SELECT score FROM single_home`
        )
      );
      seen.push(...(rows as { score: unknown }[]).map(row => row.score));
      throw NextlyError.validation({
        errors: [
          {
            path: "score",
            code: "TYPE_CHANGE_LOSES_VALUES",
            message: "score holds a value a number cannot take.",
          },
        ],
      });
    }).then(
      () => undefined,
      (error: unknown) => error
    );

    expect(seen, "what the judgement read").toEqual(["abc"]);
    expect(JSON.stringify(refusal)).toContain("TYPE_CHANGE_LOSES_VALUES");
    expect(declared()).toBe("text");
    expect(stored()).toEqual({ score: "abc", class: "text" });
  });

  it("keeps a fraction for a type that holds one", async () => {
    sqlite.exec(`
      CREATE TABLE single_home (id TEXT PRIMARY KEY, score TEXT);
      INSERT INTO single_home VALUES ('h1', '1.5');
    `);

    await changeScoreTo("real");

    expect(stored()).toEqual({ score: 1.5, class: "real" });
  });

  it("declares the new type without the old declaration's modifier", async () => {
    sqlite.exec(`
      CREATE TABLE single_home (id TEXT PRIMARY KEY, score NUMERIC(10,2));
      INSERT INTO single_home VALUES ('h1', 3);
    `);

    await changeScoreTo("integer");

    expect(declared()).toBe("integer");
    expect(stored()).toEqual({ score: 3, class: "integer" });
  });
});
