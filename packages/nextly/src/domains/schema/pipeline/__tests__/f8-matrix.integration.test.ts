// F8 PR 7: cross-dialect integration matrix.
//
// Q3-A acceptance scenarios driven against an in-memory SQLite DB
// (always available, no docker required, fast in CI). Same scenarios
// run against real PG via the existing F4 Option E suite at
// `pushschema-pipeline-option-e.integration.test.ts`. MySQL parity
// is exercised through the F18 docker-compose matrix that runs all
// `*.integration.test.ts` files per Q6=A.
//
// Scope — verifies the F1-F6 pipeline produces correct outcomes for
// the four headline scenarios:
//
//   1. Add field on a populated table → existing rows preserved,
//      new column nullable.
//   2. Drop field on a populated table → column gone, surviving
//      columns preserved.
//   3. Rename field → 50 rows of data carried over (the F4 Option E
//      headline acceptance criterion: pre-rename uses our SQL, NOT
//      pushSchema's drop-and-add).
//   4. NOT-NULL coercion via F5 PreCleanupExecutor: existing column
//      with NULL rows + provide_default resolution → UPDATE backfills
//      then ALTER NOT NULL succeeds.
//
// Multi-rename + type-change matrix scenarios are covered by the F4
// Option E suite (PG) plus F6 unit tests; they're deferred from this
// file to keep PR 7 focused.

import Database from "better-sqlite3";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { Pool } from "pg";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { makeTestContext } from "../../../../database/__tests__/integration/helpers/test-db";

import { RealClassifier } from "../classifier/classifier";
import { RealPreCleanupExecutor } from "../pre-cleanup/executor";
import { DrizzleStatementExecutor } from "../../services/drizzle-statement-executor";
import {
  noopMigrationJournal,
  noopNotifier,
  noopPreRenameExecutor,
} from "../pushschema-pipeline-stubs";
import { PushSchemaPipeline } from "../pushschema-pipeline";
import type {
  PromptDispatcher,
  RenameCandidate,
} from "../pushschema-pipeline-interfaces";
import { RegexRenameDetector } from "../rename-detector";
import type { Resolution } from "../resolution/types";
import type { DesiredSchema } from "../types";

// ---------------------------------------------------------------------------
// SQLite test infrastructure
// ---------------------------------------------------------------------------

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle>;

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  db = drizzle(sqlite);
});

afterEach(() => {
  sqlite.close();
});

// ---------------------------------------------------------------------------
// PromptDispatcher fakes — production callers use ClackTerminalPromptDispatcher
// or BrowserPromptDispatcher. For deterministic tests we plug in fakes that
// auto-confirm renames or supply specific resolutions.
// ---------------------------------------------------------------------------

function autoConfirmAllRenamesDispatcher(): {
  captured: RenameCandidate[][];
  dispatcher: PromptDispatcher;
} {
  const captured: RenameCandidate[][] = [];
  return {
    captured,
    dispatcher: {
      dispatch: ({ candidates }) => {
        captured.push([...candidates]);
        return Promise.resolve({
          confirmedRenames: candidates,
          resolutions: [],
          proceed: true,
        });
      },
    },
  };
}

function withResolutionsDispatcher(
  resolutions: Resolution[]
): PromptDispatcher {
  return {
    dispatch: () =>
      Promise.resolve({
        confirmedRenames: [],
        resolutions,
        proceed: true,
      }),
  };
}

function makePipeline(promptDispatcher: PromptDispatcher) {
  return new PushSchemaPipeline({
    executor: new DrizzleStatementExecutor("sqlite", db),
    renameDetector: new RegexRenameDetector(),
    classifier: new RealClassifier(),
    promptDispatcher,
    preRenameExecutor: noopPreRenameExecutor,
    preCleanupExecutor: new RealPreCleanupExecutor(),
    migrationJournal: noopMigrationJournal,
    notifier: noopNotifier,
  });
}

// SQLite identifier quoting helper (better-sqlite3 doesn't accept
// `?` parameters for table/column names; sql.raw is the documented
// escape hatch — guarded by us writing the table names ourselves).
const quoteIdent = (name: string): string => `"${name.replace(/"/g, '""')}"`;

// ---------------------------------------------------------------------------
// Scenario 1: Add field
// ---------------------------------------------------------------------------

