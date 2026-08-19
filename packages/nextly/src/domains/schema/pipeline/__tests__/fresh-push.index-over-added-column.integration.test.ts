/**
 * A core table that gains an INDEXED column reaches an existing database.
 *
 * The degraded pass is diffed from an EMPTY snapshot, which is what lets it
 * create a missing table without altering an existing one. That snapshot also
 * carries every index, so the pass emits `CREATE INDEX` for indexes over
 * columns the live table does not have yet — while never emitting the
 * `ALTER TABLE ADD COLUMN` that would create them, by design.
 *
 * Those index statements fail with "no such column". That is not an
 * idempotency error, so before this was handled it escaped, the first pass
 * threw, and the SECOND pass — the one that adds the column and then indexes
 * it — never ran. The net effect was that no core table could gain an indexed
 * column on any dialect that degrades.
 *
 * The old shape here is synthetic rather than historical: the mechanism is
 * "an index in the desired schema names a column the live table lacks", and
 * dropping any indexed column from a live table reproduces it. `version_no` is
 * used because it is nullable on every dialect, so the second pass can add it
 * without a default and the test observes the pipeline rather than a
 * NOT NULL rebuild.
 */
import { existsSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import Database from "better-sqlite3";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDialectTablesForPush } from "../../../../database/index";
import { freshPushSchema } from "../fresh-push";

const TEST_DIR = join(
  tmpdir(),
  `nextly-fresh-push-indexed-column-${process.pid}-${Date.now()}`
);
const TEST_DB_PATH = join(TEST_DIR, "legacy.db");

/** `nextly_versions` without `version_no`, which two of its indexes name. */
const LEGACY_VERSIONS = `
  CREATE TABLE "nextly_versions" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "scope_kind" TEXT NOT NULL,
    "scope_slug" TEXT NOT NULL,
    "entry_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "is_autosave" INTEGER NOT NULL DEFAULT 0,
    "snapshot" TEXT NOT NULL,
    "label" TEXT,
    "locale" TEXT,
    "source_version_no" INTEGER,
    "created_by" TEXT,
    "created_at" INTEGER NOT NULL,
    "updated_at" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0
  )`;

/** The orphan that makes the resolver degrade; without it this path is not taken. */
const CONTENT_TABLE = `
  CREATE TABLE "dc_articles" (
    "id" TEXT PRIMARY KEY,
    "title" TEXT
  )`;

describe("fresh-push: a core table gains an indexed column", () => {
  let sqlite: Database.Database;

  beforeAll(() => {
    if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
    sqlite = new Database(TEST_DB_PATH);
    sqlite.exec(LEGACY_VERSIONS);
    sqlite.exec(CONTENT_TABLE);
    sqlite
      .prepare(
        `INSERT INTO nextly_versions
           (id, scope_kind, scope_slug, entry_id, status, is_autosave,
            snapshot, created_at, updated_at)
         VALUES ('v-1', 'collection', 'posts', 'e-1', 'draft', 0, '{}', 1000, 1000)`
      )
      .run();
  });

  afterAll(() => {
    try {
      sqlite?.close();
    } catch {
      // ignore teardown errors
    }
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  const columnNames = (): string[] =>
    (
      sqlite.prepare(`PRAGMA table_info("nextly_versions")`).all() as Array<{
        name: string;
      }>
    ).map(c => c.name);

  const indexNames = (): string[] =>
    (
      sqlite
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`)
        .all() as Array<{ name: string }>
    ).map(r => r.name);

  it("adds the column and its index instead of throwing", async () => {
    // The premise: the column really is missing and the orphan really is there.
    expect(columnNames()).not.toContain("version_no");
    expect(
      sqlite
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name='dc_articles'`
        )
        .all()
    ).toHaveLength(1);

    const db = drizzleSqlite({ client: sqlite });
    await freshPushSchema("sqlite", db, getDialectTablesForPush("sqlite"));

    expect(columnNames()).toContain("version_no");
    expect(indexNames()).toContain("nextly_versions_seq_uidx");
    // The existing row survives: a reconcile that reached the new shape by
    // recreating the table would have thrown the content away.
    expect(
      sqlite.prepare(`SELECT id FROM nextly_versions WHERE id = 'v-1'`).all()
    ).toHaveLength(1);
  });
});
