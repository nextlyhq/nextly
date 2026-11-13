/**
 * A Single's or field group's save on SQLite, run through the runner a migration file runs through
 * so it waits for a busy table, runs with foreign-key enforcement off for the change, as a file
 * does; it still refuses a change that leaves a row pointing at nothing, and keeps none of it.
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
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(`
    CREATE TABLE parent (id TEXT PRIMARY KEY);
    CREATE TABLE child (id TEXT PRIMARY KEY, parent_id TEXT REFERENCES parent(id));
    INSERT INTO parent VALUES ('p1');
    INSERT INTO child VALUES ('c1', 'p1');
  `);
});

const save = (migrationSQL: string) =>
  applyMigrationWhole({
    db: adapter.getDrizzle(),
    dialect: "sqlite",
    migrationSQL,
    entity: "single",
    busyTable: {
      adapter: adapter as unknown as DrizzleAdapter,
      notify: () => {},
    },
  });

describe("a Builder save on SQLite, waiting for a busy table", () => {
  it("refuses a change that leaves a dangling reference, and keeps none of it", async () => {
    await expect(save("DELETE FROM parent")).rejects.toThrow();
    expect(sqlite.prepare("SELECT id FROM parent").all()).toEqual([
      { id: "p1" },
    ]);
  });

  it("applies a change that leaves every reference whole", async () => {
    await save("ALTER TABLE parent ADD COLUMN label TEXT");
    expect(
      (
        sqlite
          .prepare("SELECT name FROM pragma_table_info('parent')")
          .all() as {
          name: string;
        }[]
      ).map(column => column.name)
    ).toContain("label");
  });
});
