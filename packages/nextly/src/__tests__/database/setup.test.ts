/**
 * Test Database Setup - Unit Tests
 *
 * Tests the test database setup utilities to ensure they work correctly
 * across all supported database adapters.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  createTestDatabase,
  createSqliteTestDatabase,
  getTestDatabaseUrl,
  withTestDatabase,
  truncateAllTables,
  type TestDatabase,
} from "./setup";

// ============================================================
// getTestDatabaseUrl Tests
// ============================================================

describe("getTestDatabaseUrl", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment variables
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should return default SQLite in-memory URL", () => {
    delete process.env.TEST_SQLITE_URL;
    const url = getTestDatabaseUrl("sqlite");
    expect(url).toBe(":memory:");
  });

  it("should return SQLite URL from environment variable", () => {
    process.env.TEST_SQLITE_URL = "file:./test.db";
    const url = getTestDatabaseUrl("sqlite");
    expect(url).toBe("file:./test.db");
  });

  it("should return default PostgreSQL URL", () => {
    delete process.env.TEST_POSTGRES_URL;
    delete process.env.TEST_DATABASE_URL;
    const url = getTestDatabaseUrl("postgresql");
    expect(url).toBe("postgres://postgres:postgres@localhost:5432/nextly_test");
  });

  it("should return PostgreSQL URL from TEST_POSTGRES_URL", () => {
    process.env.TEST_POSTGRES_URL = "postgres://custom:5432/test";
    const url = getTestDatabaseUrl("postgresql");
    expect(url).toBe("postgres://custom:5432/test");
  });

  it("should return PostgreSQL URL from TEST_DATABASE_URL as fallback", () => {
    delete process.env.TEST_POSTGRES_URL;
    process.env.TEST_DATABASE_URL = "postgres://fallback:5432/test";
    const url = getTestDatabaseUrl("postgresql");
    expect(url).toBe("postgres://fallback:5432/test");
  });

  it("should return default MySQL URL", () => {
    delete process.env.TEST_MYSQL_URL;
    const url = getTestDatabaseUrl("mysql");
    expect(url).toBe("mysql://root:root@localhost:3306/nextly_test");
  });

  it("should return MySQL URL from environment variable", () => {
    process.env.TEST_MYSQL_URL = "mysql://custom:3306/test";
    const url = getTestDatabaseUrl("mysql");
    expect(url).toBe("mysql://custom:3306/test");
  });

  it("should throw for unknown adapter type", () => {
    expect(() => getTestDatabaseUrl("unknown" as any)).toThrow(
      "Unknown adapter type: unknown"
    );
  });
});

// ============================================================
// createTestDatabase Tests (SQLite only - no external DB needed)
// ============================================================

describe("createTestDatabase", () => {
  let testDb: TestDatabase | null = null;

  afterEach(async () => {
    // Clean up test database if created
    if (testDb) {
      await testDb.cleanup();
      testDb = null;
    }
  });

  it("should create SQLite in-memory database by default", async () => {
    testDb = await createTestDatabase();

    expect(testDb).toBeDefined();
    expect(testDb.adapter).toBeDefined();
    expect(testDb.type).toBe("sqlite");
    expect(testDb.cleanup).toBeInstanceOf(Function);
  });

  it("should create database with schema", async () => {
    testDb = await createTestDatabase({ createSchema: true });

    // Verify we can query a table that should exist
    const capabilities = testDb.adapter.getCapabilities();
    expect(capabilities.dialect).toBe("sqlite");

    // Try to select from users table (should exist from schema)
    const users = await testDb.adapter.select("users", {});
    expect(users).toBeDefined();
    expect(Array.isArray(users)).toBe(true);
  });

  it("should create database without schema when requested", async () => {
    testDb = await createTestDatabase({ createSchema: false });

    // Database should be created but tables should not exist
    expect(testDb.adapter).toBeDefined();

    // Querying a table should fail since schema wasn't created
    await expect(testDb.adapter.select("users", {})).rejects.toThrow();
  });

  it("should cleanup properly", async () => {
    testDb = await createTestDatabase();
    const adapter = testDb.adapter;

    // Verify adapter is connected
    expect(adapter.isConnected()).toBe(true);

    // Run cleanup
    await testDb.cleanup();
    testDb = null; // Prevent double cleanup in afterEach

    // Verify adapter is disconnected
    expect(adapter.isConnected()).toBe(false);
  });
});

// ============================================================
// createSqliteTestDatabase Tests
// ============================================================

describe("createSqliteTestDatabase", () => {
  it("should create SQLite test database", async () => {
    const testDb = await createSqliteTestDatabase();

    try {
      expect(testDb.type).toBe("sqlite");
      expect(testDb.adapter.getCapabilities().dialect).toBe("sqlite");
    } finally {
      await testDb.cleanup();
    }
  });
});

// ============================================================
// withTestDatabase Tests
// ============================================================

describe("withTestDatabase", () => {
  it("should create database, run test, and cleanup", async () => {
    let adapterRef: any = null;

    await withTestDatabase({ type: "sqlite" }, async testDb => {
      adapterRef = testDb.adapter;
      expect(testDb.adapter.isConnected()).toBe(true);

      // Perform some operation
      const users = await testDb.adapter.select("users", {});
      expect(users).toHaveLength(0);
    });

    // After withTestDatabase, adapter should be disconnected
    expect(adapterRef.isConnected()).toBe(false);
  });

  it("should cleanup even if test throws", async () => {
    let adapterRef: any = null;

    await expect(
      withTestDatabase({ type: "sqlite" }, async testDb => {
        adapterRef = testDb.adapter;
        throw new Error("Test error");
      })
    ).rejects.toThrow("Test error");

    // Adapter should still be disconnected
    expect(adapterRef.isConnected()).toBe(false);
  });

  it("should return test function result", async () => {
    const result = await withTestDatabase({ type: "sqlite" }, async () => {
      return { success: true, value: 42 };
    });

    expect(result).toEqual({ success: true, value: 42 });
  });
});

// ============================================================
// truncateAllTables Tests
// ============================================================

describe("truncateAllTables", () => {
  it("should truncate all tables in SQLite", async () => {
    const testDb = await createTestDatabase();

    try {
      // Insert some test data
      await testDb.adapter.insert("users", {
        id: "test-user-1",
        email: "test@example.com",
        password_hash: "test-hash-123",
      });

      // Verify data exists
      let users = await testDb.adapter.select("users", {});
      expect(users.length).toBeGreaterThan(0);

      // Truncate all tables
      await truncateAllTables(testDb.adapter, testDb.type);

      // Verify data is gone
      users = await testDb.adapter.select("users", {});
      expect(users).toHaveLength(0);
    } finally {
      await testDb.cleanup();
    }
  });
});

// ============================================================
// Integration Pattern Tests
// ============================================================

describe("Integration Pattern", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase();
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("should support typical beforeEach/afterEach pattern", async () => {
    // This test verifies the recommended usage pattern works
    expect(testDb.adapter).toBeDefined();
    expect(testDb.adapter.isConnected()).toBe(true);

    // Can perform database operations
    const result = await testDb.adapter.insert(
      "users",
      {
        id: "pattern-test-user",
        email: "pattern@test.com",
        password_hash: "test-hash-456",
      },
      { returning: "*" }
    );

    expect(result).toBeDefined();
  });

  it("should have isolated database state", async () => {
    // Data from previous test should not exist (fresh in-memory DB)
    const users = await testDb.adapter.select("users", {});
    expect(users).toHaveLength(0);
  });
});
