/**
 * @nextly/adapter-mysql - Test Suite
 *
 * Comprehensive tests for MySQL adapter functionality.
 */

import { defineRelations } from "drizzle-orm";
import { int, mysqlTable } from "drizzle-orm/mysql-core";
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
  destroy: vi.fn(),
  // The callback connection the mysql2/promise wrapper exposes, which is what
  // Drizzle's mysql2 driver binds to (and whose `config` it writes to).
  connection: { config: {} },
};

// The connection `withSession` opens for itself, outside the pool
const mockSessionConnection = {
  query: vi.fn(),
  destroy: vi.fn(),
};

// Mock pool with internal structure
const mockPool = {
  getConnection: vi.fn().mockResolvedValue(mockConnection),
  query: vi.fn(),
  end: vi.fn().mockResolvedValue(undefined),
  // The callback pool under the promise wrapper, as mysql2 gives it: the
  // adapter bounds the wait in its `getConnection`, reads its queues, and
  // pins the session time zone through its `connection` event.
  pool: {
    _allConnections: { length: 5 },
    _freeConnections: { length: 3 },
    _connectionQueue: { length: 1 },
    // The callback pool Drizzle's mysql2 driver binds to, whose `config` it writes to.
    config: {},
    getConnection: vi.fn(),
    once: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
  },
};

