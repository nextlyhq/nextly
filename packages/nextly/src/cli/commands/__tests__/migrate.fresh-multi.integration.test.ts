// #5 regression: `nextly migrate` must apply MORE THAN ONE migration to a
// FRESH database. The managed-table scope used for per-file drift checks was
// captured once before the apply loop; on an empty DB it was [], so the 2nd
// migration saw its table (created by the 1st) as "absent" and aborted with a
// false "schema drift detected". Real in-memory SQLite + real drift engine.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getSchemaEventsDdl } from "../../../domains/schema/events/schema-events-ddl";
import { introspectLiveSnapshot } from "../../../domains/schema/pipeline/diff/introspect-live";
import { runFileMigrations } from "../migrate";

const CREATE_ARTICLES =
  'CREATE TABLE "dc_articles" ("id" text PRIMARY KEY, "created_at" integer, ' +
  '"updated_at" integer, "title" text NOT NULL, "slug" text NOT NULL, "body" text)';
const ADD_AUTHOR = 'ALTER TABLE "dc_articles" ADD COLUMN "author" text';
const HASH = "a".repeat(64); // valid 64-char hex; reconcile uses snapshots, not the hash

let dir: string;
let sqlite: Database.Database;
let db: ReturnType<typeof drizzle>;

const logger = {
  debug: () => {},
  warn: () => {},
  success: () => {},
} as unknown as Parameters<typeof runFileMigrations>[0]["logger"];

// Minimal CLI-adapter surface runFileMigrations touches.
function makeAdapter() {
  return {
    listTables: () =>
      Promise.resolve(
        sqlite
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all()
          .map(r => (r as { name: string }).name)
      ),
    executeQuery: (q: string) => {
      sqlite.exec(q);
      return Promise.resolve([]);
    },
    getDrizzle: () => db,
  } as unknown as Parameters<typeof runFileMigrations>[0]["adapter"];
}

function snapshotFile(snapshot: unknown): string {
  return JSON.stringify({ version: 1, migrationHash: HASH, snapshot });
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "nextly-fresh-multi-"));
  mkdirSync(join(dir, "meta"), { recursive: true });
  sqlite = new Database(":memory:");
  db = drizzle(sqlite);

  // Bootstrap the ledger (what migrate Phase 1 does out-of-band).
  for (const stmt of getSchemaEventsDdl("sqlite")) sqlite.exec(stmt);

  // Build the two target snapshots BY INTROSPECTION so they match the drift
  // engine's format exactly, then reset the DB to empty (fresh-DB scenario).
  sqlite.exec(CREATE_ARTICLES);
  const snap1 = await introspectLiveSnapshot(db, "sqlite", ["dc_articles"]);
  sqlite.exec(ADD_AUTHOR);
  const snap2 = await introspectLiveSnapshot(db, "sqlite", ["dc_articles"]);
  sqlite.exec('DROP TABLE "dc_articles"');

  // 0001 creates dc_articles; 0002 adds the author column.
  writeFileSync(join(dir, "0001_init.sql"), `-- UP\n${CREATE_ARTICLES};`);
  writeFileSync(join(dir, "meta", "0001_init.snapshot.json"), snapshotFile(snap1));
  writeFileSync(join(dir, "0002_add_author.sql"), `-- UP\n${ADD_AUTHOR};`);
  writeFileSync(
    join(dir, "meta", "0002_add_author.snapshot.json"),
    snapshotFile(snap2)
  );
});

afterEach(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("runFileMigrations (fresh DB, multiple migrations)", () => {
  it("applies BOTH migrations to a fresh DB without false drift", async () => {
    const applied = await runFileMigrations({
      adapter: makeAdapter(),
      db,
      dialect: "sqlite",
      migrationsDir: dir,
      logger,
    });

    expect(applied).toBe(2);
    // The 2nd migration's ALTER actually ran → author column exists.
    const cols = (
      db.all(sql`PRAGMA table_info("dc_articles")`) as Array<{ name: string }>
    ).map(c => c.name);
    expect(cols).toContain("author");
  });
});
