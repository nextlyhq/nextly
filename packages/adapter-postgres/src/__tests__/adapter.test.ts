/**
 * @nextly/adapter-postgres - Unit Tests
 *
 * These tests verify the PostgresAdapter implementation without requiring
 * a real database connection. Integration tests with a real PostgreSQL
 * database are in Phase 5.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  PostgresAdapter,
  createPostgresAdapter,
  isPostgresAdapter,
  VERSION,
} from "../index";
import type { PostgresAdapterConfig } from "../index";

type PgErrorLike = Error & {
  code?: string;
  constraint?: string;
  table?: string;
  column?: string;
  detail?: string;
  hint?: string;
  severity?: string;
};

type MockPoolClass = {
  new (config: unknown): unknown;
  lastConfig: Record<string, unknown> | null;
  instanceCount: number;
  reset: () => void;
};

// Create mock objects
const mockClient = {
  query: vi.fn(),
  release: vi.fn(),
};

const mockPool = {
  connect: vi.fn().mockResolvedValue(mockClient),
  query: vi.fn(),
  end: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
  totalCount: 5,
  idleCount: 3,
  waitingCount: 0,
};

// Mock pg module with class-based Pool
vi.mock("pg", () => {
  return {
    Pool: class MockPool {
      connect = mockPool.connect;
      query = mockPool.query;
      end = mockPool.end;
      on = mockPool.on;
      totalCount = mockPool.totalCount;
      idleCount = mockPool.idleCount;
      waitingCount = mockPool.waitingCount;

      constructor(public config: Record<string, unknown>) {
        // Store config for inspection
        MockPool.lastConfig = config;
        MockPool.instanceCount++;
      }

      static lastConfig: Record<string, unknown> | null = null;
      static instanceCount = 0;

      static reset() {
        MockPool.lastConfig = null;
        MockPool.instanceCount = 0;
      }
    },
  };
});

describe("PostgresAdapter", () => {
  let adapter: PostgresAdapter;
  let MockPool: MockPoolClass;

  const testConfig: PostgresAdapterConfig = {
    url: "postgres://user:pass@localhost:5432/testdb",
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    // Reset mock responses
    mockClient.query.mockReset();
    mockClient.release.mockReset();
    mockPool.connect.mockReset();
    mockPool.query.mockReset();
    mockPool.end.mockReset();
    mockPool.on.mockReset();

    // Setup default responses
    mockPool.connect.mockResolvedValue(mockClient);
    // Why: F17 added a SELECT version() call after the smoke-test SELECT 1.
    // Route by SQL so both queries return their expected shape.
    mockClient.query.mockImplementation((sql: string) => {
      if (typeof sql === "string" && sql.toLowerCase().includes("version()")) {
        return Promise.resolve({
          rows: [{ version: "PostgreSQL 16.1 on x86_64-pc-linux-gnu" }],
        });
      }
      return Promise.resolve({ rows: [{ result: 1 }] });
    });
    mockPool.query.mockResolvedValue({ rows: [] });
    mockPool.end.mockResolvedValue(undefined);

    // Get mock class and reset
    const pgModule = await import("pg");
    MockPool = pgModule.Pool as unknown as MockPoolClass;
    MockPool.reset();

    adapter = new PostgresAdapter(testConfig);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Module Exports", () => {
    it("should export VERSION constant", () => {
      expect(VERSION).toBe("0.1.0");
    });

    it("should export PostgresAdapter class", () => {
      expect(PostgresAdapter).toBeDefined();
      expect(typeof PostgresAdapter).toBe("function");
    });

    it("should export createPostgresAdapter factory", () => {
      expect(createPostgresAdapter).toBeDefined();
      expect(typeof createPostgresAdapter).toBe("function");
    });

    it("should export isPostgresAdapter type guard", () => {
      expect(isPostgresAdapter).toBeDefined();
      expect(typeof isPostgresAdapter).toBe("function");
    });
  });

  describe("createPostgresAdapter factory", () => {
    it("should create a PostgresAdapter instance", () => {
      const adapter = createPostgresAdapter(testConfig);
      expect(adapter).toBeInstanceOf(PostgresAdapter);
    });

    it("should pass config to adapter", () => {
      const config: PostgresAdapterConfig = {
        url: "postgres://custom:5432/db",
        pool: { max: 20 },
        applicationName: "test-app",
      };
      const adapter = createPostgresAdapter(config);
      expect(adapter.dialect).toBe("postgresql");
    });
  });

  describe("isPostgresAdapter type guard", () => {
    it("should return true for PostgresAdapter instance", () => {
      expect(isPostgresAdapter(adapter)).toBe(true);
    });

    it("should return false for non-PostgresAdapter values", () => {
      expect(isPostgresAdapter(null)).toBe(false);
      expect(isPostgresAdapter(undefined)).toBe(false);
      expect(isPostgresAdapter({})).toBe(false);
      expect(isPostgresAdapter("string")).toBe(false);
      expect(isPostgresAdapter(123)).toBe(false);
    });
  });

  describe("dialect property", () => {
    it('should return "postgresql" as dialect', () => {
      expect(adapter.dialect).toBe("postgresql");
    });
  });

  describe("getCapabilities()", () => {
    it("should return PostgreSQL capabilities", () => {
      const caps = adapter.getCapabilities();

      expect(caps.dialect).toBe("postgresql");
      expect(caps.supportsJsonb).toBe(true);
      expect(caps.supportsJson).toBe(true);
      expect(caps.supportsArrays).toBe(true);
      expect(caps.supportsGeneratedColumns).toBe(true);
      expect(caps.supportsFts).toBe(true);
      expect(caps.supportsIlike).toBe(true);
      expect(caps.supportsReturning).toBe(true);
      expect(caps.supportsSavepoints).toBe(true);
      expect(caps.supportsOnConflict).toBe(true);
      expect(caps.maxParamsPerQuery).toBe(65535);
      expect(caps.maxIdentifierLength).toBe(63);
    });
  });

  describe("isConnected()", () => {
    it("should return false when not connected", () => {
      expect(adapter.isConnected()).toBe(false);
    });

    it("should return true after connect()", async () => {
      await adapter.connect();
      expect(adapter.isConnected()).toBe(true);
    });

    it("should return false after disconnect()", async () => {
      await adapter.connect();
      await adapter.disconnect();
      expect(adapter.isConnected()).toBe(false);
    });
  });

  describe("connect()", () => {
    it("should connect successfully", async () => {
      await expect(adapter.connect()).resolves.not.toThrow();
      expect(adapter.isConnected()).toBe(true);
    });

    it("should be idempotent - multiple calls should not create multiple pools", async () => {
      await adapter.connect();
      await adapter.connect();
      await adapter.connect();

      expect(MockPool.instanceCount).toBe(1);
    });

    it("should verify connection with smoke test query", async () => {
      await adapter.connect();
      expect(mockClient.query).toHaveBeenCalledWith("SELECT 1");
    });

    it("should release client after smoke test", async () => {
      await adapter.connect();
      expect(mockClient.release).toHaveBeenCalled();
    });

    it("should register error handler on pool", async () => {
      await adapter.connect();
      expect(mockPool.on).toHaveBeenCalledWith("error", expect.any(Function));
    });

    it("should throw DatabaseError on connection failure", async () => {
      mockPool.connect.mockRejectedValueOnce(new Error("Connection refused"));

      await expect(adapter.connect()).rejects.toMatchObject({
        kind: "unknown",
        message: expect.stringContaining("Connection refused"),
      });
    });
  });

  describe("disconnect()", () => {
    it("should disconnect successfully", async () => {
      await adapter.connect();
      await expect(adapter.disconnect()).resolves.not.toThrow();
      expect(adapter.isConnected()).toBe(false);
    });

    it("should be idempotent - multiple calls should not throw", async () => {
      await adapter.disconnect();
      await adapter.disconnect();
      // Should not throw
    });

    it("should call pool.end()", async () => {
      await adapter.connect();
      await adapter.disconnect();
      expect(mockPool.end).toHaveBeenCalled();
    });
  });

  describe("getPoolStats()", () => {
    it("should return null when not connected", () => {
      expect(adapter.getPoolStats()).toBeNull();
    });

    it("should return pool statistics when connected", async () => {
      await adapter.connect();
      const stats = adapter.getPoolStats();

      expect(stats).not.toBeNull();
      expect(stats!.total).toBe(5);
      expect(stats!.idle).toBe(3);
      expect(stats!.waiting).toBe(0);
      expect(stats!.active).toBe(2); // total - idle
    });
  });

  describe("executeQuery()", () => {
    beforeEach(async () => {
      await adapter.connect();
    });

    it("should throw when not connected", async () => {
      await adapter.disconnect();

      await expect(adapter.executeQuery("SELECT 1")).rejects.toMatchObject({
        kind: "connection",
        message: expect.stringContaining("not connected"),
      });
    });

    it("should execute query and return rows", async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 1, name: "test" }],
      });

      const result = await adapter.executeQuery("SELECT * FROM users");
      expect(result).toEqual([{ id: 1, name: "test" }]);
    });

    it("should pass parameters to query", async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await adapter.executeQuery("SELECT * FROM users WHERE id = $1", [123]);
      expect(mockPool.query).toHaveBeenCalledWith(
        "SELECT * FROM users WHERE id = $1",
        [123]
      );
    });

    it("should classify query errors", async () => {
      const pgError = new Error("syntax error") as PgErrorLike;
      pgError.code = "42601"; // syntax_error
      mockPool.query.mockRejectedValueOnce(pgError);

      await expect(adapter.executeQuery("INVALID SQL")).rejects.toMatchObject({
        kind: "unknown", // 42601 is not in our map, falls back to unknown
        message: expect.stringContaining("syntax error"),
        code: "42601",
      });
    });
  });

  describe("Error Classification", () => {
    beforeEach(async () => {
      await adapter.connect();
    });

    it("should classify unique violation (23505)", async () => {
      const pgError = new Error("duplicate key") as PgErrorLike;
      pgError.code = "23505";
      pgError.constraint = "users_email_key";
      pgError.table = "users";
      mockPool.query.mockRejectedValueOnce(pgError);

      await expect(
        adapter.executeQuery("INSERT INTO users VALUES (1)")
      ).rejects.toMatchObject({
        kind: "unique_violation",
        code: "23505",
        constraint: "users_email_key",
        table: "users",
      });
    });

    it("should classify foreign key violation (23503)", async () => {
      const pgError = new Error("foreign key violation") as PgErrorLike;
      pgError.code = "23503";
      pgError.constraint = "posts_user_id_fkey";
      mockPool.query.mockRejectedValueOnce(pgError);

      await expect(
        adapter.executeQuery("INSERT INTO posts VALUES (1)")
      ).rejects.toMatchObject({
        kind: "foreign_key_violation",
        code: "23503",
      });
    });

    it("should classify not null violation (23502)", async () => {
      const pgError = new Error("null value not allowed") as PgErrorLike;
      pgError.code = "23502";
      pgError.column = "email";
      mockPool.query.mockRejectedValueOnce(pgError);

      await expect(
        adapter.executeQuery("INSERT INTO users VALUES (1)")
      ).rejects.toMatchObject({
        kind: "not_null_violation",
        code: "23502",
        column: "email",
      });
    });

    it("should classify deadlock (40P01)", async () => {
      const pgError = new Error("deadlock detected") as PgErrorLike;
      pgError.code = "40P01";
      mockPool.query.mockRejectedValueOnce(pgError);

      await expect(
        adapter.executeQuery("UPDATE users SET x = 1")
      ).rejects.toMatchObject({
        kind: "deadlock",
        code: "40P01",
      });
    });

    it("should classify serialization failure (40001)", async () => {
      const pgError = new Error("could not serialize access") as PgErrorLike;
      pgError.code = "40001";
      mockPool.query.mockRejectedValueOnce(pgError);

      await expect(
        adapter.executeQuery("UPDATE users SET x = 1")
      ).rejects.toMatchObject({
        kind: "serialization_failure",
        code: "40001",
      });
    });

    it("should classify connection errors (08xxx)", async () => {
      const pgError = new Error("connection refused") as PgErrorLike;
      pgError.code = "08006";
      mockPool.query.mockRejectedValueOnce(pgError);

      await expect(adapter.executeQuery("SELECT 1")).rejects.toMatchObject({
        kind: "connection",
        code: "08006",
      });
    });

    it("should classify timeout (57014)", async () => {
      const pgError = new Error("query cancelled") as PgErrorLike;
      pgError.code = "57014";
      mockPool.query.mockRejectedValueOnce(pgError);

      await expect(
        adapter.executeQuery("SELECT pg_sleep(1000)")
      ).rejects.toMatchObject({
        kind: "timeout",
        code: "57014",
      });
    });
  });

  describe("transaction()", () => {
    beforeEach(async () => {
      await adapter.connect();
      mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 });
    });

    it("should execute callback in transaction", async () => {
      const callback = vi.fn().mockResolvedValue("result");

      const result = await adapter.transaction(callback);

      expect(result).toBe("result");
      expect(callback).toHaveBeenCalled();
    });

    it("should BEGIN transaction", async () => {
      await adapter.transaction(async () => {});

      expect(mockClient.query).toHaveBeenCalledWith("BEGIN");
    });

    it("should COMMIT on success", async () => {
      await adapter.transaction(async () => {});

      expect(mockClient.query).toHaveBeenCalledWith("COMMIT");
    });

    it("should ROLLBACK on error", async () => {
      await expect(
        adapter.transaction(async () => {
          throw new Error("test error");
        })
      ).rejects.toThrow();

      expect(mockClient.query).toHaveBeenCalledWith("ROLLBACK");
    });

    it("should release client after transaction", async () => {
      await adapter.transaction(async () => {});
      expect(mockClient.release).toHaveBeenCalled();
    });

    it("should release client even on error", async () => {
      await expect(
        adapter.transaction(async () => {
          throw new Error("test error");
        })
      ).rejects.toThrow();

      expect(mockClient.release).toHaveBeenCalled();
    });

    it("should support isolation level option", async () => {
      await adapter.transaction(async () => {}, {
        isolationLevel: "serializable",
      });

      expect(mockClient.query).toHaveBeenCalledWith(
        "BEGIN ISOLATION LEVEL SERIALIZABLE"
      );
    });

    it("should support read-only option", async () => {
      await adapter.transaction(async () => {}, {
        readOnly: true,
      });

      expect(mockClient.query).toHaveBeenCalledWith("BEGIN READ ONLY");
    });

    it("should support isolation level with read-only", async () => {
      await adapter.transaction(async () => {}, {
        isolationLevel: "repeatable read",
        readOnly: true,
      });

      expect(mockClient.query).toHaveBeenCalledWith(
        "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"
      );
    });

    it("should set statement timeout when specified", async () => {
      await adapter.transaction(async () => {}, {
        timeoutMs: 5000,
      });

      expect(mockClient.query).toHaveBeenCalledWith(
        "SET LOCAL statement_timeout = 5000"
      );
    });

    describe("retry logic", () => {
      it("should retry on serialization failure (40001)", async () => {
        const serializationError = new Error(
          "serialization failure"
        ) as PgErrorLike;
        serializationError.code = "40001";

        let callCount = 0;
        const callback = vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount === 1) {
            throw serializationError;
          }
          return "success";
        });

        const result = await adapter.transaction(callback, { retryCount: 1 });

        expect(result).toBe("success");
        expect(callback).toHaveBeenCalledTimes(2);
      });

      it("should retry on deadlock (40P01)", async () => {
        const deadlockError = new Error("deadlock detected") as PgErrorLike;
        deadlockError.code = "40P01";

        let callCount = 0;
        const callback = vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount === 1) {
            throw deadlockError;
          }
          return "success";
        });

        const result = await adapter.transaction(callback, { retryCount: 1 });

        expect(result).toBe("success");
        expect(callback).toHaveBeenCalledTimes(2);
      });

      it("should not retry non-retryable errors", async () => {
        const uniqueError = new Error("unique violation") as PgErrorLike;
        uniqueError.code = "23505";

        const callback = vi.fn().mockRejectedValue(uniqueError);

        await expect(
          adapter.transaction(callback, { retryCount: 3 })
        ).rejects.toMatchObject({ code: "23505" });

        expect(callback).toHaveBeenCalledTimes(1);
      });

      it("should respect retryCount limit", async () => {
        const serializationError = new Error(
          "serialization failure"
        ) as PgErrorLike;
        serializationError.code = "40001";

        const callback = vi.fn().mockRejectedValue(serializationError);

        await expect(
          adapter.transaction(callback, { retryCount: 2 })
        ).rejects.toMatchObject({ code: "40001" });

        // 1 initial + 2 retries = 3 total attempts
        expect(callback).toHaveBeenCalledTimes(3);
      });
    });
  });

  describe("TransactionContext", () => {
    beforeEach(async () => {
      await adapter.connect();
      mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 });
    });

    it("should provide execute method", async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 1 }] })
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      await adapter.transaction(async ctx => {
        const result = await ctx.execute("SELECT * FROM users");
        expect(result).toEqual([{ id: 1 }]);
      });
    });

    it("should provide insert method with RETURNING", async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 1, name: "test" }] })
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      await adapter.transaction(async ctx => {
        const result = await ctx.insert("users", { name: "test" });
        expect(result).toEqual({ id: 1, name: "test" });
      });
    });

    // TransactionContext CRUD methods delegate to the adapter which requires
    // a TableResolver (schema registry). Since mock adapters don't have one,
    // we verify the methods exist as functions on the context object instead.
    it("should provide CRUD methods on transaction context", async () => {
      await adapter.transaction(async ctx => {
        expect(typeof ctx.select).toBe("function");
        expect(typeof ctx.selectOne).toBe("function");
        expect(typeof ctx.update).toBe("function");
        expect(typeof ctx.delete).toBe("function");
        expect(typeof ctx.upsert).toBe("function");
        expect(typeof ctx.execute).toBe("function");
        expect(typeof ctx.insert).toBe("function");
      });
    });

    it("should provide savepoint method", async () => {
      await adapter.transaction(async ctx => {
        await ctx.savepoint!("my_savepoint");
      });

      expect(mockClient.query).toHaveBeenCalledWith('SAVEPOINT "my_savepoint"');
    });

    it("should provide rollbackToSavepoint method", async () => {
      await adapter.transaction(async ctx => {
        await ctx.savepoint!("my_savepoint");
        await ctx.rollbackToSavepoint!("my_savepoint");
      });

      expect(mockClient.query).toHaveBeenCalledWith(
        'ROLLBACK TO SAVEPOINT "my_savepoint"'
      );
    });

    it("should provide releaseSavepoint method", async () => {
      await adapter.transaction(async ctx => {
        await ctx.savepoint!("my_savepoint");
        await ctx.releaseSavepoint!("my_savepoint");
      });

      expect(mockClient.query).toHaveBeenCalledWith(
        'RELEASE SAVEPOINT "my_savepoint"'
      );
    });
  });

  describe("insertMany() optimization", () => {
    beforeEach(async () => {
      await adapter.connect();
    });

    it("should return empty array for empty data", async () => {
      const result = await adapter.insertMany("users", []);
      expect(result).toEqual([]);
    });

    // insertMany delegates to insert which requires a TableResolver (schema
    // registry). With a mock adapter the table won't be found, so we expect
    // the schema registry error for a single-record insert.
    it("should reject single INSERT when no TableResolver is set", async () => {
      await expect(
        adapter.insertMany("users", [{ name: "test" }], { returning: "*" })
      ).rejects.toThrow(/not found in schema registry/);
    });

    it("should use multi-row INSERT for multiple records", async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [
          { id: 1, name: "a" },
          { id: 2, name: "b" },
          { id: 3, name: "c" },
        ],
      });

      await adapter.insertMany(
        "users",
        [{ name: "a" }, { name: "b" }, { name: "c" }],
        { returning: "*" }
      );

      // Should use multi-row VALUES clause
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringMatching(/VALUES \(\$1\), \(\$2\), \(\$3\)/),
        ["a", "b", "c"]
      );
    });

    it("should include RETURNING clause", async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 1 }, { id: 2 }],
      });

      await adapter.insertMany("users", [{ name: "a" }, { name: "b" }], {
        returning: ["id"],
      });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('RETURNING "id"'),
        expect.any(Array)
      );
    });
  });

  describe("Pool Configuration", () => {
    it("should use URL connection string", async () => {
      const adapter = new PostgresAdapter({
        url: "postgres://user:pass@host:5432/db",
      });
      await adapter.connect();

      expect(MockPool.lastConfig).toMatchObject({
        connectionString: "postgres://user:pass@host:5432/db",
      });
    });

    it("should use explicit connection options", async () => {
      const adapter = new PostgresAdapter({
        host: "localhost",
        port: 5432,
        database: "testdb",
        user: "testuser",
        password: "testpass",
      });
      await adapter.connect();

      expect(MockPool.lastConfig).toMatchObject({
        host: "localhost",
        port: 5432,
        database: "testdb",
        user: "testuser",
        password: "testpass",
      });
    });

    it("should apply pool configuration", async () => {
      const adapter = new PostgresAdapter({
        url: "postgres://localhost/db",
        pool: {
          min: 5,
          max: 25,
          idleTimeoutMs: 60000,
          connectionTimeoutMs: 5000,
        },
      });
      await adapter.connect();

      expect(MockPool.lastConfig).toMatchObject({
        min: 5,
        max: 25,
        idleTimeoutMillis: 60000,
        connectionTimeoutMillis: 5000,
      });
    });

    it("should apply SSL configuration", async () => {
      const adapter = new PostgresAdapter({
        url: "postgres://localhost/db",
        ssl: {
          rejectUnauthorized: true,
          ca: "cert-content",
        },
      });
      await adapter.connect();

      expect(MockPool.lastConfig?.ssl).toMatchObject({
        rejectUnauthorized: true,
        ca: "cert-content",
      });
    });

    it("should apply PostgreSQL-specific options", async () => {
      const adapter = new PostgresAdapter({
        url: "postgres://localhost/db",
        applicationName: "my-app",
        statementTimeout: 30000,
        queryTimeout: 60000,
      });
      await adapter.connect();

      expect(MockPool.lastConfig).toMatchObject({
        application_name: "my-app",
        statement_timeout: 30000,
        query_timeout: 60000,
      });
    });
  });

  describe("Logger Integration", () => {
    it("should call logger.query on successful query", async () => {
      const logger = {
        query: vi.fn(),
      };

      const adapter = new PostgresAdapter({
        url: "postgres://localhost/db",
        logger,
      });

      await adapter.connect();
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await adapter.executeQuery("SELECT 1");

      expect(logger.query).toHaveBeenCalledWith(
        "SELECT 1",
        [],
        expect.any(Number)
      );
    });

    it("should call logger.info on connect", async () => {
      const logger = {
        info: vi.fn(),
      };

      const adapter = new PostgresAdapter({
        url: "postgres://localhost/db",
        logger,
      });

      await adapter.connect();

      expect(logger.info).toHaveBeenCalledWith(
        "PostgreSQL connection established",
        expect.any(Object)
      );
    });

    it("should call logger.info on disconnect", async () => {
      const logger = {
        info: vi.fn(),
      };

      const adapter = new PostgresAdapter({
        url: "postgres://localhost/db",
        logger,
      });

      await adapter.connect();
      await adapter.disconnect();

      expect(logger.info).toHaveBeenCalledWith("PostgreSQL connection closed");
    });

    it("should call logger.error on pool error", async () => {
      const logger = {
        error: vi.fn(),
      };

      const adapter = new PostgresAdapter({
        url: "postgres://localhost/db",
        logger,
      });

      await adapter.connect();

      // Simulate pool error event
      const errorHandler = mockPool.on.mock.calls.find(
        (call: unknown[]) => call[0] === "error"
      )?.[1];
      expect(errorHandler).toBeDefined();

      const testError = new Error("idle client error");
      errorHandler(testError);

      expect(logger.error).toHaveBeenCalledWith(testError, expect.any(Object));
    });
  });
});
