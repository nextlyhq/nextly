// Tests for freshPushSchema — the direct pushSchema helper for fresh /
// static-tables-only flows (ensureCoreTables, migrate core-reconcile,
// migrate:fresh's MySQL safety net, first-run).
//
// v1 contract under test:
//   - ALL dialects route through pushSchema (the pre-v1 MySQL
//     generateMigration detour existed for a 0.31 silent-DDL-drop bug
//     that v1 fixed — verified against real MySQL 8, 2026-07-16).
//   - Result shape is { hints, statementsExecuted, applied } — the
//     pre-v1 hasDataLoss/warnings fields no longer exist anywhere.
//   - Boot-safety policy: unexpected destructive statements are STRIPPED
//     and reported via hints + console.warn (a boot must not brick),
//     unlike the interactive pipeline which throws.
//
// Tests mock drizzle-kit-lazy at the module boundary; real cross-dialect
// behavior is covered by the integration matrix (docker PG/MySQL +
// in-memory SQLite).

import { describe, it, expect, vi, beforeEach } from "vitest";

// Module-level mock state. Reset in beforeEach.
let mockPushSchemaResult: {
  sqlStatements: string[];
  hints: Array<{ hint: string; statement?: string }>;
  apply: ReturnType<typeof vi.fn>;
};
const pushSchemaSpy = vi.fn();

