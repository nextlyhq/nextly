// F3 integration tests — real PostgreSQL via docker-compose.
//
// SQLite-specific real-DB tests already live in
// pushschema-pipeline.test.ts (the PR-4 review additions cover the
// recreate-pattern + PRAGMA wrapping path against in-memory better-sqlite3).
//
// This file covers PostgreSQL via TEST_POSTGRES_URL (auto-skips when
// unset). MySQL is deferred to F15 — F3 has no MySQL-specific code
// path beyond the executor, and the executor is dialect-uniform for
// MySQL/PG.
//
// Six scenarios from F3 spec §8 acceptance criteria. Most are
// dialect-uniform (PG and SQLite behave identically); the SQLite
// recreate-pattern test (#5) lives in the unit-level test file because
// in-memory SQLite is always available.

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { makeTestContext } from "../../../../database/__tests__/integration/helpers/test-db.js";
import { DrizzleStatementExecutor } from "../../services/drizzle-statement-executor.js";

import { PushSchemaPipeline } from "../pushschema-pipeline.js";
import type {
  PromptDispatcher,
  RenameCandidate,
} from "../pushschema-pipeline-interfaces.js";
import {
  noopClassifier,
  noopMigrationJournal,
  noopNotifier,
  noopPreRenameExecutor,
  noopPromptDispatcher,
  noopRenameDetector,
} from "../pushschema-pipeline-stubs.js";
import { RegexRenameDetector } from "../rename-detector.js";

const ctx = makeTestContext("postgresql");

