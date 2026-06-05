// Tests for freshPushSchema — F8 PR 2 helper for direct pushSchema flows
// (ensureCoreTables + nextly migrate:fresh's reconcileMysqlSchema).
//
// The helper has dialect-specific code paths:
//   - PG:     pushSchema().apply() directly
//   - SQLite: pushSchema -> custom statement execution loop with
//             recreate-INSERT rewrite
//   - MySQL:  generateDrizzleJson + generateMigration -> manual exec
//
// Tests mock drizzle-kit-lazy at module boundary and assert each path
// dispatches correctly + produces the expected result shape. The
// statement-rewriting and dialect quirks (SQLite recreate-INSERT NULL
// rewrite, MySQL CREATE TABLE IF NOT EXISTS rewrite, real PRAGMA
// queries) are integration concerns. F8 PR 7 ships the cross-dialect
// integration matrix (PG/MySQL/SQLite via docker-compose) which
// exercises these helpers end-to-end. Until then, the regex-rewrite
// logic is covered indirectly via the legacy DrizzlePushService
// integration tests (these helpers are verbatim clones).

import { describe, it, expect, vi, beforeEach } from "vitest";

// Module-level mock state. Reset in beforeEach.
let mockPushSchemaResult: {
  hasDataLoss: boolean;
  warnings: string[];
  statementsToExecute: string[];
  apply: ReturnType<typeof vi.fn>;
};
let mockGenerateMigrationResult: string[];

vi.mock("../../../../database/drizzle-kit-lazy", () => ({
  getPgDrizzleKit: () =>
    Promise.resolve({
      pushSchema: vi.fn().mockImplementation(() => {
        return Promise.resolve(mockPushSchemaResult);
      }),
      generateDrizzleJson: vi.fn().mockResolvedValue({}),
      generateMigration: vi.fn().mockImplementation(() => {
        return Promise.resolve(mockGenerateMigrationResult);
      }),
    }),
  getMySQLDrizzleKit: () =>
    Promise.resolve({
      pushSchema: vi.fn().mockImplementation(() => {
        return Promise.resolve(mockPushSchemaResult);
      }),
      generateDrizzleJson: vi.fn().mockResolvedValue({}),
      generateMigration: vi.fn().mockImplementation(() => {
        return Promise.resolve(mockGenerateMigrationResult);
      }),
    }),
  getSQLiteDrizzleKit: () =>
    Promise.resolve({
      pushSchema: vi.fn().mockImplementation(() => {
        return Promise.resolve(mockPushSchemaResult);
      }),
      generateDrizzleJson: vi.fn().mockResolvedValue({}),
      generateMigration: vi.fn().mockImplementation(() => {
        return Promise.resolve(mockGenerateMigrationResult);
      }),
    }),
}));

// Imported AFTER mock setup so the mock applies.
import { freshPushSchema } from "../fresh-push";

// A one-table Drizzle schema so `drizzleTableNames(schema)` yields ["users"].
async function fakeUsersSchema() {
  const { pgTable, text } = await import("drizzle-orm/pg-core");
  return { users: pgTable("users", { id: text("id").primaryKey() }) };
}

