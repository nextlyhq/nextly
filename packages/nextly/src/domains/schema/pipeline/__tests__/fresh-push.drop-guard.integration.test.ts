// Regression: freshPushSchema with a core-only schema must NOT drop user
// (dc_/single_/comp_) tables. Pre-fix, drizzle-kit's pushSchema emitted
// DROP TABLE dc_articles (extraneous vs the core schema) and freshPushSchema
// executed it, wiping all collection content on every `nextly migrate` that
// reconciled core. Uses a real in-memory SQLite DB + real drizzle-kit.

import { randomBytes } from "node:crypto";

import Database from "better-sqlite3";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getDialectTables } from "../../../../database/index";

import { freshPushSchema } from "../fresh-push";
import { getMigrateLockDdl } from "../locks";

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle>;

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  db = drizzle({ client: sqlite });
});

afterEach(() => {
  sqlite.close();
  vi.restoreAllMocks();
});

describe("freshPushSchema drop-guard (real SQLite)", () => {
  it("preserves a user dc_ table + its row when reconciling the core schema", async () => {
    const core = getDialectTables("sqlite");

    // 1. Establish the core schema first (fresh DB → only CREATEs, no
    //    extraneous tables, so drizzle-kit emits no rename-ambiguity prompt).
    //    This mirrors a project that has already been migrated once.
    await freshPushSchema("sqlite", db, core);

    // 2. A user collection table appears with content — exactly what the
    //    original data-loss bug destroyed on the next migrate.
    sqlite.exec(
      'CREATE TABLE "dc_articles" ("id" text PRIMARY KEY, "title" text)'
    );
    db.run(
      sql`INSERT INTO "dc_articles" ("id", "title") VALUES ('a1', 'Hello')`
    );

    // 3. Re-reconcile core (what `nextly migrate` Phase 1 does). drizzle-kit
    //    now sees dc_articles as extraneous (no added tables to pair it with),
    //    so it emits a plain DROP TABLE dc_articles — which the guard blocks.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await freshPushSchema("sqlite", db, core);

    // The table and row must still be there.
    const rows = db.all(sql`SELECT "id", "title" FROM "dc_articles"`) as Array<{
      id: string;
      title: string;
    }>;
    expect(rows).toEqual([{ id: "a1", title: "Hello" }]);

    // And the guard logged that it blocked the drop.
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Blocked DROP TABLE "dc_articles"')
    );
  });
});

// Regression (Phase 7, drizzle v1): freshPushSchema on PostgreSQL must scope
// the kit's introspection to the DESIRED tables. Without the entities filter,
// a live table outside the desired set — e.g. the migrate lock table, which
// exists before the core reconcile runs inside the lock — pairs against an
// added table in v1's differ and its rename resolver crashes
// (`resolver(table) was called without a HintsHandler`), killing every
// `nextly migrate` on a fresh PG database. Reproduced live in the Phase 7
// production-path walk.
const PG_URL = process.env.TEST_POSTGRES_URL;

describe.skipIf(!PG_URL)(
  "freshPushSchema orphan scoping (real PostgreSQL)",
  () => {
    it("reconciles core with an unmanaged orphan table present (no resolver crash, orphan preserved)", async () => {
      const { Pool } = await import("pg");
      const { drizzle: drizzlePg } = await import("drizzle-orm/node-postgres");
      const admin = new Pool({ connectionString: PG_URL });
      // Unique per-run database — never pre-drop a fixed name that a
      // concurrent run (or an unrelated database) might own.
      const dbName = `nextly_freshpush_scope_${randomBytes(4).toString("hex")}`;
      await admin.query(`CREATE DATABASE ${dbName}`);
      const url = new URL(PG_URL as string);
      url.pathname = `/${dbName}`;
      const pool = new Pool({ connectionString: url.toString() });
      try {
        // The orphan exists BEFORE the reconcile — the REAL migrate-lock
        // table via the production DDL helper (hand-copied DDL drifts; see
        // .claude/rules/integration-tests.md).
        for (const stmt of getMigrateLockDdl("postgresql")) {
          await pool.query(stmt);
        }
        const pgDb = drizzlePg({ client: pool });
        const core = getDialectTables("postgresql");

        const result = await freshPushSchema("postgresql", pgDb, core);
        expect(result.statementsExecuted).toBeDefined();

        // Orphan untouched; core tables created alongside it.
        const t = await pool.query(
          "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('nextly_migrate_lock','users')"
        );
        const names = t.rows.map((r: { table_name: string }) => r.table_name);
        expect(names).toContain("nextly_migrate_lock");
        expect(names).toContain("users");
      } finally {
        await pool.end();
        await admin.query("DROP DATABASE IF EXISTS nextly_freshpush_scope");
        await admin.end();
      }
    });
  }
);

// The same orphan-pairing crash on SQLite (which has NO kit tables filter):
// an upgrade that adds a new core table while ANY non-core table exists made
// v1's differ pair them and throw its resolver error (probe-verified).
// fresh-push now degrades to the additive-only generateMigration baseline —
// the reconcile completes, the orphan and its data survive, and a hint
// records the degradation.
describe("freshPushSchema orphan + added core table (real SQLite)", () => {
  it("falls back to the additive baseline instead of crashing", async () => {
    const localSqlite = new Database(":memory:");
    try {
      const localDb = drizzle({ client: localSqlite });
      // Live: one core table + one orphan user table with data.
      localSqlite.exec('CREATE TABLE "users" ("id" text PRIMARY KEY NOT NULL)');
      localSqlite.exec(
        'CREATE TABLE "dc_articles" ("id" text PRIMARY KEY, "title" text)'
      );
      localSqlite.exec(`INSERT INTO "dc_articles" VALUES ('a1', 'keep')`);

      // Desired: the existing core table plus a NEW core table — the
      // upgrade shape that crashed v1's rename resolver.
      const { sqliteTable, text } = await import("drizzle-orm/sqlite-core");
      const desired = {
        users: sqliteTable("users", { id: text("id").primaryKey() }),
        newCore: sqliteTable("nextly_new_core", {
          id: text("id").primaryKey(),
        }),
      };

      const result = await freshPushSchema("sqlite", localDb, desired);

      // The new core table was created, the orphan survived with its row,
      // and the degradation is visible in hints.
      const tables = localSqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        )
        .all()
        .map(r => (r as { name: string }).name);
      expect(tables).toContain("nextly_new_core");
      expect(tables).toContain("dc_articles");
      const row = localSqlite
        .prepare('SELECT title FROM "dc_articles" WHERE id = ?')
        .get("a1") as { title: string } | undefined;
      expect(row?.title).toBe("keep");
      expect(
        result.hints.some(h => h.hint.includes("additive-TABLES-only baseline"))
      ).toBe(true);
    } finally {
      localSqlite.close();
    }
  });
});