describe("PushSchemaPipeline integration — PostgreSQL", () => {
  if (!ctx.available || !ctx.url) {
    it.skip("Skipping PG integration tests: TEST_POSTGRES_URL not set", () => {});
    return;
  }

  let pool: Pool;
  let db: ReturnType<typeof drizzle>;

  beforeAll(async () => {
    pool = new Pool({ connectionString: ctx.url ?? undefined });
    db = drizzle(pool);

    // Pre-create three tables: two managed (dc_*), one unmanaged
    // (orders) so scenario #6 can verify it survives.
    await pool.query(
      `DROP TABLE IF EXISTS "${ctx.prefix}_dc_posts", "${ctx.prefix}_dc_pages", "${ctx.prefix}_dc_users", "${ctx.prefix}_orders" CASCADE`
    );
  });

  afterAll(async () => {
    if (pool) {
      await pool
        .query(
          `DROP TABLE IF EXISTS "${ctx.prefix}_dc_posts", "${ctx.prefix}_dc_pages", "${ctx.prefix}_dc_users", "${ctx.prefix}_orders" CASCADE`
        )
        .catch(() => {});
      await pool.end();
    }
  });

  function makePipeline(staticSchema: Record<string, unknown>) {
    // Override pushSchema to return controlled statements (we test the
    // pipeline's wiring, not drizzle-kit's diff itself — drizzle-kit's
    // behavior is its own concern).
    return (statements: string[]) =>
      new PushSchemaPipeline(
        {
          executor: new DrizzleStatementExecutor("postgresql", db),
          renameDetector: noopRenameDetector,
          classifier: noopClassifier,
          promptDispatcher: noopPromptDispatcher,
          preRenameExecutor: noopPreRenameExecutor,
          migrationJournal: noopMigrationJournal,
          notifier: noopNotifier,
        },
        {
          _kitOverride: {
            pushSchema: () =>
              Promise.resolve({
                statementsToExecute: statements,
                warnings: [],
                hasDataLoss: false,
              }),
          },
          _buildDrizzleSchemaOverride: () => staticSchema,
        }
      );
  }

  it("scenario #1: single-field add executes ALTER inside transaction", async () => {
    // Pre-create the managed table.
    await pool.query(
      `CREATE TABLE "${ctx.prefix}_dc_posts" (id integer PRIMARY KEY)`
    );

    const pipeline = makePipeline({})([
      `ALTER TABLE "${ctx.prefix}_dc_posts" ADD COLUMN body text`,
    ]);

    const result = await pipeline.apply({
      desired: {
        collections: {
          posts: {
            slug: "posts",
            tableName: `${ctx.prefix}_dc_posts`,
            fields: [],
          },
        },
        singles: {},
        components: {},
      },
      db,
      dialect: "postgresql",
      source: "code",
      promptChannel: "terminal",
    });

    expect(result.success).toBe(true);

    // Verify the column landed.
    const cols = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = '${ctx.prefix}_dc_posts'`
    );
    const names = cols.rows.map(
      r => (r as { column_name: string }).column_name
    );
    expect(names).toContain("body");
  });

  it("scenario #2: rename detection emits candidate via recording PromptDispatcher (F4 PR 2)", async () => {
    // F4 PR 2 end-to-end assertion: drizzle-kit emits DROP+ADD on the same
    // managed table, RegexRenameDetector identifies the (DROP, ADD) pair as
    // a rename candidate, the pipeline forwards it to PromptDispatcher.
    //
    // We assert the candidate the detector produced reaches the dispatcher
    // with the right shape (including typesCompatible: true derived from
    // live column-type introspection). We do NOT yet assert "rename
    // preserves data" - F6 (PreRenameExecutor) and F7 (real PromptDispatcher
    // with confirm) are still stubs/unimplemented; the recording dispatcher
    // here returns confirmedRenames: [] so the pipeline still drops+adds.
    await pool.query(`DROP TABLE IF EXISTS "${ctx.prefix}_dc_users" CASCADE`);
    await pool.query(
      `CREATE TABLE "${ctx.prefix}_dc_users" (id integer PRIMARY KEY, title text)`
    );

    const captured: RenameCandidate[][] = [];
    const recordingDispatcher: PromptDispatcher = {
      dispatch: async ({ candidates }) => {
        captured.push(candidates);
        return { confirmedRenames: [], resolutions: [], proceed: true };
      },
    };

    const pipeline = new PushSchemaPipeline(
      {
        executor: new DrizzleStatementExecutor("postgresql", db),
        renameDetector: new RegexRenameDetector(),
        classifier: noopClassifier,
        promptDispatcher: recordingDispatcher,
        preRenameExecutor: noopPreRenameExecutor,
        migrationJournal: noopMigrationJournal,
        notifier: noopNotifier,
      },
      {
        _kitOverride: {
          pushSchema: () =>
            Promise.resolve({
              statementsToExecute: [
                `ALTER TABLE "${ctx.prefix}_dc_users" DROP COLUMN "title"`,
                `ALTER TABLE "${ctx.prefix}_dc_users" ADD COLUMN "name" text`,
              ],
              warnings: [],
              hasDataLoss: false,
            }),
        },
        _buildDrizzleSchemaOverride: () => ({}),
      }
    );

    const result = await pipeline.apply({
      desired: {
        collections: {
          users: {
            slug: "users",
            tableName: `${ctx.prefix}_dc_users`,
            fields: [],
          },
        },
        singles: {},
        components: {},
      },
      db,
      dialect: "postgresql",
      source: "code",
      promptChannel: "terminal",
    });

    expect(result.success).toBe(true);

    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual([
      {
        tableName: `${ctx.prefix}_dc_users`,
        fromColumn: "title",
        toColumn: "name",
        fromType: "text",
        toType: "text",
        typesCompatible: true,
        defaultSuggestion: "rename",
      },
    ]);

    await pool.query(`DROP TABLE IF EXISTS "${ctx.prefix}_dc_users" CASCADE`);
  });

  it("scenario #6: nextly_* / unmanaged tables are NOT dropped by pipeline", async () => {
    // Pre-create an unmanaged table that would normally be dropped by
    // pushSchema (since it's in the live DB but not in desired). The
    // F3 post-pushSchema filter must strip the DROP TABLE for it.
    await pool.query(
      `CREATE TABLE IF NOT EXISTS "${ctx.prefix}_orders" (id integer PRIMARY KEY)`
    );

    // Simulate pushSchema returning DROP statements for both managed
    // and unmanaged tables. The filter should keep the managed DROP
    // and strip the unmanaged one.
    const pipeline = makePipeline({})([
      `DROP TABLE IF EXISTS "${ctx.prefix}_dc_pages"`, // would be managed if it existed
      `DROP TABLE "${ctx.prefix}_orders"`, // unmanaged — must NOT execute
    ]);

    const result = await pipeline.apply({
      desired: {
        collections: {},
        singles: {},
        components: {},
      },
      db,
      dialect: "postgresql",
      source: "code",
      promptChannel: "terminal",
    });

    expect(result.success).toBe(true);

    // Unmanaged table still exists.
    const unmanagedExists = await pool.query(
      `SELECT 1 FROM information_schema.tables WHERE table_name = '${ctx.prefix}_orders'`
    );
    expect(unmanagedExists.rowCount).toBe(1);
  });

  it("scenario #4: pushSchema failure surfaces as PUSHSCHEMA_FAILED", async () => {
    const pipeline = new PushSchemaPipeline(
      {
        executor: new DrizzleStatementExecutor("postgresql", db),
        renameDetector: noopRenameDetector,
        classifier: noopClassifier,
        promptDispatcher: noopPromptDispatcher,
        preRenameExecutor: noopPreRenameExecutor,
        migrationJournal: noopMigrationJournal,
        notifier: noopNotifier,
      },
      {
        _kitOverride: {
          pushSchema: () =>
            Promise.reject(
              new Error("simulated drizzle-kit introspection failure")
            ),
        },
        _buildDrizzleSchemaOverride: () => ({}),
      }
    );

    const result = await pipeline.apply({
      desired: {
        collections: {
          x: { slug: "x", tableName: `${ctx.prefix}_dc_x`, fields: [] },
        },
        singles: {},
        components: {},
      },
      db,
      dialect: "postgresql",
      source: "code",
      promptChannel: "terminal",
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("PUSHSCHEMA_FAILED");
    expect(result.error?.message).toContain(
      "simulated drizzle-kit introspection failure"
    );
  });
});