describe("F8 matrix — SQLite — add field", () => {
  it("adds a new nullable column without disturbing existing rows", async () => {
    const tableName = "dc_posts";
    // Live: id + reserved cols + body. 10 rows of body data.
    sqlite.exec(`
      CREATE TABLE ${quoteIdent(tableName)} (
        "id" text PRIMARY KEY,
        "title" text NOT NULL,
        "slug" text NOT NULL,
        "created_at" integer,
        "updated_at" integer,
        "body" text NOT NULL
      )
    `);
    const insert = sqlite.prepare(
      `INSERT INTO ${quoteIdent(tableName)} (id, title, slug, body) VALUES (?, ?, ?, ?)`
    );
    for (let i = 1; i <= 10; i++) {
      insert.run(`p${i}`, `t-${i}`, `s-${i}`, `body-${i}`);
    }

    // Desired: same shape + new excerpt field.
    const desired: DesiredSchema = {
      collections: {
        posts: {
          slug: "posts",
          tableName,
          fields: [
            { name: "body", type: "text", required: true },
            { name: "excerpt", type: "text" },
          ] as never,
        },
      },
      singles: {},
      components: {},
    };

    const { dispatcher } = autoConfirmAllRenamesDispatcher();
    const pipeline = makePipeline(dispatcher);
    const result = await pipeline.apply({
      desired,
      db,
      dialect: "sqlite",
      source: "code",
      promptChannel: "terminal",
    });
    expect(result.success).toBe(true);

    // 10 existing rows preserved.
    const count = sqlite
      .prepare(`SELECT COUNT(*) AS c FROM ${quoteIdent(tableName)}`)
      .get() as { c: number };
    expect(count.c).toBe(10);

    // body still present with original data.
    const p1 = sqlite
      .prepare(
        `SELECT id, body, excerpt FROM ${quoteIdent(tableName)} WHERE id = ?`
      )
      .get("p1") as { id: string; body: string; excerpt: string | null };
    expect(p1.body).toBe("body-1");
    expect(p1.excerpt).toBeNull(); // new column is nullable
  });
});

// ---------------------------------------------------------------------------
// Scenario 2: Drop field
// ---------------------------------------------------------------------------

describe("F8 matrix — SQLite — drop field", () => {
  it("removes a column when the user confirms (no rename candidate)", async () => {
    const tableName = "dc_articles";
    // Live: standard cols + body + obsolete_field.
    sqlite.exec(`
      CREATE TABLE ${quoteIdent(tableName)} (
        "id" text PRIMARY KEY,
        "title" text NOT NULL,
        "slug" text NOT NULL,
        "created_at" integer,
        "updated_at" integer,
        "body" text NOT NULL,
        "obsolete_field" text
      )
    `);
    sqlite
      .prepare(
        `INSERT INTO ${quoteIdent(tableName)} (id, title, slug, body, obsolete_field) VALUES (?, ?, ?, ?, ?)`
      )
      .run("a1", "title-1", "slug-1", "body-1", "old");

    // Desired: drop obsolete_field. NO rename target — pure drop.
    const desired: DesiredSchema = {
      collections: {
        articles: {
          slug: "articles",
          tableName,
          fields: [{ name: "body", type: "text", required: true }] as never,
        },
      },
      singles: {},
      components: {},
    };

    const { dispatcher } = autoConfirmAllRenamesDispatcher();
    const pipeline = makePipeline(dispatcher);
    const result = await pipeline.apply({
      desired,
      db,
      dialect: "sqlite",
      source: "code",
      promptChannel: "terminal",
    });
    expect(result.success).toBe(true);

    // Row count preserved.
    const count = sqlite
      .prepare(`SELECT COUNT(*) AS c FROM ${quoteIdent(tableName)}`)
      .get() as { c: number };
    expect(count.c).toBe(1);

    // obsolete_field column gone — columns introspect should not list it.
    const cols = sqlite
      .prepare(`PRAGMA table_info(${quoteIdent(tableName)})`)
      .all() as Array<{ name: string }>;
    const colNames = cols.map(c => c.name);
    expect(colNames).not.toContain("obsolete_field");
    // body still present (and surviving data).
    expect(colNames).toContain("body");
    const a1 = sqlite
      .prepare(`SELECT id, body FROM ${quoteIdent(tableName)} WHERE id = ?`)
      .get("a1") as { id: string; body: string };
    expect(a1.body).toBe("body-1");
  });
});

// ---------------------------------------------------------------------------
// Scenario 3: Rename field (the headline F4 Option E acceptance criterion)
// ---------------------------------------------------------------------------

