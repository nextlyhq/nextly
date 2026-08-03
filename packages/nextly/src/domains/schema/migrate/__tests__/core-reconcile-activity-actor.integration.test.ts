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
 * A degraded pass alone would report success while leaving `activity_log` on
 * its old shape, and the erasure would then fail on a column that does not
 * exist. What makes the alterations land is the SECOND push: once the first
 * has created whatever was missing, nothing is added, the resolver has no pair
 * to resolve, and drizzle-kit emits the alterations itself.
 *
 * The upgrade simulation cannot cover this: it puts its dynamic table in the
 * DESIRED schema, so drizzle-kit never sees an orphan and never degrades.
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

import { getSQLiteDrizzleKit } from "../../../../database/drizzle-kit-lazy";
import { getDialectTablesForPush } from "../../../../database/index";
import { LEGACY_ACTIVITY_LOG_SQLITE } from "../../../audit/__tests__/legacy-activity-log-fixture";
import { users as usersSqlite } from "../../../../schemas/users/sqlite";
import { splitStatements } from "../../pipeline/sql-statement-utils";
import { freshPushSchema } from "../../pipeline/fresh-push";

const TEST_DIR = join(
  tmpdir(),
  `nextly-core-reconcile-actor-${process.pid}-${Date.now()}`
);
const TEST_DB_PATH = join(TEST_DIR, "legacy.db");

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

  beforeAll(async () => {
    if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
    sqlite = new Database(TEST_DB_PATH);
    // `users` is unchanged by this work, so it comes from the production
    // definition. Only `activity_log` is pinned to its historical shape.
    const kit = await getSQLiteDrizzleKit();
    const usersDdl = await kit.generateMigration(
      await kit.generateDrizzleJson({}),
      await kit.generateDrizzleJson({ users: usersSqlite })
    );
    for (const stmt of splitStatements(usersDdl)) sqlite.exec(stmt);
    sqlite.exec(LEGACY_ACTIVITY_LOG_SQLITE);
    sqlite.exec(CONTENT_TABLE);
    // `created_at` / `updated_at` are NOT NULL with a JS-side default in the
    // production definition, so a raw insert has to supply them.
    const nowEpoch = Math.floor(Date.now() / 1000);
    sqlite
      .prepare(
        `INSERT INTO users (id, email, name, is_active, created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?)`
      )
      .run("u-1", "keeper@test.local", "Keeper", nowEpoch, nowEpoch);
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

  it("applies the actor-column changes and keeps the rows", async () => {
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