vi.mock("../../../../database/drizzle-kit-lazy", () => ({
  getPgDrizzleKit: () =>
    Promise.resolve({
      pushSchema: pushSchemaSpy.mockImplementation(() =>
        Promise.resolve(mockPushSchemaResult)
      ),
      generateDrizzleJson: vi.fn().mockResolvedValue({}),
      generateMigration: vi.fn().mockResolvedValue([]),
    }),
  getMySQLDrizzleKit: () =>
    Promise.resolve({
      pushSchema: pushSchemaSpy.mockImplementation(() =>
        Promise.resolve(mockPushSchemaResult)
      ),
      generateDrizzleJson: vi.fn().mockResolvedValue({}),
      generateMigration: vi.fn().mockResolvedValue([]),
    }),
  getSQLiteDrizzleKit: () =>
    Promise.resolve({
      pushSchema: pushSchemaSpy.mockImplementation(() =>
        Promise.resolve(mockPushSchemaResult)
      ),
      generateDrizzleJson: vi.fn().mockResolvedValue({}),
      generateMigration: vi.fn().mockResolvedValue([]),
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
      sqlStatements: [],
      hints: [],
      apply: vi.fn().mockResolvedValue(undefined),
    };
  });

  describe("PostgreSQL", () => {
    // Minimal fake PG drizzle db: db.transaction(cb) runs cb with a tx that
    // records executed SQL. The PG path never calls result.apply() — it
    // filters sqlStatements then runs the safe set inside a transaction.
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
        sqlStatements: ['CREATE TABLE "users" ("id" text)'],
        hints: [],
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

    it("forwards drizzle-kit hints on the result", async () => {
      mockPushSchemaResult = {
        sqlStatements: [],
        hints: [{ hint: "something upstream flagged" }],
        apply: vi.fn(),
      };
      const { db } = makePgDb();
      const result = await freshPushSchema(
        "postgresql",
        db,
        await fakeUsersSchema()
      );
      expect(result.hints).toEqual([{ hint: "something upstream flagged" }]);
    });

    it("passes the named entities filter to pushSchema", async () => {
      const { db } = makePgDb();
      await freshPushSchema("postgresql", db, await fakeUsersSchema());
      expect(pushSchemaSpy).toHaveBeenCalledWith(
        expect.anything(),
        db,
        expect.objectContaining({ schemas: ["public"] })
      );
    });

    it("filters out DROP TABLE for tables not in the schema", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      mockPushSchemaResult = {
        sqlStatements: [
          'DROP TABLE "dc_articles"',
          'ALTER TABLE "users" ADD COLUMN "email" text',
        ],
        hints: [],
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

    it("strips unexpected destructive statements (boot-safety) and reports them", async () => {
      // v1 INCLUDES destructive statements with empty hints. A DROP TABLE
      // for a table that IS in the desired schema passes the drop-guard
      // (legitimate-rebuild rule) — the destructive scan is the second
      // net: no matching `__new_` rebuild rename in the batch means the
      // drop is unexpected. Boot policy: strip + report, never execute.
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      mockPushSchemaResult = {
        sqlStatements: [
          'DROP TABLE "users"',
          'ALTER TABLE "users" ADD COLUMN "email" text',
        ],
        hints: [],
        apply: vi.fn(),
      };
      const { db, tx } = makePgDb();

      const result = await freshPushSchema(
        "postgresql",
        db,
        await fakeUsersSchema()
      );

      expect(result.statementsExecuted).toEqual([
        'ALTER TABLE "users" ADD COLUMN "email" text',
      ]);
      expect(tx.execute).toHaveBeenCalledOnce();
      expect(result.hints).toEqual([
        {
          hint: "blocked destructive statement on fresh-push",
          statement: 'DROP TABLE "users"',
        },
      ]);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("blocked a destructive statement")
      );
    });

    it("propagates errors from statement execution", async () => {
      mockPushSchemaResult = {
        sqlStatements: ['CREATE TABLE "users" ("id" text)'],
        hints: [],
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
        sqlStatements: ["DROP TABLE `dc_articles`"],
        hints: [],
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
      const fakeDb = { run: vi.fn() };

      const result = await freshPushSchema("sqlite", fakeDb, {});

      expect(result.applied).toBe(true);
      expect(result.statementsExecuted).toEqual([]);
      expect(fakeDb.run).not.toHaveBeenCalled();
    });

    it("executes each statement via db.run(), including v1's inline PRAGMAs", async () => {
      mockPushSchemaResult = {
        sqlStatements: [
          "PRAGMA foreign_keys=OFF;",
          'CREATE TABLE "users" ("id" text PRIMARY KEY)',
          "PRAGMA foreign_keys=ON;",
        ],
        hints: [],
        apply: vi.fn(),
      };
      const fakeDb = { run: vi.fn() };

      const result = await freshPushSchema("sqlite", fakeDb, {});

      expect(result.applied).toBe(true);
      // v1 emits the FK-pragma choreography inside the statement stream;
      // dropping it would run rebuilds with FK enforcement in an unknown
      // state (#5782 territory), so PRAGMAs must pass the piece filter.
      expect(result.statementsExecuted).toHaveLength(3);
      expect(fakeDb.run).toHaveBeenCalledTimes(3);
    });

    it("swallows 'already exists' errors and continues", async () => {
      mockPushSchemaResult = {
        sqlStatements: ['CREATE TABLE "users" ("id" text)'],
        hints: [],
        apply: vi.fn(),
      };
      const fakeDb = {
        run: vi.fn().mockImplementation(() => {
          throw new Error("table already exists");
        }),
      };

      const result = await freshPushSchema("sqlite", fakeDb, {});

      expect(result.applied).toBe(true);
      expect(result.statementsExecuted).toEqual([]);
    });

    it("swallows idempotency errors wrapped with the driver error on .cause (v1 DrizzleQueryError shape)", async () => {
      mockPushSchemaResult = {
        sqlStatements: ['CREATE TABLE "users" ("id" text)'],
        hints: [],
        apply: vi.fn(),
      };
      const fakeDb = {
        run: vi.fn().mockImplementation(() => {
          throw new Error("Failed query: CREATE TABLE ...", {
            cause: new Error("table users already exists"),
          });
        }),
      };

      const result = await freshPushSchema("sqlite", fakeDb, {});
      expect(result.applied).toBe(true);
    });

    it("re-throws non-idempotent errors", async () => {
      mockPushSchemaResult = {
        sqlStatements: ['CREATE TABLE "users" ("id" text)'],
        hints: [],
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
    // v1's MySQL entrypoint needs the database name positionally; the
    // helper resolves it from the live connection (SELECT DATABASE()) so
    // callers don't thread it through. drizzle-orm/mysql2 execute()
    // resolves to [rows, fields].
    function makeMysqlDb(executed: string[] = []) {
      return {
        execute: vi.fn().mockImplementation((q: { queryChunks?: unknown }) => {
          const text = JSON.stringify(q);
          executed.push(text);
          if (text.includes("SELECT DATABASE()")) {
            return Promise.resolve([[{ db: "nextly_test" }], []]);
          }
          return Promise.resolve([[], []]);
        }),
      };
    }

    it("routes through pushSchema with the resolved database name (the 0.31 generateMigration detour is gone)", async () => {
      mockPushSchemaResult = {
        sqlStatements: ["CREATE TABLE `users` (`id` varchar(36) PRIMARY KEY)"],
        hints: [],
        apply: vi.fn(),
      };
      const db = makeMysqlDb();

      const result = await freshPushSchema("mysql", db, {});

      expect(result.applied).toBe(true);
      expect(pushSchemaSpy).toHaveBeenCalledWith(
        expect.anything(),
        db,
        "nextly_test"
      );
      expect(result.statementsExecuted).toHaveLength(1);
    });

    it("throws an actionable error when no database is selected on the connection", async () => {
      const db = {
        execute: vi.fn().mockResolvedValue([[{ db: null }], []]),
      };
      await expect(freshPushSchema("mysql", db, {})).rejects.toThrow(
        "could not determine the current MySQL database"
      );
    });

    it("swallows 'Duplicate' errors and continues", async () => {
      mockPushSchemaResult = {
        sqlStatements: ["CREATE TABLE `users` (`id` varchar(36) PRIMARY KEY)"],
        hints: [],
        apply: vi.fn(),
      };
      const executed: string[] = [];
      const db = {
        execute: vi.fn().mockImplementation((q: unknown) => {
          const text = JSON.stringify(q);
          executed.push(text);
          if (text.includes("SELECT DATABASE()")) {
            return Promise.resolve([[{ db: "nextly_test" }], []]);
          }
          return Promise.reject(new Error("Duplicate column"));
        }),
      };

      const result = await freshPushSchema("mysql", db, {});

      expect(result.applied).toBe(true);
      expect(result.statementsExecuted).toEqual([]);
    });
  });

  describe("dialect dispatch", () => {
    it("rejects unknown dialects at the entry-point guard", async () => {
      await expect(
        freshPushSchema("oracle" as unknown as "postgresql", {}, {})
      ).rejects.toThrow("Unsupported dialect: oracle");
    });
  });
});
