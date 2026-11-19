/**
 * A SQLite migration's rebuild that changes a column's type (`types`), on a real database, run as a
 * Single's save runs it (`applyMigrationWhole` with a busy-table wait).
 *
 * - A value the new type's affinity converts arrives converted.
 * - A value it cannot convert, which SQLite would otherwise keep in its old storage class, refuses
 *   the change inside the transaction, so nothing changes. The values are judged before a save
 *   plans the change; this holds where a value was written in between.
 * - The declared type is the one asked for, with no modifier left over from the old declaration.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import type Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";

import { applyMigrationWhole } from "../apply-migration-statements";

let adapter: ReturnType<typeof createSqliteAdapter>;
let sqlite: Database.Database;

beforeEach(async () => {
  adapter = createSqliteAdapter({ memory: true });
  await adapter.connect();
  sqlite = adapter.getDrizzle<{ $client: Database.Database }>().$client;
});

/** The table rebuilt with `score` of `type`, as a Single's save rebuilds it. */
const changeScoreTo = (type: string) =>
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

  it("refuses a value the new type cannot take, with nothing changed", async () => {
    sqlite.exec(`
      CREATE TABLE single_home (id TEXT PRIMARY KEY, score TEXT);
      INSERT INTO single_home VALUES ('h1', 'abc');
    `);

    const refusal = await changeScoreTo("integer").then(
      () => undefined,
      (error: unknown) => error
    );

    expect(JSON.stringify(refusal)).toContain("TYPE_CHANGE_LOSES_VALUES");
    expect(declared()).toBe("text");
    expect(stored()).toEqual({ score: "abc", class: "text" });
  });

  // An INTEGER column stores a fraction as REAL rather than refusing it, so a value a whole-number
  // type cannot take is refused as one the type cannot take at all is.
  it("refuses a fraction for a whole-number type, with nothing changed", async () => {
    sqlite.exec(`
      CREATE TABLE single_home (id TEXT PRIMARY KEY, score TEXT);
      INSERT INTO single_home VALUES ('h1', '1.5');
    `);

    const refusal = await changeScoreTo("integer").then(
      () => undefined,
      (error: unknown) => error
    );

    expect(JSON.stringify(refusal)).toContain("TYPE_CHANGE_LOSES_VALUES");
    expect(declared()).toBe("text");
    expect(stored()).toEqual({ score: "1.5", class: "text" });
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
