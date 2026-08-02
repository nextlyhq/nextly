/**
 * The core reconcile really alters `activity_log` on an existing SQLite
 * database that also holds ordinary content.
 *
 * `reconcileCore` pushes ONLY the static tables, and drizzle-kit's SQLite
 * entrypoint takes no table filter — so it introspects the whole live
 * database and sees every `dc_*` content table as an orphan. That is the
 * condition under which its rename resolver crashes, and Nextly recovers by
 * generating a CREATE-only baseline from an empty snapshot: a pass that can
 * add missing TABLES but never alters an existing one, and whose redundant
 * `CREATE` statements are swallowed as "already exists".
 *
 * If this change's alterations landed in that degraded pass, an upgrade would
 * report success while leaving `activity_log` on its old shape — and the
 * erasure would then fail on a column that does not exist, taking every user
 * deletion down with it. The upgrade simulation cannot answer this: it puts
 * its dynamic table in the DESIRED schema, so drizzle-kit never sees an
 * orphan and never takes the fallback.
 *
 * The fixture is the pre-change shape written out by hand on purpose. It is a
 * historical artifact, not a copy of the current schema — deriving it from
 * today's definition would assert nothing.
 */

import { existsSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import Database from "better-sqlite3";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDialectTablesForPush } from "../../../../database/index";
import { freshPushSchema } from "../../pipeline/fresh-push";

const TEST_DIR = join(
  tmpdir(),
  `nextly-core-reconcile-actor-${process.pid}-${Date.now()}`
);
const TEST_DB_PATH = join(TEST_DIR, "legacy.db");

/** `activity_log` exactly as it stood before this change. */
const LEGACY_ACTIVITY_LOG = `
  CREATE TABLE "activity_log" (
    "id" TEXT PRIMARY KEY,
    "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "user_name" TEXT NOT NULL,
    "user_email" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "collection" TEXT NOT NULL,
    "entry_id" TEXT,
    "entry_title" TEXT,
    "metadata" TEXT,
    "created_at" INTEGER NOT NULL
  )`;

const LEGACY_USERS = `
  CREATE TABLE "users" (
    "id" TEXT PRIMARY KEY,
    "name" TEXT,
    "email" TEXT NOT NULL UNIQUE,
    "email_verified" INTEGER,
    "password_updated_at" INTEGER,
    "image" TEXT,
    "password_hash" TEXT,
    "is_active" INTEGER NOT NULL DEFAULT 0,
    "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" INTEGER,
    "created_at" INTEGER NOT NULL DEFAULT (unixepoch()),
    "updated_at" INTEGER NOT NULL DEFAULT (unixepoch())
  )`;

/** The orphan: ordinary user content, absent from the core-only push. */
const CONTENT_TABLE = `
  CREATE TABLE "dc_articles" (
    "id" TEXT PRIMARY KEY,
    "title" TEXT
  )`;

interface ColumnInfo {
  name: string;
  notnull: number;
}

describe("core reconcile on a pre-change SQLite database with content", () => {
  let sqlite: Database.Database;

  beforeAll(() => {
    if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
    sqlite = new Database(TEST_DB_PATH);
    sqlite.exec(LEGACY_USERS);
    sqlite.exec(LEGACY_ACTIVITY_LOG);
    sqlite.exec(CONTENT_TABLE);
    sqlite
      .prepare(
        `INSERT INTO users (id, email, name, is_active) VALUES (?, ?, ?, 1)`
      )
      .run("u-1", "keeper@test.local", "Keeper");
    sqlite
      .prepare(
        `INSERT INTO activity_log
           (id, user_id, user_name, user_email, action, collection, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "a-1",
        "u-1",
        "Keeper",
        "keeper@test.local",
        "create",
        "posts",
        1000
      );
  });

  afterAll(() => {
    try {
      sqlite?.close();
    } catch {
      // ignore teardown errors
    }
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // `it.fails` because the reconcile does NOT do this today, and the assertions
  // below say what it must do. Written as an expectation rather than a
  // description of the bug so it inverts the moment someone repairs the
  // degraded pass — at which point delete this wrapper, and the guard in
  // `UserMutationService.activityLogSupportsErasure` that exists to survive it.
  it.fails("applies the actor-column changes and keeps the rows", async () => {
    // The premise: the old shape really is in place, and there really is an
    // orphan content table for the resolver to trip over. Without both, this
    // suite would exercise the ordinary path and prove nothing.
    const before = sqlite
      .prepare(`PRAGMA table_info("activity_log")`)
      .all() as ColumnInfo[];
    expect(before.map(c => c.name)).not.toContain("identity_erased_at");
    expect(before.find(c => c.name === "user_name")?.notnull).toBe(1);
    expect(
      sqlite
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name='dc_articles'`
        )
        .all()
    ).toHaveLength(1);

    const db = drizzleSqlite({ client: sqlite });
    await freshPushSchema("sqlite", db, getDialectTablesForPush("sqlite"));

    const after = sqlite
      .prepare(`PRAGMA table_info("activity_log")`)
      .all() as ColumnInfo[];
    // The marker the erasure writes; without it every user deletion fails.
    expect(after.map(c => c.name)).toContain("identity_erased_at");
    // The identity columns have to be erasable.
    expect(after.find(c => c.name === "user_name")?.notnull).toBe(0);
    expect(after.find(c => c.name === "user_email")?.notnull).toBe(0);
    // And the cascade that destroyed the trail has to be gone.
    const keys = sqlite
      .prepare(`PRAGMA foreign_key_list("activity_log")`)
      .all();
    expect(keys).toHaveLength(0);

    // A reconcile that reached the new shape by recreating the table would
    // have thrown the history away, which is the defect in another form.
    const rows = sqlite
      .prepare(`SELECT id, user_id FROM activity_log`)
      .all() as Array<{ id: string; user_id: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe("u-1");
  });
});
