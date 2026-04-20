/**
 * Test Database Setup Utilities
 *
 * Provides utilities for setting up and tearing down test databases
 * across all supported database adapters (PostgreSQL, MySQL, SQLite).
 *
 * Key Features:
 * - SQLite in-memory by default for fast CI tests
 * - Environment variable-based URLs for external databases
 * - Raw DDL from unified schema (faster than migrations)
 * - Adaptive cleanup (SQLite auto-cleans, others drop tables first)
 *
 * @example
 * ```typescript
 * import { createTestDatabase, type TestDatabase } from "../database/setup";
 *
 * describe("MyService", () => {
 *   let testDb: TestDatabase;
 *
 *   beforeAll(async () => {
 *     testDb = await createTestDatabase(); // Defaults to SQLite in-memory
 *   });
 *
 *   afterAll(async () => {
 *     await testDb.cleanup();
 *   });
 *
 *   it("should do something", async () => {
 *     const result = await testDb.adapter.select("users", {});
 *     expect(result).toBeDefined();
 *   });
 * });
 * ```
 *
 * @packageDocumentation
 */

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
import type { SupportedDialect } from "@revnixhq/adapter-drizzle/types";

import { createAdapter, type AdapterType } from "../../database/factory";
import {
  generateSchemaForDialect,
  generateDropSchemaForDialect,
  nextlyTables,
} from "../../database/schema";

// ============================================================
// Types
// ============================================================

/**
 * Test database instance with adapter and cleanup utilities.
 *
 * @public
 */
export interface TestDatabase {
  /**
   * The connected database adapter instance.
   * Use this to perform database operations in tests.
   */
  adapter: DrizzleAdapter;

  /**
   * The database dialect type.
   */
  type: AdapterType;

  /**
   * Clean up the test database.
   *
   * For SQLite in-memory: Just disconnects (DB is destroyed automatically)
   * For PostgreSQL/MySQL: Drops all tables, then disconnects
   *
   * Always call this in `afterAll` or `afterEach` to prevent resource leaks.
   */
  cleanup: () => Promise<void>;
}

/**
 * Options for creating a test database.
 *
 * @public
 */
export interface CreateTestDatabaseOptions {
  /**
   * Database adapter type.
   * Defaults to "sqlite" for fast in-memory testing.
   */
  type?: AdapterType;

  /**
   * Custom database URL.
   * If not provided, uses environment variables or defaults.
   */
  url?: string;

  /**
   * Whether to create the schema (tables).
   * Defaults to true.
   */
  createSchema?: boolean;

  /**
   * Suppress console warnings during schema creation.
   * Defaults to true (silent for tests).
   */
  silent?: boolean;
}

// ============================================================
// Environment Variables
// ============================================================

/**
 * Get the test database URL for a given adapter type.
 *
 * Priority:
 * 1. Explicit URL parameter
 * 2. Environment variable (TEST_POSTGRES_URL, TEST_MYSQL_URL)
 * 3. Default values
 *
 * @param type - The adapter type
 * @returns The database URL to use for tests
 *
 * @internal
 */
export function getTestDatabaseUrl(type: AdapterType): string {
  switch (type) {
    case "postgresql":
      return (
        process.env.TEST_POSTGRES_URL ??
        process.env.TEST_DATABASE_URL ??
        "postgres://postgres:postgres@localhost:5432/nextly_test"
      );

    case "mysql":
      return (
        process.env.TEST_MYSQL_URL ??
        "mysql://root:root@localhost:3306/nextly_test"
      );

    case "sqlite":
      // In-memory SQLite for fastest tests
      // Using `:memory:` creates a fresh DB that's destroyed on disconnect
      return process.env.TEST_SQLITE_URL ?? ":memory:";

    default:
      throw new Error(`Unknown adapter type: ${type}`);
  }
}

// ============================================================
// Schema Setup
// ============================================================

/**
 * Map AdapterType to SupportedDialect.
 * AdapterType uses "postgresql" while SupportedDialect uses "postgresql".
 *
 * @internal
 */
function toDialect(type: AdapterType): SupportedDialect {
  // They happen to match, but this provides a clear mapping point
  return type as SupportedDialect;
}

