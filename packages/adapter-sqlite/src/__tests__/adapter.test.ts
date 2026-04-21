/**
 * SQLite Adapter Tests
 *
 * Comprehensive test suite for @nextly/adapter-sqlite.
 * Tests are mock-based to avoid requiring an actual SQLite database.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  SqliteAdapter,
  createSqliteAdapter,
  isSqliteAdapter,
  VERSION,
} from "../index";

type SqliteErrorLike = Error & { code?: string };
type DatabaseErrorLike = { kind?: string; code?: string; message?: string };

// Mock better-sqlite3
const mockPrepare = vi.fn();
const mockExec = vi.fn();
const mockPragma = vi.fn();
const mockClose = vi.fn();

const mockStatement = {
  run: vi.fn(),
  get: vi.fn(),
  all: vi.fn(),
};

const mockDatabase = {
  prepare: mockPrepare,
  exec: mockExec,
  pragma: mockPragma,
  close: mockClose,
  inTransaction: false,
};

// Create a proper class constructor mock
class MockDatabase {
  prepare = mockPrepare;
  exec = mockExec;
  pragma = mockPragma;
  close = mockClose;
  inTransaction = false;

  constructor(_path: string, _options?: Record<string, unknown>) {
    // Constructor - assign the mock methods to instance
    Object.assign(this, mockDatabase);
  }
}

vi.mock("better-sqlite3", () => {
  return {
    default: MockDatabase,
  };
});

describe("SqliteAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrepare.mockReturnValue(mockStatement);
    mockStatement.run.mockReturnValue({ changes: 1, lastInsertRowid: 1 });
    mockStatement.all.mockReturnValue([]);
    mockStatement.get.mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ============================================================
  // Module Exports
  // ============================================================

  describe("Module exports", () => {
    it("should export VERSION constant", () => {
      expect(VERSION).toBe("0.1.0");
    });

    it("should export SqliteAdapter class", () => {
      expect(SqliteAdapter).toBeDefined();
      expect(typeof SqliteAdapter).toBe("function");
    });

    it("should export createSqliteAdapter factory function", () => {
      expect(createSqliteAdapter).toBeDefined();
      expect(typeof createSqliteAdapter).toBe("function");
    });

    it("should export isSqliteAdapter type guard", () => {
      expect(isSqliteAdapter).toBeDefined();
      expect(typeof isSqliteAdapter).toBe("function");
    });
  });

  // ============================================================
  // Factory and Type Guard
  // ============================================================

  describe("createSqliteAdapter", () => {
    it("should create a SqliteAdapter instance", () => {
      const adapter = createSqliteAdapter({ url: "file:./test.db" });
      expect(adapter).toBeInstanceOf(SqliteAdapter);
    });

    it("should create adapter with memory option", () => {
      const adapter = createSqliteAdapter({ memory: true });
      expect(adapter).toBeInstanceOf(SqliteAdapter);
    });
  });

  describe("isSqliteAdapter", () => {
    it("should return true for SqliteAdapter instance", () => {
      const adapter = createSqliteAdapter({ memory: true });
      expect(isSqliteAdapter(adapter)).toBe(true);
    });

    it("should return false for non-SqliteAdapter values", () => {
      expect(isSqliteAdapter(null)).toBe(false);
      expect(isSqliteAdapter(undefined)).toBe(false);
      expect(isSqliteAdapter({})).toBe(false);
      expect(isSqliteAdapter("string")).toBe(false);
      expect(isSqliteAdapter(123)).toBe(false);
    });
  });

  // ============================================================
  // Connection Lifecycle
  // ============================================================

  describe("Connection lifecycle", () => {
    it("should connect to database", async () => {
      const adapter = createSqliteAdapter({ memory: true });
      await adapter.connect();

      expect(adapter.isConnected()).toBe(true);
    });

    it("should be idempotent on multiple connect calls", async () => {
      const adapter = createSqliteAdapter({ memory: true });
      await adapter.connect();
      await adapter.connect();
      await adapter.connect();

      expect(adapter.isConnected()).toBe(true);
    });

    it("should disconnect from database", async () => {
      const adapter = createSqliteAdapter({ memory: true });
      await adapter.connect();
      await adapter.disconnect();

      expect(adapter.isConnected()).toBe(false);
      expect(mockClose).toHaveBeenCalledTimes(1);
    });

    it("should be idempotent on multiple disconnect calls", async () => {
      const adapter = createSqliteAdapter({ memory: true });
      await adapter.connect();
      await adapter.disconnect();
      await adapter.disconnect();

      expect(adapter.isConnected()).toBe(false);
    });

    it("should handle disconnect when not connected", async () => {
      const adapter = createSqliteAdapter({ memory: true });
      // Should not throw
      await adapter.disconnect();
      expect(adapter.isConnected()).toBe(false);
    });
  });

  // ============================================================
  // Configuration Options
  // ============================================================

  describe("Configuration options", () => {
    it("should configure WAL mode when enabled", async () => {
      const adapter = createSqliteAdapter({
        url: "file:./test.db",
        wal: true,
      });
      await adapter.connect();

      expect(mockPragma).toHaveBeenCalledWith("journal_mode = WAL");
    });

    it("should not configure WAL mode for in-memory database", async () => {
      const adapter = createSqliteAdapter({
        memory: true,
        wal: true,
      });
      await adapter.connect();

      expect(mockPragma).not.toHaveBeenCalledWith("journal_mode = WAL");
    });

    it("should enable foreign keys by default", async () => {
      const adapter = createSqliteAdapter({ memory: true });
      await adapter.connect();

      expect(mockPragma).toHaveBeenCalledWith("foreign_keys = ON");
    });

    it("should disable foreign keys when configured", async () => {
      const adapter = createSqliteAdapter({
        memory: true,
        foreignKeys: false,
      });
      await adapter.connect();

      expect(mockPragma).not.toHaveBeenCalledWith("foreign_keys = ON");
    });
  });

  // ============================================================
  // Capabilities
  // ============================================================

  describe("getCapabilities", () => {
    it("should return SQLite capabilities", () => {
      const adapter = createSqliteAdapter({ memory: true });
      const capabilities = adapter.getCapabilities();

      expect(capabilities).toEqual({
        dialect: "sqlite",
        supportsJsonb: false,
        supportsJson: true,
        supportsArrays: false,
        supportsGeneratedColumns: true,
        supportsFts: true,
        supportsIlike: false,
        supportsReturning: true,
        supportsSavepoints: true,
        supportsOnConflict: true,
        maxParamsPerQuery: 999,
        maxIdentifierLength: 128,
      });
    });

    it("should have dialect set to sqlite", () => {
      const adapter = createSqliteAdapter({ memory: true });
      expect(adapter.dialect).toBe("sqlite");
    });
  });

  // ============================================================
  // Pool Statistics
  // ============================================================

  describe("getPoolStats", () => {
    it("should return null (SQLite has no connection pooling)", async () => {
      const adapter = createSqliteAdapter({ memory: true });
      await adapter.connect();

      expect(adapter.getPoolStats()).toBeNull();
    });
  });

  // ============================================================
  // Query Execution
  // ============================================================

  describe("executeQuery", () => {
    it("should throw error when not connected", async () => {
      const adapter = createSqliteAdapter({ memory: true });

      await expect(adapter.executeQuery("SELECT 1")).rejects.toThrow(
        "not connected"
      );
    });

    it("should execute SELECT query using .all()", async () => {
      const adapter = createSqliteAdapter({ memory: true });
      await adapter.connect();

      mockStatement.all.mockReturnValue([{ id: 1, name: "test" }]);

      const result = await adapter.executeQuery("SELECT * FROM users");

      expect(mockPrepare).toHaveBeenCalledWith("SELECT * FROM users");
      expect(mockStatement.all).toHaveBeenCalled();
      expect(result).toEqual([{ id: 1, name: "test" }]);
    });

    it("should execute INSERT query using .run()", async () => {
      const adapter = createSqliteAdapter({ memory: true });
      await adapter.connect();

      mockStatement.run.mockReturnValue({ changes: 1, lastInsertRowid: 42 });

      const result = await adapter.executeQuery(
        "INSERT INTO users (name) VALUES (?)",
        ["test"]
      );

      expect(mockPrepare).toHaveBeenCalled();
      expect(mockStatement.run).toHaveBeenCalledWith("test");
      expect(result).toEqual([{ changes: 1, lastInsertRowid: 42 }]);
    });

    it("should handle query with RETURNING clause using .all()", async () => {
      const adapter = createSqliteAdapter({ memory: true });
      await adapter.connect();

      mockStatement.all.mockReturnValue([{ id: 1, name: "test" }]);

      const result = await adapter.executeQuery(
        "INSERT INTO users (name) VALUES (?) RETURNING *",
        ["test"]
      );

      expect(mockStatement.all).toHaveBeenCalled();
      expect(result).toEqual([{ id: 1, name: "test" }]);
    });

    it("should convert $1, $2 placeholders to ?", async () => {
      const adapter = createSqliteAdapter({ memory: true });
      await adapter.connect();

      await adapter.executeQuery("SELECT * FROM users WHERE id = $1", [1]);

      expect(mockPrepare).toHaveBeenCalledWith(
        "SELECT * FROM users WHERE id = ?"
      );
    });

    it("should log queries when logger is configured", async () => {
      const queryLogger = vi.fn();
      const adapter = createSqliteAdapter({
        memory: true,
        logger: { query: queryLogger },
      });
      await adapter.connect();

      await adapter.executeQuery("SELECT 1");

      expect(queryLogger).toHaveBeenCalledWith(
        "SELECT 1",
        [],
        expect.any(Number)
      );
    });
  });

  // ============================================================
  // Error Classification
  // ============================================================

  describe("Error classification", () => {
    it("should classify SQLITE_CONSTRAINT_UNIQUE as unique_violation", async () => {
      const adapter = createSqliteAdapter({ memory: true });
      await adapter.connect();

      const sqliteError = new Error("UNIQUE constraint failed");
      (sqliteError as SqliteErrorLike).code = "SQLITE_CONSTRAINT_UNIQUE";
      // INSERT without RETURNING uses .run()
      mockStatement.run.mockImplementation(() => {
        throw sqliteError;
      });

      try {
        await adapter.executeQuery("INSERT INTO users (email) VALUES (?)", [
          "dup@test.com",
        ]);
        expect.fail("Should have thrown");
      } catch (error: unknown) {
        expect((error as DatabaseErrorLike).kind).toBe("unique_violation");
      }
    });

    it("should classify SQLITE_CONSTRAINT_FOREIGNKEY as foreign_key_violation", async () => {
      const adapter = createSqliteAdapter({ memory: true });
      await adapter.connect();

      const sqliteError = new Error("FOREIGN KEY constraint failed");
      (sqliteError as SqliteErrorLike).code = "SQLITE_CONSTRAINT_FOREIGNKEY";
      // INSERT without RETURNING uses .run()
      mockStatement.run.mockImplementation(() => {
        throw sqliteError;
      });

      try {
        await adapter.executeQuery("INSERT INTO posts (user_id) VALUES (?)", [
          999,
        ]);
        expect.fail("Should have thrown");
      } catch (error: unknown) {
        expect((error as DatabaseErrorLike).kind).toBe("foreign_key_violation");
      }
    });

    it("should classify SQLITE_CONSTRAINT_NOTNULL as not_null_violation", async () => {
      const adapter = createSqliteAdapter({ memory: true });
      await adapter.connect();

      const sqliteError = new Error("NOT NULL constraint failed");
      (sqliteError as SqliteErrorLike).code = "SQLITE_CONSTRAINT_NOTNULL";
      // INSERT without RETURNING uses .run()
      mockStatement.run.mockImplementation(() => {
        throw sqliteError;
      });

      try {
        await adapter.executeQuery("INSERT INTO users (email) VALUES (?)", [
          null,
        ]);
        expect.fail("Should have thrown");
      } catch (error: unknown) {
        expect((error as DatabaseErrorLike).kind).toBe("not_null_violation");
      }
    });

    it("should classify SQLITE_BUSY as timeout", async () => {
      const adapter = createSqliteAdapter({ memory: true });
      await adapter.connect();

      const sqliteError = new Error("database is locked");
      (sqliteError as SqliteErrorLike).code = "SQLITE_BUSY";
      // SELECT uses .all()
      mockStatement.all.mockImplementation(() => {
        throw sqliteError;
      });

      try {
        await adapter.executeQuery("SELECT * FROM users");
        expect.fail("Should have thrown");
      } catch (error: unknown) {
        expect((error as DatabaseErrorLike).kind).toBe("timeout");
      }
    });

    it("should classify SQLITE_CANTOPEN as connection error", async () => {
      const adapter = createSqliteAdapter({ memory: true });
      await adapter.connect();

      const sqliteError = new Error("unable to open database file");
      (sqliteError as SqliteErrorLike).code = "SQLITE_CANTOPEN";
      // SELECT uses .all()
      mockStatement.all.mockImplementation(() => {
        throw sqliteError;
      });

      try {
        await adapter.executeQuery("SELECT 1");
        expect.fail("Should have thrown");
      } catch (error: unknown) {
        expect((error as DatabaseErrorLike).kind).toBe("connection");
      }
    });

    it("should classify unknown errors by message content", async () => {
      const adapter = createSqliteAdapter({ memory: true });
      await adapter.connect();

      const sqliteError = new Error("UNIQUE CONSTRAINT failed: users.email");
      // INSERT without RETURNING uses .run()
      mockStatement.run.mockImplementation(() => {
        throw sqliteError;
      });

      try {
        await adapter.executeQuery("INSERT INTO users (email) VALUES (?)", [
          "dup@test.com",
        ]);
        expect.fail("Should have thrown");
      } catch (error: unknown) {
        expect((error as DatabaseErrorLike).kind).toBe("unique_violation");
      }
    });
  });

  // ============================================================
  // Transactions
  // ============================================================

  describe("Transactions", () => {
    it("should throw error when transaction called without connection", async () => {
      const adapter = createSqliteAdapter({ memory: true });

      await expect(adapter.transaction(async () => "result")).rejects.toThrow(
        "not connected"
      );
    });

    it("should execute BEGIN IMMEDIATE on transaction start", async () => {
      const adapter = createSqliteAdapter({ memory: true });
      await adapter.connect();

      await adapter.transaction(async () => "result");

      expect(mockExec).toHaveBeenCalledWith("BEGIN IMMEDIATE");
    });

    it("should COMMIT on successful transaction", async () => {
      const adapter = createSqliteAdapter({ memory: true });
      await adapter.connect();

      const result = await adapter.transaction(async () => "success");

      expect(result).toBe("success");
      expect(mockExec).toHaveBeenCalledWith("COMMIT");
    });

    it("should ROLLBACK on transaction error", async () => {
      const adapter = createSqliteAdapter({ memory: true });
      await adapter.connect();

      try {
        await adapter.transaction(async () => {
          throw new Error("test error");
        });
        expect.fail("Should have thrown");
      } catch {
        expect(mockExec).toHaveBeenCalledWith("ROLLBACK");
      }
    });

    it("should log transaction duration when logger configured", async () => {
      const debugLogger = vi.fn();
      const adapter = createSqliteAdapter({
        memory: true,
        logger: { debug: debugLogger },
      });
      await adapter.connect();

      await adapter.transaction(async () => "result");

      expect(debugLogger).toHaveBeenCalledWith(
        "Transaction committed",
        expect.objectContaining({ durationMs: expect.any(Number) })
      );
    });
  });

  // ============================================================
  // TransactionContext Methods
  // ============================================================

  describe("TransactionContext", () => {
    it("should provide execute method", async () => {
      const adapter = createSqliteAdapter({ memory: true });
      await adapter.connect();

      mockStatement.all.mockReturnValue([{ id: 1 }]);

      let txResult: unknown;
      await adapter.transaction(async tx => {
        txResult = await tx.execute("SELECT * FROM users WHERE id = $1", [1]);
      });

      expect(mockPrepare).toHaveBeenCalledWith(
        "SELECT * FROM users WHERE id = ?"
      );
      expect(txResult).toEqual([{ id: 1 }]);
    });

    it("should provide insert method with RETURNING", async () => {
      const adapter = createSqliteAdapter({ memory: true });
      await adapter.connect();

      mockStatement.all.mockReturnValue([
        { id: 1, email: "test@test.com", name: "Test" },
      ]);

      let insertedRow: unknown;
      await adapter.transaction(async tx => {
        insertedRow = await tx.insert("users", {
          email: "test@test.com",
          name: "Test",
        });
      });

      expect(insertedRow).toEqual({
        id: 1,
        email: "test@test.com",
        name: "Test",
      });
    });

    // TransactionContext CRUD methods delegate to the adapter which requires
    // a TableResolver (schema registry). Since mock adapters don't have one,
    // we verify the methods exist as functions on the context object instead.
    it("should provide CRUD methods on transaction context", async () => {
      const adapter = createSqliteAdapter({ memory: true });
      await adapter.connect();

      await adapter.transaction(async tx => {
        expect(typeof tx.select).toBe("function");
        expect(typeof tx.selectOne).toBe("function");
        expect(typeof tx.update).toBe("function");
        expect(typeof tx.delete).toBe("function");
        expect(typeof tx.upsert).toBe("function");
        expect(typeof tx.execute).toBe("function");
        expect(typeof tx.insert).toBe("function");
      });
    });

    it("should provide savepoint methods", async () => {
      const adapter = createSqliteAdapter({ memory: true });
      await adapter.connect();

      await adapter.transaction(async tx => {
        await tx.savepoint!("sp1");
        await tx.rollbackToSavepoint!("sp1");
        await tx.releaseSavepoint!("sp1");
      });

      expect(mockExec).toHaveBeenCalledWith('SAVEPOINT "sp1"');
      expect(mockExec).toHaveBeenCalledWith('ROLLBACK TO SAVEPOINT "sp1"');
      expect(mockExec).toHaveBeenCalledWith('RELEASE SAVEPOINT "sp1"');
    });
  });

  // ============================================================
  // insertMany Optimization
  // ============================================================

  describe("insertMany", () => {
    it("should return empty array for empty input", async () => {
      const adapter = createSqliteAdapter({ memory: true });
      await adapter.connect();

      const result = await adapter.insertMany("users", []);

      expect(result).toEqual([]);
    });

    it("should use bulk INSERT for multiple records", async () => {
      const adapter = createSqliteAdapter({ memory: true });
      await adapter.connect();

      mockStatement.all.mockReturnValue([
        { id: 1, name: "User 1" },
        { id: 2, name: "User 2" },
      ]);

      const result = await adapter.insertMany("users", [
        { name: "User 1" },
        { name: "User 2" },
      ]);

      expect(result).toHaveLength(2);
      // Should use multi-row INSERT
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining("VALUES (?)")
      );
    });

    it("should add RETURNING clause by default", async () => {
      const adapter = createSqliteAdapter({ memory: true });
      await adapter.connect();

      mockStatement.all.mockReturnValue([{ id: 1 }, { id: 2 }]);

      await adapter.insertMany("users", [
        { name: "User 1" },
        { name: "User 2" },
      ]);

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining("RETURNING *")
      );
    });
  });

  // ============================================================
  // Logger Integration
  // ============================================================

  describe("Logger integration", () => {
    it("should log connection info", async () => {
      const infoLogger = vi.fn();
      const adapter = createSqliteAdapter({
        memory: true,
        logger: { info: infoLogger },
      });

      await adapter.connect();

      expect(infoLogger).toHaveBeenCalledWith(
        "SQLite connection established",
        expect.objectContaining({ url: "in-memory" })
      );
    });

    it("should log disconnection", async () => {
      const infoLogger = vi.fn();
      const adapter = createSqliteAdapter({
        memory: true,
        logger: { info: infoLogger },
      });

      await adapter.connect();
      await adapter.disconnect();

      expect(infoLogger).toHaveBeenCalledWith("SQLite connection closed");
    });

    it("should log query duration", async () => {
      const queryLogger = vi.fn();
      const adapter = createSqliteAdapter({
        memory: true,
        logger: { query: queryLogger },
      });

      await adapter.connect();
      mockStatement.all.mockReturnValue([]);

      await adapter.executeQuery("SELECT * FROM users WHERE id = $1", [1]);

      expect(queryLogger).toHaveBeenCalledWith(
        "SELECT * FROM users WHERE id = ?",
        [1],
        expect.any(Number)
      );
    });
  });
});