describe("freshPushSchema", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPushSchemaResult = {
      hasDataLoss: false,
      warnings: [],
      statementsToExecute: [],
      apply: vi.fn().mockResolvedValue(undefined),
    };
    mockGenerateMigrationResult = [];
  });

  describe("PostgreSQL", () => {
    // Minimal fake PG drizzle db: db.transaction(cb) runs cb with a tx that
    // records executed SQL. The PG path no longer calls result.apply() — it
    // filters statementsToExecute then runs the safe set inside a transaction.
    function makePgDb() {
      const tx = {
        execute: vi.fn().mockImplementation(() => Promise.resolve()),
      };
      const db = {
        transaction: vi
          .fn()
          .mockImplementation(async (cb: (t: typeof tx) => Promise<void>) => {
            await cb(tx);
          }),
      };
      return { db, tx };
    }

    it("executes safe statements in a transaction (not via apply)", async () => {
      mockPushSchemaResult = {
        hasDataLoss: false,
        warnings: [],
        statementsToExecute: ['CREATE TABLE "users" ("id" text)'],
        apply: vi.fn().mockResolvedValue(undefined),
      };
      const { db, tx } = makePgDb();

      const result = await freshPushSchema(
        "postgresql",
        db,
        await fakeUsersSchema()
      );

      expect(result.applied).toBe(true);
      expect(result.statementsExecuted).toEqual([
        'CREATE TABLE "users" ("id" text)',
      ]);
      expect(db.transaction).toHaveBeenCalledOnce();
      expect(tx.execute).toHaveBeenCalledOnce();
      expect(mockPushSchemaResult.apply).not.toHaveBeenCalled();
    });

    it("forwards hasDataLoss + warnings from drizzle-kit", async () => {
      mockPushSchemaResult = {
        hasDataLoss: true,
        warnings: ["dropping column foo"],
        statementsToExecute: [],
        apply: vi.fn().mockResolvedValue(undefined),
      };
      const { db } = makePgDb();
      const result = await freshPushSchema(
        "postgresql",
        db,
        await fakeUsersSchema()
      );
      expect(result.hasDataLoss).toBe(true);
      expect(result.warnings).toEqual(["dropping column foo"]);
    });

    it("filters out DROP TABLE for tables not in the schema", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      mockPushSchemaResult = {
        hasDataLoss: false,
        warnings: [],
        statementsToExecute: [
          'DROP TABLE "dc_articles"',
          'ALTER TABLE "users" ADD COLUMN "email" text',
        ],
        apply: vi.fn(),
      };
      const { db, tx } = makePgDb();

      const result = await freshPushSchema(
        "postgresql",
        db,
        await fakeUsersSchema()
      );

      // Only the safe ALTER reaches the executor; the user-table DROP is gone.
      expect(tx.execute).toHaveBeenCalledOnce();
      expect(result.statementsExecuted).toEqual([
        'ALTER TABLE "users" ADD COLUMN "email" text',
      ]);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Blocked DROP TABLE "dc_articles"')
      );
    });

    it("propagates errors from statement execution", async () => {
      mockPushSchemaResult = {
        hasDataLoss: false,
        warnings: [],
        statementsToExecute: ['CREATE TABLE "users" ("id" text)'],
        apply: vi.fn(),
      };
      const db = {
        transaction: vi
          .fn()
          .mockImplementation(async (cb: (t: unknown) => Promise<void>) => {
            await cb({
              execute: vi
                .fn()
                .mockRejectedValue(new Error("connection refused")),
            });
          }),
      };
      await expect(
        freshPushSchema("postgresql", db, await fakeUsersSchema())
      ).rejects.toThrow("connection refused");
    });
  });

  describe("SQLite", () => {
    it("filters out DROP TABLE for tables not in the schema", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      mockPushSchemaResult = {
        hasDataLoss: false,
        warnings: [],
        statementsToExecute: ["DROP TABLE `dc_articles`"],
        apply: vi.fn(),
      };
      const fakeDb = { run: vi.fn(), all: vi.fn().mockReturnValue([]) };
      const { sqliteTable, text: sqlText } = await import(
        "drizzle-orm/sqlite-core"
      );
      const schema = {
        users: sqliteTable("users", { id: sqlText("id").primaryKey() }),
      };

      const result = await freshPushSchema("sqlite", fakeDb, schema);

      expect(fakeDb.run).not.toHaveBeenCalled();
      expect(result.statementsExecuted).toEqual([]);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Blocked DROP TABLE "dc_articles"')
      );
    });

    it("returns empty result when drizzle-kit reports no statements", async () => {
      mockPushSchemaResult = {
        hasDataLoss: false,
        warnings: [],
        statementsToExecute: [],
        apply: vi.fn(),
      };
      const fakeDb = { run: vi.fn() };

      const result = await freshPushSchema("sqlite", fakeDb, {});

      expect(result.applied).toBe(true);
      expect(result.statementsExecuted).toEqual([]);
      expect(fakeDb.run).not.toHaveBeenCalled();
    });

    it("executes each statement via db.run()", async () => {
      mockPushSchemaResult = {
        hasDataLoss: false,
        warnings: [],
        statementsToExecute: [
          'CREATE TABLE "users" ("id" text PRIMARY KEY)',
          'ALTER TABLE "users" ADD COLUMN "email" text',
        ],
        apply: vi.fn(),
      };
      const fakeDb = { run: vi.fn() };

      const result = await freshPushSchema("sqlite", fakeDb, {});

      expect(result.applied).toBe(true);
      expect(result.statementsExecuted.length).toBeGreaterThanOrEqual(2);
      expect(fakeDb.run).toHaveBeenCalled();
    });

    it("swallows 'already exists' errors and continues", async () => {
      mockPushSchemaResult = {
        hasDataLoss: false,
        warnings: [],
        statementsToExecute: ['CREATE TABLE "users" ("id" text)'],
        apply: vi.fn(),
      };
      const fakeDb = {
        run: vi.fn().mockImplementation(() => {
          throw new Error("table already exists");
        }),
      };

      const result = await freshPushSchema("sqlite", fakeDb, {});

      // `already exists` is silently skipped — applied is still true.
      expect(result.applied).toBe(true);
      expect(result.statementsExecuted).toEqual([]);
    });

    it("re-throws non-idempotent errors", async () => {
      mockPushSchemaResult = {
        hasDataLoss: false,
        warnings: [],
        statementsToExecute: ['CREATE TABLE "users" ("id" text)'],
        apply: vi.fn(),
      };
      const fakeDb = {
        run: vi.fn().mockImplementation(() => {
          throw new Error("syntax error near 'PRIMARY'");
        }),
      };

      await expect(freshPushSchema("sqlite", fakeDb, {})).rejects.toThrow(
        "syntax error near 'PRIMARY'"
      );
    });
  });

  describe("MySQL", () => {
    it("uses generateMigration path (not pushSchema.apply)", async () => {
      mockGenerateMigrationResult = [
        "CREATE TABLE `users` (`id` varchar(255) NOT NULL PRIMARY KEY)",
      ];
      const fakeDb = {
        execute: vi.fn().mockResolvedValue({}),
      };

      const result = await freshPushSchema("mysql", fakeDb, {});

      expect(result.applied).toBe(true);
      expect(fakeDb.execute).toHaveBeenCalled();
    });

    it("rewrites bare CREATE TABLE to CREATE TABLE IF NOT EXISTS", async () => {
      mockGenerateMigrationResult = [
        "CREATE TABLE `users` (`id` varchar(255) NOT NULL PRIMARY KEY)",
      ];
      const captured: string[] = [];
      const fakeDb = {
        execute: vi.fn().mockImplementation((sql: { sql?: string }) => {
          // sqlTag.raw produces a SQL chunk object with a .sql property.
          // Capture the queryChunks for assertion.
          const stringified = JSON.stringify(sql);
          captured.push(stringified);
          return Promise.resolve({});
        }),
      };

      await freshPushSchema("mysql", fakeDb, {});

      const merged = captured.join("\n");
      expect(merged).toContain("CREATE TABLE IF NOT EXISTS");
    });

    it("swallows 'Duplicate' errors and continues", async () => {
      mockGenerateMigrationResult = [
        "CREATE TABLE `users` (`id` varchar(255) NOT NULL PRIMARY KEY)",
      ];
      const fakeDb = {
        execute: vi.fn().mockRejectedValue(new Error("Duplicate column")),
      };

      const result = await freshPushSchema("mysql", fakeDb, {});

      // Duplicate is treated like already-exists — applied stays true.
      expect(result.applied).toBe(true);
      expect(result.statementsExecuted).toEqual([]);
    });
  });

  describe("dialect dispatch", () => {
    it("rejects unknown dialects at the entry-point guard", async () => {
      // TS rejects this at compile time; the runtime guard at the top of
      // freshPushSchema throws cleanly with the offending value embedded
      // in the message, defending against plugin authors who bypass TS
      // with `as any` somewhere upstream.
      await expect(
        freshPushSchema("oracle" as unknown as "postgresql", {}, {})
      ).rejects.toThrow("Unsupported dialect: oracle");
    });
  });
});