/**
 * Create the database schema using DDL generated from unified schema.
 *
 * @param adapter - The connected adapter
 * @param type - The adapter type (for dialect-specific DDL)
 * @param silent - Whether to suppress warnings
 *
 * @internal
 */
async function createSchema(
  adapter: DrizzleAdapter,
  type: AdapterType,
  silent: boolean
): Promise<void> {
  const dialect = toDialect(type);

  // Temporarily suppress console.warn if silent mode
  const originalWarn = console.warn;
  if (silent) {
    console.warn = () => {};
  }

  try {
    // Generate all CREATE TABLE and CREATE INDEX statements
    const schema = generateSchemaForDialect(nextlyTables, dialect, {
      ifNotExists: true,
    });

    // Execute each statement
    for (const sql of schema.all) {
      await adapter.executeQuery(sql);
    }
  } finally {
    // Restore console.warn
    if (silent) {
      console.warn = originalWarn;
    }
  }
}

/**
 * Drop all tables from the database.
 *
 * @param adapter - The connected adapter
 * @param type - The adapter type
 *
 * @internal
 */
async function dropAllTables(
  adapter: DrizzleAdapter,
  type: AdapterType
): Promise<void> {
  const dialect = toDialect(type);

  // Generate DROP TABLE statements (in reverse order for FK dependencies)
  const dropStatements = generateDropSchemaForDialect(nextlyTables, dialect, {
    ifExists: true,
    cascade: true,
  });

  // Execute each DROP statement
  for (const sql of dropStatements) {
    try {
      await adapter.executeQuery(sql);
    } catch {
      // Ignore errors (table might not exist)
    }
  }
}

// ============================================================
// Main Factory Function
// ============================================================

/**
 * Create a test database instance.
 *
 * Creates a database adapter, optionally sets up the schema, and returns
 * a TestDatabase instance with cleanup utilities.
 *
 * @param options - Configuration options
 * @returns A TestDatabase instance ready for testing
 *
 * @example
 * ```typescript
 * // SQLite in-memory (default, fastest)
 * const testDb = await createTestDatabase();
 *
 * // PostgreSQL for integration tests
 * const testDb = await createTestDatabase({ type: "postgresql" });
 *
 * // MySQL with custom URL
 * const testDb = await createTestDatabase({
 *   type: "mysql",
 *   url: "mysql://user:pass@localhost:3306/test"
 * });
 *
 * // Without schema (for testing schema creation itself)
 * const testDb = await createTestDatabase({ createSchema: false });
 * ```
 *
 * @public
 */
export async function createTestDatabase(
  options: CreateTestDatabaseOptions = {}
): Promise<TestDatabase> {
  const {
    type = "sqlite", // Default to SQLite in-memory for fastest tests
    url,
    createSchema: shouldCreateSchema = true,
    silent = true,
  } = options;

  // Get the database URL
  const databaseUrl = url ?? getTestDatabaseUrl(type);

  // Create and connect the adapter
  const adapter = await createAdapter({
    type,
    url: databaseUrl,
  });

  // Create schema if requested
  if (shouldCreateSchema) {
    await createSchema(adapter, type, silent);
  }

  // Create cleanup function with adaptive behavior
  const cleanup = async (): Promise<void> => {
    try {
      // For SQLite in-memory, just disconnect - DB is destroyed automatically
      // For PostgreSQL/MySQL, drop tables first to clean up
      if (type !== "sqlite" || !databaseUrl.includes(":memory:")) {
        await dropAllTables(adapter, type);
      }
    } finally {
      // Always disconnect the adapter
      await adapter.disconnect();
    }
  };

  return {
    adapter,
    type,
    cleanup,
  };
}

// ============================================================
// Convenience Functions
// ============================================================

/**
 * Create a SQLite in-memory test database.
 *
 * This is the fastest option for unit tests. The database is automatically
 * destroyed when disconnected.
 *
 * @param options - Additional options (createSchema, silent)
 * @returns A TestDatabase instance with SQLite in-memory adapter
 *
 * @example
 * ```typescript
 * const testDb = await createSqliteTestDatabase();
 * ```
 *
 * @public
 */