describe("F8 matrix — SQLite — rename field preserves data", () => {
  it("renames body → summary on a 50-row table; all values carried over", async () => {
    const tableName = "dc_users";
    sqlite.exec(`
      CREATE TABLE ${quoteIdent(tableName)} (
        "id" text PRIMARY KEY,
        "title" text NOT NULL,
        "slug" text NOT NULL,
        "created_at" integer,
        "updated_at" integer,
        "body" text NOT NULL
      )
    `);
    const insert = sqlite.prepare(
      `INSERT INTO ${quoteIdent(tableName)} (id, title, slug, body) VALUES (?, ?, ?, ?)`
    );
    for (let i = 1; i <= 50; i++) {
      insert.run(`u${i}`, `t-${i}`, `s-${i}`, `body-content-${i}`);
    }

    // Desired: replace body with summary (same type).
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

    const { captured, dispatcher } = autoConfirmAllRenamesDispatcher();
    const pipeline = makePipeline(dispatcher);
    const result = await pipeline.apply({
      desired,
      db,
      dialect: "sqlite",
      source: "code",
      promptChannel: "terminal",
    });

    expect(result.success).toBe(true);
    expect(result.renamesApplied).toBe(1);
    // Detector emitted exactly one candidate body → summary.
    expect(captured).toHaveLength(1);
    expect(
      captured[0].some(c => c.fromColumn === "body" && c.toColumn === "summary")
    ).toBe(true);

    // 50 rows preserved.
    const count = sqlite
      .prepare(`SELECT COUNT(*) AS c FROM ${quoteIdent(tableName)}`)
      .get() as { c: number };
    expect(count.c).toBe(50);

    // summary holds original body values (the F4 Option E rename
    // path uses ALTER TABLE RENAME COLUMN, NOT drop-and-add).
    const u1 = sqlite
      .prepare(`SELECT id, summary FROM ${quoteIdent(tableName)} WHERE id = ?`)
      .get("u1") as { id: string; summary: string };
    expect(u1.summary).toBe("body-content-1");
    const u50 = sqlite
      .prepare(`SELECT id, summary FROM ${quoteIdent(tableName)} WHERE id = ?`)
      .get("u50") as { id: string; summary: string };
    expect(u50.summary).toBe("body-content-50");

    // body column is gone.
    const cols = sqlite
      .prepare(`PRAGMA table_info(${quoteIdent(tableName)})`)
      .all() as Array<{ name: string }>;
    const colNames = cols.map(c => c.name);
    expect(colNames).toContain("summary");
    expect(colNames).not.toContain("body");
  });
});

// ---------------------------------------------------------------------------
// Scenario 4: F5 NOT-NULL coercion with provide_default
// ---------------------------------------------------------------------------

