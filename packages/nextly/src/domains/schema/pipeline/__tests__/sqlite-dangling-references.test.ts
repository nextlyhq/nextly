// A SQLite dev push runs under the same schema-change contract a migration
// does: foreign keys off for the whole apply, one `PRAGMA foreign_key_check`
// after its last statement, and the connection's setting put back.
//
// With enforcement off, a statement that leaves a row pointing at a row that
// no longer exists succeeds silently, so the check is the only thing that can
// say so. The fixture makes the apply do exactly that — its executor removes
// the parent row a live child references, standing in for DDL that loses a
// referenced row — against a real in-memory SQLite and the real pipeline.

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DrizzleStatementExecutor } from "../../services/drizzle-statement-executor";
import { PushSchemaPipeline } from "../pushschema-pipeline";
import {
  noopClassifier,
  noopMigrationJournal,
  noopNotifier,
  noopPreCleanupExecutor,
  noopPreRenameExecutor,
  noopPromptDispatcher,
  noopRenameDetector,
} from "../pushschema-pipeline-stubs";

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle>;

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  db = drizzle({ client: sqlite });
  // Unmanaged tables the push never touches on its own.
  sqlite.exec(`
    CREATE TABLE fx_parent (id TEXT PRIMARY KEY);
    CREATE TABLE fx_child (
      id TEXT PRIMARY KEY,
      parent_id TEXT REFERENCES fx_parent (id)
    );
    INSERT INTO fx_parent VALUES ('p1');
    INSERT INTO fx_child VALUES ('c1', 'p1');
  `);
});
afterEach(() => sqlite.close());

/** The real executor, plus `extra` run after every batch it is handed. */
function executorAlsoRunning(extra: string[]) {
  const real = new DrizzleStatementExecutor("sqlite", db);
  return {
    async executeStatements(tx: unknown, statements: string[]) {
      await real.executeStatements(tx, [...statements, ...extra]);
    },
  };
}

/**
 * A push of one new collection. Each call names its own, because the
 * pipeline caches the last desired schema it applied and skips a repeat.
 */
function push(slug: string, extra: string[]) {
  return new PushSchemaPipeline({
    executor: executorAlsoRunning(extra),
    renameDetector: noopRenameDetector,
    classifier: noopClassifier,
    promptDispatcher: noopPromptDispatcher,
    preRenameExecutor: noopPreRenameExecutor,
    preCleanupExecutor: noopPreCleanupExecutor,
    migrationJournal: noopMigrationJournal,
    notifier: noopNotifier,
  }).apply({
    desired: {
      collections: {
        [slug]: {
          slug,
          tableName: `dc_${slug}`,
          fields: [{ name: "body", type: "text" }] as never,
        },
      },
      singles: {},
      components: {},
    },
    db,
    dialect: "sqlite",
    source: "code",
    promptChannel: "terminal",
  });
}

describe("a SQLite dev push checks its references once it has run", () => {
  it("applies and restores enforcement when nothing is left dangling", async () => {
    // The control: the same push with nothing orphaned succeeds, so the
    // refusal below is the check's and not the fixture's.
    const result = await push("fxdangle_clean", []);
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
  });

  it("does not blame an apply for a dangling row the database already held", async () => {
    sqlite.pragma("foreign_keys = OFF");
    sqlite.exec(`INSERT INTO fx_child VALUES ('c0', 'gone')`);
    sqlite.pragma("foreign_keys = ON");
    const result = await push("fxdangle_preexisting", []);
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
  });

  it("refuses an apply that leaves a reference dangling, naming the tables", async () => {
    const result = await push("fxdangle_orphaning", [
      "DELETE FROM fx_parent WHERE id = 'p1'",
    ]);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("DDL_EXECUTION_FAILED");
    expect(result.error?.message).toContain("fx_child → fx_parent");
    // Enforcement is back on for whatever the connection serves next.
    expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
  });
});