// Mock mysql2/promise module
vi.mock("mysql2/promise", () => ({
  default: {
    createPool: vi.fn(() => mockPool),
    createConnection: vi.fn(async () => mockSessionConnection),
  },
  createPool: vi.fn(() => mockPool),
  createConnection: vi.fn(async () => mockSessionConnection),
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
    mockSessionConnection.query.mockImplementation(() =>
      Promise.resolve([[], []])
    );
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

  describe("getDrizzle()", () => {
    it("hands its handles on the pool one $client, with relations or without", async () => {
      // Each handle is given a view of the pool that reports its queries; made once per pool, so
      // a caller holding both handles still sees one client, as it did when each held the pool.
      const adapter = createMySqlAdapter({
        url: "mysql://localhost:3306/test",
      });
      await adapter.connect();
      const notes = mysqlTable("notes", { id: int("id").primaryKey() });
      type Handle = { $client: unknown };

      const bare = adapter.getDrizzle<Handle>();
      const relational = adapter.getDrizzle<Handle>(defineRelations({ notes }));

      expect(relational).not.toBe(bare);
      expect(relational.$client).toBe(bare.$client);
    });
  });

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

    it("pins the session time zone when each pooled connection opens", async () => {
      const adapter = createMySqlAdapter({
        url: "mysql://localhost:3306/test",
      });

      await adapter.connect();

      // The pin rides mysql2's `connection` event on the callback pool, which
      // the promise wrapper does not re-emit — reached, like the queue the
      // pool wait bounds, through `pool.pool`.
      expect(mockPool.pool.on).toHaveBeenCalledWith(
        "connection",
        expect.any(Function)
      );
      const pin = mockPool.pool.on.mock.calls.find(
        ([event]) => event === "connection"
      )![1];

      const query = vi.fn((_sql: string, cb: (error: Error | null) => void) =>
        cb(null)
      );
      const destroy = vi.fn();
      pin({ query, destroy });
      expect(query).toHaveBeenCalledWith(
        "SET SESSION time_zone = '+00:00'",
        expect.any(Function)
      );
      // A pinned session goes back to the pool untouched.
      expect(destroy).not.toHaveBeenCalled();

      // A session the pin could not reach must never be pooled: whatever
      // zone it answers in would serve shifted values.
      const failing = vi.fn((_sql: string, cb: (error: Error | null) => void) =>
        cb(new Error("gone"))
      );
      pin({ query: failing, destroy });
      expect(destroy).toHaveBeenCalled();
    });

    it("aligns a non-UTC driver zone to the pinned UTC session", async () => {
      const mysql = await import("mysql2/promise");
      const warn = vi.fn();

      const adapter = createMySqlAdapter({
        url: "mysql://localhost:3306/test",
        timezone: "+05:30",
        logger: { warn },
      });

      await adapter.connect();

      // The session is pinned to UTC; a driver parsing in +05:30 beside it
      // would shift every value a round-trip fails to cancel. Aligned, not
      // refused, and the caller is told the shift they configured is gone.
      expect(mysql.default.createPool).toHaveBeenCalledWith(
        expect.objectContaining({ timezone: "Z" })
      );
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("+05:30"));
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

    it("puts the session's lock wait timeout back before the connection returns to the pool", async () => {
      // MySQL has no transaction-scoped form of this setting, so the value set
      // for one transaction would otherwise stay on the pooled connection for
      // every later query handed it.
      const answer = mockConnection.query.getMockImplementation();
      mockConnection.query.mockImplementation((statement: string) =>
        statement.startsWith("SELECT @@SESSION.innodb_lock_wait_timeout")
          ? Promise.resolve([[{ timeout: 50 }], []])
          : answer?.(statement)
      );
      const adapter = createMySqlAdapter({
        url: "mysql://localhost:3306/test",
      });
      await adapter.connect();

      for (const work of [
        async () => "done",
        async () => {
          throw new Error("refused");
        },
      ]) {
        mockConnection.query.mockClear();
        mockConnection.release.mockClear();
        await adapter.transaction(work, { timeoutMs: 5000 }).catch(() => {});

        const statements = mockConnection.query.mock.calls.map(
          call => call[0] as string
        );
        const restore = statements.indexOf(
          "SET SESSION innodb_lock_wait_timeout = 50"
        );
        const ended = Math.max(
          statements.indexOf("COMMIT"),
          statements.indexOf("ROLLBACK")
        );
        expect(ended).toBeGreaterThanOrEqual(0);
        expect(restore).toBeGreaterThan(ended);
        expect(mockConnection.release).toHaveBeenCalledTimes(1);
      }
    });

    it("puts back the lock wait timeout when strict-mode setup fails after it was set", async () => {
      // Each session change is recorded as it lands: a failure part way through the setup must
      // still restore what had already been changed, or the connection is pooled carrying it.
      const answer = mockConnection.query.getMockImplementation();
      mockConnection.query.mockImplementation((statement: string) =>
        statement.startsWith("SELECT @@SESSION.innodb_lock_wait_timeout")
          ? Promise.resolve([[{ timeout: 50 }], []])
          : statement.startsWith("SELECT @@SESSION.sql_mode")
            ? Promise.reject(new Error("lost the read"))
            : answer?.(statement)
      );
      const adapter = createMySqlAdapter({
        url: "mysql://localhost:3306/test",
      });
      await adapter.connect();
      mockConnection.query.mockClear();
      mockConnection.release.mockClear();
      mockConnection.destroy.mockClear();

      // The setup must reach the strict-mode read and fail on it: a transaction that ignored the
      // option would commit, and restoring the timeout alone would prove nothing about this path.
      await expect(
        adapter.transaction(async () => "done", {
          timeoutMs: 5000,
          strictSqlMode: true,
        })
      ).rejects.toThrow(/lost the read/);

      const statements = mockConnection.query.mock.calls.map(
        call => call[0] as string
      );
      expect(statements).toContain("SELECT @@SESSION.sql_mode AS mode");
      expect(statements).not.toContain("COMMIT");
      expect(statements).toContain("SET SESSION innodb_lock_wait_timeout = 50");
      expect(mockConnection.release).toHaveBeenCalledTimes(1);
      mockConnection.query.mockImplementation(answer);
    });

    it("destroys a connection whose ROLLBACK failed instead of pooling it", async () => {
      // A connection the ROLLBACK did not reach may still be inside the
      // transaction; pooled, it would put the next request's statements in it.
      const answer = mockConnection.query.getMockImplementation();
      mockConnection.query.mockImplementation((statement: string) =>
        statement === "ROLLBACK"
          ? Promise.reject(new Error("connection lost"))
          : answer?.(statement)
      );
      const adapter = createMySqlAdapter({
        url: "mysql://localhost:3306/test",
      });
      await adapter.connect();
      // Connecting borrows and returns a connection of its own.
      mockConnection.release.mockClear();

      await expect(
        adapter.transaction(async () => {
          throw new Error("refused");
        })
      ).rejects.toThrow();

      expect(mockConnection.destroy).toHaveBeenCalledTimes(1);
      expect(mockConnection.release).not.toHaveBeenCalled();
    });

    it("returns a rolled-back connection to the pool for reuse", async () => {
      const adapter = createMySqlAdapter({
        url: "mysql://localhost:3306/test",
      });
      await adapter.connect();
      // Connecting borrows and returns a connection of its own.
      mockConnection.release.mockClear();

      await expect(
        adapter.transaction(async () => {
          throw new Error("refused");
        })
      ).rejects.toThrow();

      expect(mockConnection.release).toHaveBeenCalledTimes(1);
      expect(mockConnection.destroy).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // Sessions outside a transaction
  // ============================================================

  describe("withSession", () => {
    it("puts a transaction's mode back when the strict SET fails after reaching the server", async () => {
      // A SET the server applied but whose reply was lost leaves the connection strict; the
      // mode read before it must still be put back, or the pool hands strict mode to later work.
      const answer = mockConnection.query.getMockImplementation();
      mockConnection.query.mockImplementation((statement: string) => {
        if (statement === "SELECT @@SESSION.sql_mode AS mode") {
          return Promise.resolve([[{ mode: "" }], []]);
        }
        // A server answers this read; on, as most servers start sessions.
        if (statement === "SELECT @@SESSION.autocommit AS autocommit") {
          return Promise.resolve([[{ autocommit: 1 }], []]);
        }
        if (statement.startsWith("SET SESSION sql_mode = TRIM")) {
          return Promise.reject(new Error("connection lost"));
        }
        return answer?.(statement);
      });
      const adapter = createMySqlAdapter({
        url: "mysql://localhost:3306/test",
      });
      await adapter.connect();
      mockConnection.release.mockClear();
      mockConnection.destroy.mockClear();

      await expect(
        adapter.transaction(async () => undefined, { strictSqlMode: true })
      ).rejects.toThrow();

      const restores = mockConnection.query.mock.calls.filter(
        ([statement]) => statement === "SET SESSION sql_mode = ?"
      );
      expect(restores).toEqual([["SET SESSION sql_mode = ?", [""]]]);
      expect(mockConnection.release).toHaveBeenCalledTimes(1);
      expect(mockConnection.destroy).not.toHaveBeenCalled();
      mockConnection.query.mockImplementation(answer);
    });

    it("is refused inside an open transaction, taking no connection", async () => {
      const mysql = await import("mysql2/promise");
      const adapter = createMySqlAdapter({
        url: "mysql://localhost:3306/test",
      });
      await adapter.connect();
      await expect(
        adapter.transaction(async () => {
          mockPool.getConnection.mockClear();
          await adapter.withSession(async () => undefined);
        })
      ).rejects.toMatchObject({ code: "NEXTLY_SESSION_INSIDE_TRANSACTION" });
      expect(mockPool.getConnection).not.toHaveBeenCalled();
      expect(mysql.default.createConnection).not.toHaveBeenCalled();
    });

    it("opens a connection of its own with the pool's connection settings, never a pooled one", async () => {
      const mysql = await import("mysql2/promise");
      // A pooled connection can hold a transaction an earlier caller left open on a server whose
      // sessions start with autocommit off; turning autocommit on there would commit it.
      const adapter = createMySqlAdapter({
        url: "mysql://localhost:3306/test",
        pool: { connectionTimeoutMs: 1234 },
      });
      await adapter.connect();
      mockPool.getConnection.mockClear();

      await adapter.withSession(async session => {
        await session.execute("SELECT 1");
      });

      expect(mockPool.getConnection).not.toHaveBeenCalled();
      expect(mysql.default.createConnection).toHaveBeenCalledTimes(1);
      const [config] = vi.mocked(mysql.default.createConnection).mock
        .calls[0] as unknown as [Record<string, unknown>];
      expect(config).toMatchObject({
        uri: "mysql://localhost:3306/test",
        connectTimeout: 1234,
        multipleStatements: false,
      });
      expect(config).not.toHaveProperty("connectionLimit");
      expect(config).not.toHaveProperty("waitForConnections");
    });

    it("turns autocommit on before its statements, and closes the connection afterwards", async () => {
      // With autocommit off, as some servers start sessions, a statement waits for a COMMIT
      // nobody sends.
      const adapter = createMySqlAdapter({
        url: "mysql://localhost:3306/test",
      });
      await adapter.connect();

      await adapter.withSession(async session => {
        await session.execute("INSERT INTO t (v) VALUES (1)");
      });

      const statements = mockSessionConnection.query.mock.calls.map(
        ([statement]) => statement as string
      );
      const on = statements.indexOf("SET SESSION autocommit = 1");
      const insert = statements.indexOf("INSERT INTO t (v) VALUES (1)");
      expect(on).toBeGreaterThanOrEqual(0);
      expect(insert).toBeGreaterThan(on);
      expect(mockSessionConnection.destroy).toHaveBeenCalledTimes(1);
    });

    it("is waited for by disconnect, which closes the pool only once the session has ended", async () => {
      const adapter = createMySqlAdapter({
        url: "mysql://localhost:3306/test",
      });
      await adapter.connect();
      let release: () => void = () => {};
      const gate = new Promise<void>(resolve => {
        release = resolve;
      });
      const session = adapter.withSession(async s => {
        await gate;
        await s.execute("INSERT INTO t (v) VALUES (1)");
      });

      let closed = false;
      const closing = adapter.disconnect().then(() => {
        closed = true;
      });
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(closed).toBe(false);
      expect(mockPool.end).not.toHaveBeenCalled();

      release();
      await session;
      await closing;
      expect(mockSessionConnection.destroy).toHaveBeenCalledTimes(1);
      expect(mockPool.end).toHaveBeenCalledTimes(1);
    });

    it("is refused once disconnect has begun", async () => {
      const adapter = createMySqlAdapter({
        url: "mysql://localhost:3306/test",
      });
      await adapter.connect();
      const closing = adapter.disconnect();
      await expect(adapter.withSession(async () => undefined)).rejects.toThrow(
        /not connected/
      );
      await closing;
    });

    it("closes the connection when its work throws", async () => {
      const adapter = createMySqlAdapter({
        url: "mysql://localhost:3306/test",
      });
      await adapter.connect();

      await expect(
        adapter.withSession(async () => {
          throw new Error("work failed");
        })
      ).rejects.toThrow("work failed");
      expect(mockSessionConnection.destroy).toHaveBeenCalledTimes(1);
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

    // `ctx.db.transaction` hands a plugin's `query` reads this handle. The
    // transaction's `getDrizzle()` has no relations, so its `query` namespace is
    // empty; the adapter's pooled `getDrizzle(relations)` would read outside the
    // transaction.
    it("getDrizzle and drizzleWithRelations run on the transaction's connection, each memoized", async () => {
      const adapter = createMySqlAdapter({
        url: "mysql://localhost:3306/test",
      });
      await adapter.connect();
      const notes = mysqlTable("notes", { id: int("id").primaryKey() });
      const first = defineRelations({ notes });
      const second = defineRelations({ notes });
      type Handle = { query: Record<string, unknown>; $client: unknown };

      await adapter.transaction(async tx => {
        const bare = tx.getDrizzle<Handle>();
        const relational = tx.drizzleWithRelations<Handle>(first);

        expect(relational.query.notes).toBeDefined();
        expect(bare.query?.notes).toBeUndefined();
        // The transaction's own connection, which the bare instance is bound to too.
        expect(relational.$client).toBe(mockConnection.connection);
        expect(relational.$client).toBe(bare.$client);

        expect(tx.drizzleWithRelations(first)).toBe(relational);
        expect(tx.drizzleWithRelations(second)).not.toBe(relational);
        // The bare instance the delegated CRUD uses is unchanged.
        expect(tx.getDrizzle()).toBe(bare);
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
      // Not known before connect: the server's version decides it.
      expect(capabilities.sharedRowLock).toBeUndefined();
    });

    it.each([
      ["8.0.33", true],
      ["8.0.32-PlanetScale-Vitess-v18.0.0", true],
      ["11.4.13-MariaDB-ubu2404", false],
      ["8.0.11-TiDB-v8.5.1", false],
    ])(
      "reports whether %s accepts FOR SHARE once connected",
      async (version, accepted) => {
        mockConnection.query.mockImplementation((sql: string) =>
          Promise.resolve(
            sql.toLowerCase().includes("version()")
              ? [[{ version }], []]
              : [[], []]
          )
        );
        const adapter = createMySqlAdapter({
          url: "mysql://localhost:3306/test",
        });

        await adapter.connect();

        expect(adapter.getCapabilities().sharedRowLock).toBe(accepted);
      }
    );
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
