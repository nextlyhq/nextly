/**
 * @nextly/adapter-mysql - Test Suite
 *
 * Comprehensive tests for MySQL adapter functionality.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  MySqlAdapter,
  createMySqlAdapter,
  isMySqlAdapter,
  VERSION,
} from "../index";

// ============================================================
// Mock mysql2/promise
// ============================================================

// Mock connection
const mockConnection = {
  query: vi.fn(),
  release: vi.fn(),
};

// Mock pool with internal structure
const mockPool = {
  getConnection: vi.fn().mockResolvedValue(mockConnection),
  query: vi.fn(),
  end: vi.fn().mockResolvedValue(undefined),
  pool: {
    _allConnections: { length: 5 },
    _freeConnections: { length: 3 },
    _connectionQueue: { length: 1 },
  },
};

// Mock mysql2/promise module
vi.mock("mysql2/promise", () => ({
  default: {
    createPool: vi.fn(() => mockPool),
  },
  createPool: vi.fn(() => mockPool),
}));

// ============================================================
// Test Suites
// ============================================================

describe("@nextly/adapter-mysql", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock implementations - use mockImplementation to handle all calls
    // Why: F17 added a SELECT VERSION() AS version call after SELECT 1.
    // Route by SQL so the version query returns a real-MySQL 8 response.
    mockConnection.query.mockImplementation((sql: string) => {
      if (typeof sql === "string" && sql.toLowerCase().includes("version()")) {
        return Promise.resolve([[{ version: "8.0.33" }], []]);
      }
      return Promise.resolve([[], []]);
    });
    mockConnection.release.mockReturnValue(undefined);
    mockPool.getConnection.mockResolvedValue(mockConnection);
    mockPool.query.mockImplementation(() => Promise.resolve([[], []]));
    mockPool.end.mockResolvedValue(undefined);
  });

  // ============================================================
  // Module Exports
  // ============================================================

  describe("Module Exports", () => {
    it("should export MySqlAdapter class", () => {
      expect(MySqlAdapter).toBeDefined();
      expect(typeof MySqlAdapter).toBe("function");
    });

    it("should export createMySqlAdapter factory function", () => {
      expect(createMySqlAdapter).toBeDefined();
      expect(typeof createMySqlAdapter).toBe("function");
    });

    it("should export isMySqlAdapter type guard", () => {
      expect(isMySqlAdapter).toBeDefined();
      expect(typeof isMySqlAdapter).toBe("function");
    });

    it("should export VERSION constant", () => {
      expect(VERSION).toBe("0.1.0");
    });
  });

  // ============================================================
  // Factory and Type Guard
  // ============================================================

  describe("Factory and Type Guard", () => {
    it("should create adapter instance via factory", () => {
      const adapter = createMySqlAdapter({
        url: "mysql://localhost:3306/test",
      });

      expect(adapter).toBeInstanceOf(MySqlAdapter);
    });

    it("should identify MySqlAdapter via type guard", () => {
      const adapter = createMySqlAdapter({
        url: "mysql://localhost:3306/test",
      });

      expect(isMySqlAdapter(adapter)).toBe(true);
    });

    it("should reject non-MySqlAdapter via type guard", () => {
      expect(isMySqlAdapter({})).toBe(false);
      expect(isMySqlAdapter(null)).toBe(false);
      expect(isMySqlAdapter("string")).toBe(false);
      expect(isMySqlAdapter(123)).toBe(false);
    });
  });

  // ============================================================
  // Connection Lifecycle
  // ============================================================

  describe("Connection Lifecycle", () => {
    it("should connect to MySQL database", async () => {
      const adapter = createMySqlAdapter({
        url: "mysql://localhost:3306/test",
      });

      await adapter.connect();

      expect(adapter.isConnected()).toBe(true);
    });

    it("should disconnect from MySQL database", async () => {
      const adapter = createMySqlAdapter({
        url: "mysql://localhost:3306/test",
      });

      await adapter.connect();
      await adapter.disconnect();

      expect(adapter.isConnected()).toBe(false);
    });

    it("should be idempotent on multiple connects", async () => {
      const adapter = createMySqlAdapter({
        url: "mysql://localhost:3306/test",
      });

      await adapter.connect();
      await adapter.connect();
      await adapter.connect();

      expect(adapter.isConnected()).toBe(true);
    });

    it("should be idempotent on multiple disconnects", async () => {
      const adapter = createMySqlAdapter({
        url: "mysql://localhost:3306/test",
      });

      await adapter.connect();
      await adapter.disconnect();
      await adapter.disconnect();
      await adapter.disconnect();

      expect(adapter.isConnected()).toBe(false);
    });

    it("should handle connection errors", async () => {
      const connectionError = new Error("Connection refused");
      mockPool.getConnection.mockRejectedValueOnce(connectionError);

      const adapter = createMySqlAdapter({
        url: "mysql://localhost:3306/test",
      });

      await expect(adapter.connect()).rejects.toThrow();
      expect(adapter.isConnected()).toBe(false);
    });
  });

  // ============================================================
  // Pool Configuration
  // ============================================================

  describe("Pool Configuration", () => {
    it("should configure pool with URL", async () => {
      const mysql = await import("mysql2/promise");

      const adapter = createMySqlAdapter({
        url: "mysql://user:pass@localhost:3306/mydb",
      });

      await adapter.connect();

      expect(mysql.default.createPool).toHaveBeenCalledWith(
        expect.objectContaining({
          uri: "mysql://user:pass@localhost:3306/mydb",
        })
      );
    });

    it("should configure pool with explicit options", async () => {
      const mysql = await import("mysql2/promise");

      const adapter = createMySqlAdapter({
        host: "localhost",
        port: 3306,
        database: "testdb",
        user: "testuser",
        password: "testpass",
      });

      await adapter.connect();

      expect(mysql.default.createPool).toHaveBeenCalledWith(
        expect.objectContaining({
          host: "localhost",
          port: 3306,
          database: "testdb",
          user: "testuser",
          password: "testpass",
        })
      );
    });

    it("should configure pool settings", async () => {
      const mysql = await import("mysql2/promise");

      const adapter = createMySqlAdapter({
        url: "mysql://localhost:3306/test",
        pool: {
          max: 20,
          idleTimeoutMs: 60000,
          connectionTimeoutMs: 5000,
        },
      });

      await adapter.connect();

      expect(mysql.default.createPool).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionLimit: 20,
          idleTimeout: 60000,
          connectTimeout: 5000,
        })
      );
    });

    it("should configure SSL", async () => {
      const mysql = await import("mysql2/promise");

      const adapter = createMySqlAdapter({
        url: "mysql://localhost:3306/test",
        ssl: {
          rejectUnauthorized: true,
          ca: "ca-cert",
        },
      });

      await adapter.connect();

      expect(mysql.default.createPool).toHaveBeenCalledWith(
        expect.objectContaining({
          ssl: expect.objectContaining({
            rejectUnauthorized: true,
            ca: "ca-cert",
          }),
        })
      );
    });

    it("should configure MySQL-specific options", async () => {
      const mysql = await import("mysql2/promise");

      const adapter = createMySqlAdapter({
        url: "mysql://localhost:3306/test",
        timezone: "Z",
        charset: "utf8mb4",
      });

      await adapter.connect();

      expect(mysql.default.createPool).toHaveBeenCalledWith(
        expect.objectContaining({
          timezone: "Z",
          charset: "utf8mb4",
        })
      );
    });
  });

  // ============================================================
  // Query Execution
  // ============================================================

  describe("Query Execution", () => {
    it("should execute query successfully", async () => {
      const mockRows = [{ id: 1, name: "Test" }];
      mockPool.query.mockResolvedValueOnce([mockRows, []]);

      const adapter = createMySqlAdapter({
        url: "mysql://localhost:3306/test",
      });
      await adapter.connect();

      const result = await adapter.executeQuery("SELECT * FROM users");

      expect(result).toEqual(mockRows);
    });

    it("should execute query with parameters", async () => {
      const mockRows = [{ id: 1, name: "Test" }];
      mockPool.query.mockResolvedValueOnce([mockRows, []]);

      const adapter = createMySqlAdapter({
        url: "mysql://localhost:3306/test",
      });
      await adapter.connect();

      await adapter.executeQuery("SELECT * FROM users WHERE id = ?", [1]);

      expect(mockPool.query).toHaveBeenCalledWith(
        "SELECT * FROM users WHERE id = ?",
        [1]
      );
    });

    it("should throw error when not connected", async () => {
      const adapter = createMySqlAdapter({
        url: "mysql://localhost:3306/test",
      });

      await expect(adapter.executeQuery("SELECT 1")).rejects.toThrow(
        "MySqlAdapter is not connected"
      );
    });

    it("should log queries when logger configured", async () => {
      const mockRows = [{ id: 1 }];
      mockPool.query.mockResolvedValueOnce([mockRows, []]);

      const queryLogger = vi.fn();
      const adapter = createMySqlAdapter({
        url: "mysql://localhost:3306/test",
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

  describe("Error Classification", () => {
    it("should classify unique violation errors (1062)", async () => {
      const dupError = Object.assign(new Error("Duplicate entry"), {
        errno: 1062,
        code: "ER_DUP_ENTRY",
      });
      mockPool.query.mockRejectedValueOnce(dupError);

      const adapter = createMySqlAdapter({
        url: "mysql://localhost:3306/test",
      });
      await adapter.connect();

      try {
        await adapter.executeQuery("INSERT INTO users VALUES (1)");
        expect.fail("Should have thrown");
      } catch (error: unknown) {
        expect((error as { kind: string }).kind).toBe("unique_violation");
      }
    });

    it("should classify foreign key violation errors (1452)", async () => {
      const fkError = Object.assign(new Error("Foreign key constraint fails"), {
        errno: 1452,
        code: "ER_NO_REFERENCED_ROW_2",
      });
      mockPool.query.mockRejectedValueOnce(fkError);

      const adapter = createMySqlAdapter({
        url: "mysql://localhost:3306/test",
      });
      await adapter.connect();

      try {
        await adapter.executeQuery("INSERT INTO orders VALUES (1, 999)");
        expect.fail("Should have thrown");
      } catch (error: unknown) {
        expect((error as { kind: string }).kind).toBe("foreign_key_violation");
      }
    });

    it("should classify not null violation errors (1048)", async () => {
      const nullError = Object.assign(new Error("Column cannot be null"), {
        errno: 1048,
        code: "ER_BAD_NULL_ERROR",
      });
      mockPool.query.mockRejectedValueOnce(nullError);

      const adapter = createMySqlAdapter({
        url: "mysql://localhost:3306/test",
      });
      await adapter.connect();

      try {
        await adapter.executeQuery("INSERT INTO users (name) VALUES (NULL)");
        expect.fail("Should have thrown");
      } catch (error: unknown) {
        expect((error as { kind: string }).kind).toBe("not_null_violation");
      }
    });

    it("should classify deadlock errors (1213)", async () => {
      const deadlockError = Object.assign(new Error("Deadlock found"), {
        errno: 1213,
        code: "ER_LOCK_DEADLOCK",
      });
      mockPool.query.mockRejectedValueOnce(deadlockError);

      const adapter = createMySqlAdapter({
        url: "mysql://localhost:3306/test",
      });
      await adapter.connect();

      try {
        await adapter.executeQuery("UPDATE users SET status = 'active'");
        expect.fail("Should have thrown");
      } catch (error: unknown) {
        expect((error as { kind: string }).kind).toBe("deadlock");
      }
    });

    it("should classify timeout errors (1205)", async () => {
      const timeoutError = Object.assign(new Error("Lock wait timeout"), {
        errno: 1205,
        code: "ER_LOCK_WAIT_TIMEOUT",
      });
      mockPool.query.mockRejectedValueOnce(timeoutError);

      const adapter = createMySqlAdapter({
        url: "mysql://localhost:3306/test",
      });
      await adapter.connect();

      try {
        await adapter.executeQuery("UPDATE users SET status = 'active'");
        expect.fail("Should have thrown");
      } catch (error: unknown) {
        expect((error as { kind: string }).kind).toBe("timeout");
      }
    });

    it("should classify connection errors (1045)", async () => {
      const connError = Object.assign(new Error("Access denied"), {
        errno: 1045,
        code: "ER_ACCESS_DENIED_ERROR",
      });
      mockPool.getConnection.mockRejectedValueOnce(connError);

      const adapter = createMySqlAdapter({
        url: "mysql://localhost:3306/test",
      });

      try {
        await adapter.connect();
        expect.fail("Should have thrown");
      } catch (error: unknown) {
        expect((error as { kind: string }).kind).toBe("connection");
      }
    });

    it("should classify unknown errors as unknown", async () => {
      const unknownError = Object.assign(new Error("Some error"), {
        errno: 99999,
      });
      mockPool.query.mockRejectedValueOnce(unknownError);

      const adapter = createMySqlAdapter({
        url: "mysql://localhost:3306/test",
      });
      await adapter.connect();

      try {
        await adapter.executeQuery("SELECT 1");
        expect.fail("Should have thrown");
      } catch (error: unknown) {
        expect((error as { kind: string }).kind).toBe("unknown");
      }
    });
  });

  // ============================================================
  // Transactions
  // ============================================================

  describe("Transactions", () => {
    it("should execute successful transaction", async () => {
      const adapter = createMySqlAdapter({
        url: "mysql://localhost:3306/test",
      });
      await adapter.connect();

      const result = await adapter.transaction(async () => {
        return "success";
      });

      expect(result).toBe("success");
      // Check that START TRANSACTION was called
      expect(mockConnection.query).toHaveBeenCalledWith("START TRANSACTION");
      // Check that COMMIT was called
      expect(mockConnection.query).toHaveBeenCalledWith("COMMIT");
    });

    it("should rollback on transaction error", async () => {
      const adapter = createMySqlAdapter({
        url: "mysql://localhost:3306/test",
      });
      await adapter.connect();

      await expect(
        adapter.transaction(async () => {
          throw new Error("Transaction failed");
        })
      ).rejects.toThrow();

      expect(mockConnection.query).toHaveBeenCalledWith("ROLLBACK");
    });

    it("should set isolation level when specified", async () => {
      const adapter = createMySqlAdapter({
        url: "mysql://localhost:3306/test",
      });
      await adapter.connect();

      await adapter.transaction(async () => "done", {
        isolationLevel: "serializable",
      });

      expect(mockConnection.query).toHaveBeenCalledWith(
        "SET TRANSACTION ISOLATION LEVEL SERIALIZABLE"
      );
    });

    it("should set read-only mode when specified", async () => {
      const adapter = createMySqlAdapter({
        url: "mysql://localhost:3306/test",
      });
      await adapter.connect();

      await adapter.transaction(async () => "done", { readOnly: true });

      expect(mockConnection.query).toHaveBeenCalledWith(
        "SET TRANSACTION READ ONLY"
      );
    });

    it("should set lock wait timeout when specified", async () => {
      const adapter = createMySqlAdapter({
        url: "mysql://localhost:3306/test",
      });
      await adapter.connect();

      await adapter.transaction(async () => "done", { timeoutMs: 5000 });

      expect(mockConnection.query).toHaveBeenCalledWith(
        "SET SESSION innodb_lock_wait_timeout = 5"
      );
    });
  });

  // ============================================================
  // Transaction Retry Logic
  // ============================================================

  describe("Transaction Retry Logic", () => {
    it("should retry on deadlock error", async () => {
      const deadlockError = Object.assign(new Error("Deadlock"), {
        errno: 1213,
      });

      const adapter = createMySqlAdapter({
        url: "mysql://localhost:3306/test",
      });
      await adapter.connect();

      let attempts = 0;
      const result = await adapter.transaction(
        async () => {
          attempts++;
          if (attempts === 1) {
            throw deadlockError;
          }
          return "success";
        },
        { retryCount: 3, retryDelayMs: 10 }
      );

      expect(result).toBe("success");
      expect(attempts).toBe(2);
    });

    it("should not retry non-deadlock errors", async () => {
      const otherError = Object.assign(new Error("Other error"), {
        errno: 1064, // Parse error
      });

      const adapter = createMySqlAdapter({
        url: "mysql://localhost:3306/test",
      });
      await adapter.connect();

      let attempts = 0;
      await expect(
        adapter.transaction(
          async () => {
            attempts++;
            throw otherError;
          },
          { retryCount: 3 }
        )
      ).rejects.toThrow();

      expect(attempts).toBe(1);
    });

    it("should respect retry limit", async () => {
      const deadlockError = Object.assign(new Error("Deadlock"), {
        errno: 1213,
      });

      const adapter = createMySqlAdapter({
        url: "mysql://localhost:3306/test",
      });
      await adapter.connect();

      let attempts = 0;
      await expect(
        adapter.transaction(
          async () => {
            attempts++;
            throw deadlockError;
          },
          { retryCount: 2, retryDelayMs: 1 }
        )
      ).rejects.toThrow();

      // Initial attempt + 2 retries = 3 total
      expect(attempts).toBe(3);
    });
  });

  // ============================================================
  // TransactionContext Methods
  // ============================================================

  describe("TransactionContext Methods", () => {
    it("should execute raw SQL in transaction", async () => {
      const mockRows = [{ id: 1 }];
      mockConnection.query.mockImplementation((sql: string) => {
        if (sql.startsWith("SELECT * FROM users")) {
          return Promise.resolve([mockRows, []]);
        }
        // Why: F17's connect() runs SELECT VERSION() AS version after the
        // smoke test. Honor it here so the version-check passes.
        if (sql.toLowerCase().includes("version()")) {
          return Promise.resolve([[{ version: "8.0.33" }], []]);
        }
        return Promise.resolve([[], []]);
      });

      const adapter = createMySqlAdapter({
        url: "mysql://localhost:3306/test",
      });
      await adapter.connect();

      await adapter.transaction(async tx => {
        const result = await tx.execute("SELECT * FROM users WHERE id = ?", [
          1,
        ]);
        expect(result).toEqual(mockRows);
      });
    });

    it("should insert record in transaction and return result", async () => {
      const insertedRow = { id: 1, name: "Test" };

      mockConnection.query.mockImplementation((sql: string) => {
        if (sql.startsWith("INSERT INTO")) {
          return Promise.resolve([{ insertId: 1, affectedRows: 1 }, []]);
        }
        if (sql.includes("WHERE id = ?")) {
          return Promise.resolve([[insertedRow], []]);
        }
        // Why: F17's connect() runs SELECT VERSION() AS version after the
        // smoke test. Honor it here so the version-check passes.
        if (sql.toLowerCase().includes("version()")) {
          return Promise.resolve([[{ version: "8.0.33" }], []]);
        }
        return Promise.resolve([[], []]);
      });

      const adapter = createMySqlAdapter({
        url: "mysql://localhost:3306/test",
      });
      await adapter.connect();

      let result: unknown;
      await adapter.transaction(async tx => {
        result = await tx.insert("users", { name: "Test" });
      });

      expect(result).toEqual(insertedRow);
    });

    // TransactionContext CRUD methods delegate to the adapter which requires
    // a TableResolver (schema registry). Since mock adapters don't have one,
    // we verify the methods exist as functions on the context object instead.
    it("should provide CRUD methods on transaction context", async () => {
      const adapter = createMySqlAdapter({
        url: "mysql://localhost:3306/test",
      });
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

    it("should not have savepoint methods", async () => {
      const adapter = createMySqlAdapter({
        url: "mysql://localhost:3306/test",
      });
      await adapter.connect();

      await adapter.transaction(async tx => {
        expect(tx.savepoint).toBeUndefined();
        expect(tx.rollbackToSavepoint).toBeUndefined();
        expect(tx.releaseSavepoint).toBeUndefined();
      });
    });
  });

  // ============================================================
  // Capabilities
  // ============================================================

  describe("Capabilities", () => {
    it("should return correct MySQL capabilities", () => {
      const adapter = createMySqlAdapter({
        url: "mysql://localhost:3306/test",
      });

      const capabilities = adapter.getCapabilities();

      expect(capabilities.dialect).toBe("mysql");
      expect(capabilities.supportsJsonb).toBe(false);
      expect(capabilities.supportsJson).toBe(true);
      expect(capabilities.supportsArrays).toBe(false);
      expect(capabilities.supportsGeneratedColumns).toBe(true);
      expect(capabilities.supportsFts).toBe(true);
      expect(capabilities.supportsIlike).toBe(false);
      expect(capabilities.supportsReturning).toBe(false);
      expect(capabilities.supportsSavepoints).toBe(false);
      expect(capabilities.supportsOnConflict).toBe(true);
      expect(capabilities.maxParamsPerQuery).toBe(65535);
      expect(capabilities.maxIdentifierLength).toBe(64);
    });
  });

  // ============================================================
  // Pool Statistics
  // ============================================================

  describe("Pool Statistics", () => {
    it("should return null when not connected", () => {
      const adapter = createMySqlAdapter({
        url: "mysql://localhost:3306/test",
      });

      expect(adapter.getPoolStats()).toBeNull();
    });

    it("should return pool stats when connected", async () => {
      const adapter = createMySqlAdapter({
        url: "mysql://localhost:3306/test",
      });
      await adapter.connect();

      const stats = adapter.getPoolStats();

      expect(stats).not.toBeNull();
      expect(stats!.total).toBe(5);
      expect(stats!.idle).toBe(3);
      expect(stats!.waiting).toBe(1);
      expect(stats!.active).toBe(2);
    });
  });

  // ============================================================
  // Logger Integration
  // ============================================================

  describe("Logger Integration", () => {
    it("should log connection events", async () => {
      const infoLogger = vi.fn();
      const adapter = createMySqlAdapter({
        url: "mysql://localhost:3306/test",
        logger: { info: infoLogger },
      });

      await adapter.connect();

      expect(infoLogger).toHaveBeenCalledWith(
        "MySQL connection established",
        expect.any(Object)
      );
    });

    it("should log disconnection events", async () => {
      const infoLogger = vi.fn();
      const adapter = createMySqlAdapter({
        url: "mysql://localhost:3306/test",
        logger: { info: infoLogger },
      });

      await adapter.connect();
      await adapter.disconnect();

      expect(infoLogger).toHaveBeenCalledWith("MySQL connection closed");
    });

    it("should log transaction commits", async () => {
      const debugLogger = vi.fn();
      const adapter = createMySqlAdapter({
        url: "mysql://localhost:3306/test",
        logger: { debug: debugLogger },
      });

      await adapter.connect();
      await adapter.transaction(async () => "done");

      expect(debugLogger).toHaveBeenCalledWith(
        "Transaction committed",
        expect.objectContaining({ attempt: 1 })
      );
    });

    it("should log retry warnings", async () => {
      const warnLogger = vi.fn();
      const deadlockError = Object.assign(new Error("Deadlock"), {
        errno: 1213,
      });

      const adapter = createMySqlAdapter({
        url: "mysql://localhost:3306/test",
        logger: { warn: warnLogger },
      });
      await adapter.connect();

      let attempts = 0;
      await adapter.transaction(
        async () => {
          attempts++;
          if (attempts === 1) {
            throw deadlockError;
          }
          return "success";
        },
        { retryCount: 1, retryDelayMs: 1 }
      );

      expect(warnLogger).toHaveBeenCalledWith(
        expect.stringContaining("deadlock"),
        expect.any(Object)
      );
    });
  });
});
