/**
 * An existing database gains the working-draft constraint, and the constraint
 * actually refuses a duplicate once it is there.
 *
 * A freshly created database gets the column and the index straight from the
 * schema, so a test built on one would pass while proving nothing about the
 * case that matters. This builds the PRE-CHANGE shape by hand — a historical
 * artifact, deliberately not derived from today's definition — alongside an
 * ordinary content table, because an orphan `dc_*` table is what makes
 * drizzle-kit's resolver degrade to a CREATE-only pass that can add a table but
 * never alter one. Without the orphan this would exercise the easy path.
 *
 * The final assertion is a WRITE. Introspection can report a column and an
 * index while the constraint enforces nothing, and only a refused insert
 * separates those.
 */
import { existsSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import Database from "better-sqlite3";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDialectTablesForPush } from "../../../database/index";
import { freshPushSchema } from "../../schema/pipeline/fresh-push";
import { workingDraftKey } from "../working-draft-key";

const TEST_DIR = join(
  tmpdir(),
  `nextly-working-draft-upgrade-${process.pid}-${Date.now()}`
);
const TEST_DB_PATH = join(TEST_DIR, "legacy.db");

/** `nextly_versions` as it stood before the working-draft constraint. */
const LEGACY_VERSIONS = `
  CREATE TABLE "nextly_versions" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "scope_kind" TEXT NOT NULL,
    "scope_slug" TEXT NOT NULL,
    "entry_id" TEXT NOT NULL,
    "version_no" INTEGER,
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

/** The orphan: ordinary user content, absent from the core-only push. */
const CONTENT_TABLE = `
  CREATE TABLE "dc_articles" (
    "id" TEXT PRIMARY KEY,
    "title" TEXT
  )`;

interface ColumnInfo {
  name: string;
}

describe("working-draft constraint on a pre-change database", () => {
  let sqlite: Database.Database;

  beforeAll(() => {
    if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
    sqlite = new Database(TEST_DB_PATH);
    sqlite.exec(LEGACY_VERSIONS);
    sqlite.exec(CONTENT_TABLE);
    // A working draft already stored under the old shape, so the upgrade is
    // proven to run against real data rather than an empty table.
    sqlite
      .prepare(
        `INSERT INTO nextly_versions
           (id, scope_kind, scope_slug, entry_id, version_no, status,
            is_autosave, snapshot, locale, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, 'draft', 0, ?, NULL, 1000, 1000)`
      )
      .run("v-1", "collection", "posts", "e-1", '{"title":"before"}');
  });

  afterAll(() => {
    try {
      sqlite?.close();
    } catch {
      // ignore teardown errors
    }
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  const indexNames = (): string[] =>
    (
      sqlite
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`)
        .all() as Array<{ name: string }>
    ).map(r => r.name);

  const columnNames = (): string[] =>
    (
      sqlite
        .prepare(`PRAGMA table_info("nextly_versions")`)
        .all() as ColumnInfo[]
    ).map(c => c.name);

  it("adds the column and the index, and the index then refuses a duplicate", async () => {
    // The premise: the old shape really is in place, and there really is an
    // orphan for the resolver to trip over.
    expect(columnNames()).not.toContain("draft_key");
    expect(indexNames()).not.toContain("nextly_versions_working_draft_uidx");
    expect(
      sqlite
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name='dc_articles'`
        )
        .all()
    ).toHaveLength(1);

    const db = drizzleSqlite({ client: sqlite });
    await freshPushSchema("sqlite", db, getDialectTablesForPush("sqlite"));

    expect(columnNames()).toContain("draft_key");
    expect(indexNames()).toContain("nextly_versions_working_draft_uidx");

    // The row that was there before the upgrade is still there.
    expect(
      sqlite.prepare(`SELECT id FROM nextly_versions WHERE id = 'v-1'`).all()
    ).toHaveLength(1);

    // And the constraint does its job: two working drafts for one document and
    // locale cannot both exist.
    const key = workingDraftKey(
      { scopeKind: "collection", scopeSlug: "posts", entryId: "e-2" },
      null
    );
    const insertDraft = (id: string): void => {
      sqlite
        .prepare(
          `INSERT INTO nextly_versions
             (id, scope_kind, scope_slug, entry_id, version_no, status,
              is_autosave, snapshot, locale, draft_key, created_at, updated_at)
           VALUES (?, 'collection', 'posts', 'e-2', NULL, 'draft', 0, ?, NULL, ?, 1000, 1000)`
        )
        .run(id, '{"title":"x"}', key);
    };
    insertDraft("v-2");
    expect(() => insertDraft("v-3")).toThrow(/UNIQUE constraint failed/);
  });
});