describe("F8 matrix — SQLite — NOT-NULL coercion via provide_default", () => {
  it("backfills NULL rows then promotes the column to NOT NULL", async () => {
    const tableName = "dc_orders";
    // Live: total column is currently nullable; some rows are NULL.
    sqlite.exec(`
      CREATE TABLE ${quoteIdent(tableName)} (
        "id" text PRIMARY KEY,
        "title" text NOT NULL,
        "slug" text NOT NULL,
        "created_at" integer,
        "updated_at" integer,
        "total" text
      )
    `);
    const insert = sqlite.prepare(
      `INSERT INTO ${quoteIdent(tableName)} (id, title, slug, total) VALUES (?, ?, ?, ?)`
    );
    insert.run("o1", "t-1", "s-1", "100");
    insert.run("o2", "t-2", "s-2", null); // NULL row #1
    insert.run("o3", "t-3", "s-3", null); // NULL row #2
    insert.run("o4", "t-4", "s-4", "400");

    // Desired: same total field but now required (not nullable).
    const desired: DesiredSchema = {
      collections: {
        orders: {
          slug: "orders",
          tableName,
          fields: [{ name: "total", type: "text", required: true }] as never,
        },
      },
      singles: {},
      components: {},
    };

    // PromptDispatcher returns a `provide_default` resolution to
    // backfill NULL rows with "0" before the constraint promotes.
    const dispatcher = withResolutionsDispatcher([
      {
        kind: "provide_default",
        eventId: `add_not_null_with_nulls:${tableName}.total`,
        value: "0",
      },
    ]);

    const pipeline = makePipeline(dispatcher);
    const result = await pipeline.apply({
      desired,
      db,
      dialect: "sqlite",
      source: "code",
      promptChannel: "terminal",
    });

    expect(result.success).toBe(true);

    // Existing non-null rows untouched.
    const o1 = sqlite
      .prepare(`SELECT id, total FROM ${quoteIdent(tableName)} WHERE id = ?`)
      .get("o1") as { id: string; total: string };
    expect(o1.total).toBe("100");

    // NULL rows backfilled with the provided default.
    const o2 = sqlite
      .prepare(`SELECT id, total FROM ${quoteIdent(tableName)} WHERE id = ?`)
      .get("o2") as { id: string; total: string };
    expect(o2.total).toBe("0");
    const o3 = sqlite
      .prepare(`SELECT id, total FROM ${quoteIdent(tableName)} WHERE id = ?`)
      .get("o3") as { id: string; total: string };
    expect(o3.total).toBe("0");

    // No remaining NULLs in total.
    const nullCount = sqlite
      .prepare(
        `SELECT COUNT(*) AS c FROM ${quoteIdent(tableName)} WHERE total IS NULL`
      )
      .get() as { c: number };
    expect(nullCount.c).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Cross-dialect parity: same NOT-NULL scenario against real PostgreSQL
//
// Auto-skips when TEST_POSTGRES_URL is unset (CI sets it via
// docker-compose; local devs set it via the same compose file).
// Why this lives here, not in pushschema-pipeline-option-e: F4's PG
// suite was written before F5+F6 wired the real PreCleanupExecutor and
// uses noopClassifier. The NOT-NULL coercion path is F5+F6 territory,
// so the parity test belongs alongside the SQLite scenario.
// ---------------------------------------------------------------------------

describe("F8 matrix — PostgreSQL — NOT-NULL coercion via provide_default", () => {
  const ctx = makeTestContext("postgresql");
  if (!ctx.available || !ctx.url) {
    it.skip("Skipping PG NOT-NULL coercion: TEST_POSTGRES_URL not set", () => {});
    return;
  }

  let pool: Pool;
  let pgDb: ReturnType<typeof drizzlePg>;
  const tableName = `${ctx.prefix}_dc_orders_nn`;

  beforeAll(async () => {
    pool = new Pool({ connectionString: ctx.url ?? undefined });
    pgDb = drizzlePg(pool);
    await pool.query(`DROP TABLE IF EXISTS "${tableName}" CASCADE`);
  });

  afterAll(async () => {
    await pool.query(`DROP TABLE IF EXISTS "${tableName}" CASCADE`);
    await pool.end();
  });

  it("backfills NULL rows then promotes the column to NOT NULL", async () => {
    await pool.query(
      `CREATE TABLE "${tableName}" (
        "id" text PRIMARY KEY,
        "title" text NOT NULL,
        "slug" text NOT NULL,
        "created_at" timestamp,
        "updated_at" timestamp,
        "total" text
      )`
    );
    await pool.query(
      `INSERT INTO "${tableName}" (id, title, slug, total) VALUES
        ('o1', 't-1', 's-1', '100'),
        ('o2', 't-2', 's-2', NULL),
        ('o3', 't-3', 's-3', NULL),
        ('o4', 't-4', 's-4', '400')`
    );

    const desired: DesiredSchema = {
      collections: {
        orders: {
          slug: "orders",
          tableName,
          fields: [{ name: "total", type: "text", required: true }] as never,
        },
      },
      singles: {},
      components: {},
    };

    const dispatcher = withResolutionsDispatcher([
      {
        kind: "provide_default",
        eventId: `add_not_null_with_nulls:${tableName}.total`,
        value: "0",
      },
    ]);

    const pipeline = new PushSchemaPipeline({
      executor: new DrizzleStatementExecutor("postgresql", pgDb),
      renameDetector: new RegexRenameDetector(),
      classifier: new RealClassifier(),
      promptDispatcher: dispatcher,
      preRenameExecutor: noopPreRenameExecutor,
      preCleanupExecutor: new RealPreCleanupExecutor(),
      migrationJournal: noopMigrationJournal,
      notifier: noopNotifier,
    });

    const result = await pipeline.apply({
      desired,
      db: pgDb,
      dialect: "postgresql",
      source: "code",
      promptChannel: "terminal",
    });

    expect(result.success).toBe(true);

    // NULL rows backfilled with the provided default.
    const o2 = await pool.query(
      `SELECT total FROM "${tableName}" WHERE id = 'o2'`
    );
    expect(o2.rows[0].total).toBe("0");
    const o3 = await pool.query(
      `SELECT total FROM "${tableName}" WHERE id = 'o3'`
    );
    expect(o3.rows[0].total).toBe("0");

    // Existing non-null rows untouched.
    const o1 = await pool.query(
      `SELECT total FROM "${tableName}" WHERE id = 'o1'`
    );
    expect(o1.rows[0].total).toBe("100");

    // Constraint actually applied — INSERT NULL must now reject.
    let insertRejected = false;
    try {
      await pool.query(
        `INSERT INTO "${tableName}" (id, title, slug, total) VALUES ('o5', 't-5', 's-5', NULL)`
      );
    } catch {
      insertRejected = true;
    }
    expect(insertRejected).toBe(true);
  });
});