export async function createSqliteTestDatabase(
  options: Omit<CreateTestDatabaseOptions, "type"> = {}
): Promise<TestDatabase> {
  return createTestDatabase({ ...options, type: "sqlite" });
}

/**
 * Create a PostgreSQL test database.
 *
 * Requires either TEST_POSTGRES_URL environment variable or a running
 * PostgreSQL server at the default location.
 *
 * @param options - Additional options (url, createSchema, silent)
 * @returns A TestDatabase instance with PostgreSQL adapter
 *
 * @example
 * ```typescript
 * // Using environment variable
 * // TEST_POSTGRES_URL=postgres://user:pass@localhost:5432/test
 * const testDb = await createPostgresTestDatabase();
 *
 * // Using explicit URL
 * const testDb = await createPostgresTestDatabase({
 *   url: "postgres://localhost:5432/mytest"
 * });
 * ```
 *
 * @public
 */
export async function createPostgresTestDatabase(
  options: Omit<CreateTestDatabaseOptions, "type"> = {}
): Promise<TestDatabase> {
  return createTestDatabase({ ...options, type: "postgresql" });
}

/**
 * Create a MySQL test database.
 *
 * Requires either TEST_MYSQL_URL environment variable or a running
 * MySQL server at the default location.
 *
 * @param options - Additional options (url, createSchema, silent)
 * @returns A TestDatabase instance with MySQL adapter
 *
 * @example
 * ```typescript
 * // Using environment variable
 * // TEST_MYSQL_URL=mysql://root:pass@localhost:3306/test
 * const testDb = await createMySqlTestDatabase();
 * ```
 *
 * @public
 */
export async function createMySqlTestDatabase(
  options: Omit<CreateTestDatabaseOptions, "type"> = {}
): Promise<TestDatabase> {
  return createTestDatabase({ ...options, type: "mysql" });
}

// ============================================================
// Test Helpers
// ============================================================

/**
 * Helper to run a test function with a fresh test database.
 *
 * Automatically creates the database before the test and cleans up after.
 * Useful for one-off tests that need isolated database state.
 *
 * @param options - Test database options
 * @param testFn - The test function to run
 *
 * @example
 * ```typescript
 * await withTestDatabase({ type: "sqlite" }, async (testDb) => {
 *   const users = await testDb.adapter.select("users", {});
 *   expect(users).toHaveLength(0);
 * });
 * ```
 *
 * @public
 */
export async function withTestDatabase<T>(
  options: CreateTestDatabaseOptions,
  testFn: (testDb: TestDatabase) => Promise<T>
): Promise<T> {
  const testDb = await createTestDatabase(options);
  try {
    return await testFn(testDb);
  } finally {
    await testDb.cleanup();
  }
}

/**
 * Helper to truncate all tables in a test database.
 *
 * Faster than dropping and recreating tables. Useful for resetting
 * database state between tests in the same test file.
 *
 * @param adapter - The database adapter
 * @param type - The adapter type
 *
 * @example
 * ```typescript
 * beforeEach(async () => {
 *   await truncateAllTables(testDb.adapter, testDb.type);
 * });
 * ```
 *
 * @public
 */
export async function truncateAllTables(
  adapter: DrizzleAdapter,
  type: AdapterType
): Promise<void> {
  const dialect = toDialect(type);

  // Get table names from unified schema (in reverse order for FK dependencies)
  const tableNames = [...nextlyTables].reverse().map(t => t.name);

  // Build TRUNCATE/DELETE statements based on dialect
  for (const tableName of tableNames) {
    try {
      if (dialect === "sqlite") {
        // SQLite doesn't support TRUNCATE, use DELETE
        await adapter.executeQuery(`DELETE FROM "${tableName}"`);
      } else if (dialect === "mysql") {
        // MySQL TRUNCATE (faster than DELETE, resets auto-increment)
        await adapter.executeQuery(`TRUNCATE TABLE \`${tableName}\``);
      } else {
        // PostgreSQL TRUNCATE with CASCADE
        await adapter.executeQuery(
          `TRUNCATE TABLE "${tableName}" RESTART IDENTITY CASCADE`
        );
      }
    } catch {
      // Ignore errors (table might not exist or have FK constraints)
    }
  }
}
