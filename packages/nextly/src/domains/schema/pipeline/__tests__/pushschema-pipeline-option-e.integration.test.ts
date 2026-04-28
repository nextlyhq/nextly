// F4 Option E end-to-end integration tests against real PostgreSQL.
//
// Verifies the central architectural property of Option E: the rewired
// pipeline computes its own diff, runs renames + drops via our SQL
// before calling pushSchema, so pushSchema sees a clean schema and never
// fires its TTY-prompting columnsResolver.
//
// Each scenario uses REAL drizzle-kit pushSchema (NOT mocked) - that's
// the whole point. If pre-resolution fails to catch a rename, the test
// hits drizzle-kit's TTY error and fails loudly.
//
// Auto-skips when TEST_POSTGRES_URL is unset. Boot:
//   docker compose -f docker-compose.test.yml up -d postgres15-test
//   TEST_POSTGRES_URL=postgres://postgres:postgres@localhost:5434/nextly_test
//
// Tables are prefixed per `makeTestContext` to avoid collisions in CI.

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
  noopPreRenameExecutor,
} from "../pushschema-pipeline-stubs.js";
import { RegexRenameDetector } from "../rename-detector.js";
import type { DesiredSchema } from "../types.js";

const ctx = makeTestContext("postgresql");

describe("PushSchemaPipeline Option E end-to-end - PostgreSQL", () => {
  if (!ctx.available || !ctx.url) {
    it.skip("Skipping PG integration tests: TEST_POSTGRES_URL not set", () => {});
    return;
  }

  let pool: Pool;
  let db: ReturnType<typeof drizzle>;

  // Cleanup test tables before/after the suite.
  const TABLES_TO_CLEAN = [
    `${ctx.prefix}_dc_users_e2e`,
    `${ctx.prefix}_dc_posts_e2e`,
  ];

  async function dropTestTables(): Promise<void> {
    if (!pool) return;
    const list = TABLES_TO_CLEAN.map(t => `"${t}"`).join(", ");
    await pool.query(`DROP TABLE IF EXISTS ${list} CASCADE`).catch(() => {});
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: ctx.url ?? undefined });
    db = drizzle(pool);
    await dropTestTables();
  });

  afterAll(async () => {
    await dropTestTables();
    if (pool) await pool.end();
  });

  // ---------------------------------------------------------------------------
  // Helper: a "recording + auto-confirming" PromptDispatcher.
  // Used in tests where we want all detected renames to be confirmed (the
  // user picked "rename" for each candidate). Captures candidates for
  // assertion + returns them as confirmed.
  // ---------------------------------------------------------------------------
  function recordingConfirmAllDispatcher() {
    const captured: RenameCandidate[][] = [];
    const dispatcher: PromptDispatcher = {
      dispatch: async ({ candidates }) => {
        captured.push([...candidates]);
        return { confirmedRenames: [...candidates], resolutions: {} };
      },
    };
    return { captured, dispatcher };
  }

  // Helper: dispatcher that confirms only specific renames (others stay
  // as drop_and_add). Useful for multi-rename scenarios where we want
  // some but not all renames preserved.
  function selectiveConfirmDispatcher(
    confirmFilter: (c: RenameCandidate) => boolean
  ) {
    const captured: RenameCandidate[][] = [];
    const dispatcher: PromptDispatcher = {
      dispatch: async ({ candidates }) => {
        captured.push([...candidates]);
        const confirmed = candidates.filter(confirmFilter);
        return { confirmedRenames: confirmed, resolutions: {} };
      },
    };
    return { captured, dispatcher };
  }

  function makeOptionEPipeline(promptDispatcher: PromptDispatcher) {
    return new PushSchemaPipeline({
      executor: new DrizzleStatementExecutor("postgresql", db),
      renameDetector: new RegexRenameDetector(),
      classifier: noopClassifier,
      promptDispatcher,
      preRenameExecutor: noopPreRenameExecutor, // not used in Option E flow
      migrationJournal: noopMigrationJournal,
    });
    // No test hooks - we let real drizzle-kit pushSchema run AFTER
    // pre-resolution. That's the whole point of Option E.
  }

  // ---------------------------------------------------------------------------
  // Scenario A: simple rename data preserved (the headline acceptance criterion)
  //
  // Uses `body` -> `summary` (both NON-reserved columns). `title` is auto-
  // injected as a reserved column by buildDesiredFromFields, so it can't
  // be a rename source in our model. User-defined custom fields can.
  // ---------------------------------------------------------------------------
  it("scenario A: rename `body` -> `summary` preserves data on populated table", async () => {
    const tableName = `${ctx.prefix}_dc_users_e2e`;

    // Create live table: reserved cols + non-reserved `body` + 50 rows.
    await pool.query(
      `CREATE TABLE "${tableName}" (
        "id" text PRIMARY KEY,
        "title" text NOT NULL,
        "slug" text NOT NULL,
        "created_at" timestamp,
        "updated_at" timestamp,
        "body" text NOT NULL
      )`
    );
    for (let i = 1; i <= 50; i++) {
      await pool.query(
        `INSERT INTO "${tableName}" (id, title, slug, body) VALUES ($1, $2, $3, $4)`,
        [`u${i}`, `t-${i}`, `s-${i}`, `body-content-${i}`]
      );
    }

    // Desired: replace `body` with `summary` (rename intent).
    const desired: DesiredSchema = {
      collections: {
        users: {
          slug: "users",
          tableName,
          fields: [{ name: "summary", type: "text", required: true }] as never,
        },
      },
      singles: {},
      components: {},
    };

    const { captured, dispatcher } = recordingConfirmAllDispatcher();
    const pipeline = makeOptionEPipeline(dispatcher);

    const result = await pipeline.apply({
      desired,
      db,
      dialect: "postgresql",
      source: "code",
      promptChannel: "terminal",
    });

    expect(result.success).toBe(true);
    expect(result.renamesApplied).toBe(1);

    // Detector saw exactly one candidate (body -> summary).
    expect(captured).toHaveLength(1);
    expect(
      captured[0].some(c => c.fromColumn === "body" && c.toColumn === "summary")
    ).toBe(true);

    // RENAME COLUMN preserves data: summary should hold the original body
    // values. (If we'd done DROP+ADD, summary would be all NULL.)
    const rows = await pool.query(
      `SELECT id, summary FROM "${tableName}" ORDER BY id`
    );
    expect(rows.rowCount).toBe(50);
    const u1 = rows.rows.find(
      (r): r is { id: string; summary: string } =>
        (r as { id: string }).id === "u1"
    );
    expect(u1?.summary).toBe("body-content-1");
    const u50 = rows.rows.find(
      (r): r is { id: string; summary: string } =>
        (r as { id: string }).id === "u50"
    );
    expect(u50?.summary).toBe("body-content-50");

    // body column is gone.
    const cols = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND table_schema = 'public'`,
      [tableName]
    );
    const colNames = cols.rows.map(
      r => (r as { column_name: string }).column_name
    );
    expect(colNames).toContain("summary");
    expect(colNames).not.toContain("body");
  });

  // ---------------------------------------------------------------------------
  // Scenario B: rename declined (user picks drop_and_add) DROPS data
  // ---------------------------------------------------------------------------
  it("scenario B: rename declined (drop_and_add) drops the old column data", async () => {
    const tableName = `${ctx.prefix}_dc_users_e2e`;
    await pool.query(`DROP TABLE IF EXISTS "${tableName}" CASCADE`);

    await pool.query(
      `CREATE TABLE "${tableName}" (
        "id" text PRIMARY KEY,
        "title" text NOT NULL,
        "slug" text NOT NULL,
        "created_at" timestamp,
        "updated_at" timestamp,
        "body" text
      )`
    );
    await pool.query(
      `INSERT INTO "${tableName}" (id, title, slug, body) VALUES ('u1', 't1', 's1', 'will-be-dropped')`
    );

    const desired: DesiredSchema = {
      collections: {
        users: {
          slug: "users",
          tableName,
          fields: [{ name: "summary", type: "text" }] as never,
        },
      },
      singles: {},
      components: {},
    };

    // Decline all renames - the dispatcher returns NO confirmed renames.
    // The pipeline keeps the original drop_column + add_column ops.
    const { dispatcher } = selectiveConfirmDispatcher(() => false);
    const pipeline = makeOptionEPipeline(dispatcher);

    const result = await pipeline.apply({
      desired,
      db,
      dialect: "postgresql",
      source: "code",
      promptChannel: "terminal",
    });

    expect(result.success).toBe(true);
    expect(result.renamesApplied).toBe(0);

    // After: body is gone, summary exists, summary is NULL (no rename happened).
    const rows = await pool.query(`SELECT id, summary FROM "${tableName}"`);
    expect(rows.rowCount).toBe(1);
    const u1 = rows.rows[0] as { id: string; summary: string | null };
    expect(u1.id).toBe("u1");
    expect(u1.summary).toBeNull(); // data lost as the user requested
  });

  // ---------------------------------------------------------------------------
  // Scenario C: pure additive (add column) - no prompt fires
  // ---------------------------------------------------------------------------
  it("scenario C: pure additive (add column) succeeds without any prompt", async () => {
    const tableName = `${ctx.prefix}_dc_posts_e2e`;
    await pool.query(`DROP TABLE IF EXISTS "${tableName}" CASCADE`);

    // Pre-create with reserved cols only. Desired adds a `body` field.
    await pool.query(
      `CREATE TABLE "${tableName}" (
        "id" text PRIMARY KEY,
        "title" text NOT NULL,
        "slug" text NOT NULL,
        "created_at" timestamp,
        "updated_at" timestamp
      )`
    );

    const desired: DesiredSchema = {
      collections: {
        posts: {
          slug: "posts",
          tableName,
          fields: [{ name: "body", type: "text" }] as never,
        },
      },
      singles: {},
      components: {},
    };

    // Recording dispatcher just to verify it's NEVER called for pure additive.
    const { captured, dispatcher } = recordingConfirmAllDispatcher();
    const pipeline = makeOptionEPipeline(dispatcher);

    const result = await pipeline.apply({
      desired,
      db,
      dialect: "postgresql",
      source: "code",
      promptChannel: "terminal",
    });

    expect(result.success).toBe(true);
    // No prompt was needed because there were no rename candidates.
    expect(captured).toHaveLength(0);

    // body column was added.
    const cols = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND table_schema = 'public'`,
      [tableName]
    );
    const colNames = cols.rows.map(
      r => (r as { column_name: string }).column_name
    );
    expect(colNames).toContain("body");
  });

  // ---------------------------------------------------------------------------
  // Scenario D: multi-rename within one table - shrinking pool resolution
  // ---------------------------------------------------------------------------
  it("scenario D: multi-rename in one table preserves data for confirmed pairs", async () => {
    const tableName = `${ctx.prefix}_dc_users_e2e`;
    await pool.query(`DROP TABLE IF EXISTS "${tableName}" CASCADE`);

    // Live table: reserved cols + 3 extras (a, b, c), all text.
    await pool.query(
      `CREATE TABLE "${tableName}" (
        "id" text PRIMARY KEY,
        "title" text NOT NULL,
        "slug" text NOT NULL,
        "created_at" timestamp,
        "updated_at" timestamp,
        "a" text,
        "b" text,
        "c" text
      )`
    );
    await pool.query(
      `INSERT INTO "${tableName}" (id, title, slug, a, b, c)
       VALUES ('u1', 't1', 's1', 'A1', 'B1', 'C1')`
    );

    // Desired: replace a/b/c with x/y/z (all text). The detector emits
    // 3x3 = 9 raw candidates. We confirm a->x and b->y; c stays as drop+add
    // and z stays as add.
    const desired: DesiredSchema = {
      collections: {
        users: {
          slug: "users",
          tableName,
          fields: [
            { name: "x", type: "text" },
            { name: "y", type: "text" },
            { name: "z", type: "text" },
          ] as never,
        },
      },
      singles: {},
      components: {},
    };

    // Confirm only specific (a->x) and (b->y) pairs.
    const { dispatcher, captured } = selectiveConfirmDispatcher(
      c =>
        (c.fromColumn === "a" && c.toColumn === "x") ||
        (c.fromColumn === "b" && c.toColumn === "y")
    );
    const pipeline = makeOptionEPipeline(dispatcher);

    const result = await pipeline.apply({
      desired,
      db,
      dialect: "postgresql",
      source: "code",
      promptChannel: "terminal",
    });

    expect(result.success).toBe(true);
    expect(result.renamesApplied).toBe(2); // a->x and b->y

    // We received the full Cartesian (3 drops x 3 adds = 9 candidates)
    // so the dispatcher saw all options.
    expect(captured[0]).toHaveLength(9);

    // After: x and y carry the original a and b values; z is null;
    // c is gone.
    const rows = await pool.query(
      `SELECT id, x, y, z FROM "${tableName}" WHERE id = 'u1'`
    );
    const u1 = rows.rows[0] as {
      id: string;
      x: string | null;
      y: string | null;
      z: string | null;
    };
    expect(u1.x).toBe("A1"); // renamed from a
    expect(u1.y).toBe("B1"); // renamed from b
    expect(u1.z).toBeNull(); // newly added (no rename)

    // Verify c is gone
    const cols = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND table_schema = 'public'`,
      [tableName]
    );
    const colNames = cols.rows.map(
      r => (r as { column_name: string }).column_name
    );
    expect(colNames).not.toContain("a");
    expect(colNames).not.toContain("b");
    expect(colNames).not.toContain("c");
    expect(colNames).toContain("x");
    expect(colNames).toContain("y");
    expect(colNames).toContain("z");
  });
});
