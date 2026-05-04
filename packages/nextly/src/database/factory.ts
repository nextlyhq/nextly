/**
 * @fileoverview Database adapter factory with environment-based selection
 *
 * This module provides factory functions for creating database adapters based on
 * environment configuration. It supports PostgreSQL, MySQL, and SQLite with
 * automatic adapter selection via DB_DIALECT environment variable or DATABASE_URL
 * protocol detection.
 *
 * Key features:
 * - Tree-shakeable: Only bundles the adapter you use (via dynamic imports)
 * - Environment-first: Auto-detects from DB_DIALECT or DATABASE_URL
 * - Type-safe: Full TypeScript support with adapter capabilities
 * - Zero-config: Works with just environment variables
 *
 * @example
 * ```typescript
 * // Auto-detect from environment
 * const adapter = await createAdapterFromEnv();
 *
 * // Explicit configuration
 * const adapter = await createAdapter({
 *   type: 'postgresql',
 *   url: 'postgres://localhost:5432/mydb',
 * });
 * ```
 *
 * @module database/factory
 */

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
import type { BaseAdapterConfig } from "@revnixhq/adapter-drizzle/types";

import { env } from "../lib/env";

/**
 * Supported database adapter types
 *
 * @public
 */
export type AdapterType = "postgresql" | "mysql" | "sqlite";

/**
 * Configuration for creating a database adapter
 *
 * Extends BaseAdapterConfig with an optional type field for explicit
 * adapter selection. If type is not specified, the factory will detect
 * it from environment variables.
 *
 * @public
 */
export interface AdapterConfig extends BaseAdapterConfig {
  /**
   * Database adapter type
   *
   * If not specified, will be detected from DB_DIALECT environment variable
   * or DATABASE_URL protocol.
   */
  type?: AdapterType;
}

/**
 * Create a database adapter based on configuration
 *
 * This is the main factory function that creates and connects the appropriate
 * database adapter. If type is not specified in config, it will be detected
 * from environment variables.
 *
 * Dynamic imports are used to enable tree-shaking - only the adapter you use
 * will be bundled in production.
 *
 * @param config - Optional adapter configuration. If omitted, uses environment variables.
 * @returns Connected DrizzleAdapter instance
 * @throws {Error} If DATABASE_URL is missing for PostgreSQL/MySQL
 * @throws {Error} If unsupported database type is specified
 *
 * @example
 * ```typescript
 * // Auto-detect from environment
 * const adapter = await createAdapter();
 *
 * // Explicit PostgreSQL
 * const adapter = await createAdapter({
 *   type: 'postgresql',
 *   url: 'postgres://localhost:5432/mydb',
 * });
 *
 * // SQLite with custom path
 * const adapter = await createAdapter({
 *   type: 'sqlite',
 *   url: 'file:./data/production.db',
 * });
 * ```
 *
 * @public
 */
export async function createAdapter(
  config?: AdapterConfig
): Promise<DrizzleAdapter> {
  // Determine adapter type from config or environment
  const type = config?.type ?? detectAdapterType();
  const url = config?.url ?? env.DATABASE_URL;

  // Validate DATABASE_URL requirement (SQLite can use default path)
  if (!url && type !== "sqlite") {
    throw new Error(
      "DATABASE_URL environment variable is required for PostgreSQL and MySQL"
    );
  }

  // Merge configuration with defaults
  const adapterConfig = { ...config, url };

  // Resolve the adapter module specifier based on the selected type.
  // IMPORTANT: We use a variable for the import() specifier so that bundlers
  // (especially Turbopack) cannot statically analyze which adapter packages
  // are needed. This prevents "Module not found" errors for adapters that
  // aren't installed. Only the selected adapter is loaded at runtime.
  let moduleId: string;
  if (type === "postgresql") {
    moduleId = "@revnixhq/adapter-postgres";
  } else if (type === "mysql") {
    moduleId = "@revnixhq/adapter-mysql";
  } else if (type === "sqlite") {
    moduleId = "@revnixhq/adapter-sqlite";
  } else {
    throw new Error(`Unsupported database type: ${type as string}`);
  }

  let mod: Record<string, (...args: unknown[]) => unknown>;
  try {
    // Dynamic import with a variable prevents Turbopack/webpack from
    // statically resolving all adapter packages at compile time.
    mod = (await import(moduleId)) as Record<
      string,
      (...args: unknown[]) => unknown
    >;
  } catch (error) {
    const pkg =
      type === "postgresql"
        ? "@revnixhq/adapter-postgres"
        : type === "mysql"
          ? "@revnixhq/adapter-mysql"
          : "@revnixhq/adapter-sqlite";
    throw new Error(
      `Failed to load database adapter for "${type}". ` +
        `Make sure ${pkg} is installed:\n\n` +
        `  npm install ${pkg}\n\n` +
        `Original error: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (type === "sqlite") {
    const sqliteConfig = {
      ...adapterConfig,
      url: url ?? "file:./data/nextly.db",
    };
    const adapter = mod.createSqliteAdapter(
      sqliteConfig
    ) as unknown as DrizzleAdapter & { connect: () => Promise<void> };
    await adapter.connect();
    return adapter;
  }

  const createFn =
    type === "postgresql" ? mod.createPostgresAdapter : mod.createMySqlAdapter;
  const adapter = createFn(adapterConfig) as unknown as DrizzleAdapter & {
    connect: () => Promise<void>;
  };
  await adapter.connect();
  return adapter;
}

/**
 * Create adapter from environment variables only
 *
 * Convenience wrapper that creates an adapter using only environment
 * configuration. Equivalent to calling createAdapter() with no arguments.
 *
 * @returns Connected DrizzleAdapter instance
 * @throws {Error} If environment configuration is invalid
 *
 * @example
 * ```typescript
 * // In your .env file:
 * // DB_DIALECT=postgres
 * // DATABASE_URL=postgres://localhost:5432/mydb
 *
 * const adapter = await createAdapterFromEnv();
 * ```
 *
 * @public
 */
export async function createAdapterFromEnv(): Promise<DrizzleAdapter> {
  return createAdapter();
}

/**
 * Detect adapter type from environment variables
 *
 * Detection priority:
 * 1. DB_DIALECT environment variable (explicit setting)
 * 2. DATABASE_URL protocol (postgres://, mysql://, file:)
 * 3. Default to PostgreSQL with warning
 *
 * @returns Detected adapter type
 * @throws {Error} If DB_DIALECT is set to an unknown value
 *
 * @internal
 */
function detectAdapterType(): AdapterType {
  // Priority 1: Check DB_DIALECT env var (explicit)
  const dialect = env.DB_DIALECT;
  if (dialect) {
    switch (dialect) {
      case "postgresql":
        return "postgresql";
      case "mysql":
        return "mysql";
      case "sqlite":
        return "sqlite";
      default:
        // TypeScript should prevent this, but include runtime check
        throw new Error(
          `Unknown DB_DIALECT: ${dialect}. Must be "postgresql", "mysql", or "sqlite"`
        );
    }
  }

  // Priority 2: Fallback - detect from DATABASE_URL protocol
  const url = env.DATABASE_URL;
  if (url) {
    // PostgreSQL URLs
    if (url.startsWith("postgres://") || url.startsWith("postgresql://")) {
      return "postgresql";
    }
    // MySQL URLs
    if (url.startsWith("mysql://")) {
      return "mysql";
    }
    // SQLite file URLs or file extensions
    if (
      url.startsWith("file:") ||
      url.endsWith(".db") ||
      url.endsWith(".sqlite")
    ) {
      return "sqlite";
    }
  }

  // Priority 3: Default to PostgreSQL with warning
  console.warn(
    "⚠️  No DB_DIALECT or DATABASE_URL specified, defaulting to PostgreSQL. " +
      "Set DB_DIALECT environment variable to avoid this warning."
  );
  return "postgresql";
}

/**
 * Validate database environment configuration
 *
 * Checks that environment variables are properly configured before
 * attempting to create an adapter. This allows catching configuration
 * errors early in the application startup.
 *
 * @returns Validation result with errors if any
 *
 * @example
 * ```typescript
 * const validation = validateDatabaseEnv();
 * if (!validation.valid) {
 *   console.error('Database configuration errors:');
 *   validation.errors.forEach(err => console.error(`  - ${err}`));
 *   process.exit(1);
 * }
 * ```
 *
 * @public
 */
export function validateDatabaseEnv(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const dialect = env.DB_DIALECT;
  const url = env.DATABASE_URL;

  // Check that at least one configuration method is provided
  if (!dialect && !url) {
    errors.push(
      "Either DB_DIALECT or DATABASE_URL must be set. " +
        "Set DB_DIALECT to 'postgresql', 'mysql', or 'sqlite'."
    );
  }

  // Validate DB_DIALECT value if provided
  if (dialect && !["postgresql", "mysql", "sqlite"].includes(dialect)) {
    errors.push(
      `Invalid DB_DIALECT: "${dialect}". Must be "postgresql", "mysql", or "sqlite".`
    );
  }

  // DATABASE_URL is required for PostgreSQL and MySQL (SQLite can use default)
  if (dialect && dialect !== "sqlite" && !url) {
    errors.push(
      `DATABASE_URL is required for ${dialect}. ` +
        "Please set DATABASE_URL environment variable with your connection string."
    );
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Health check for database adapter
 *
 * Tests database connectivity and returns health status with connection
 * statistics. This function connects to the database if not already connected,
 * executes a simple test query, and reports the results.
 *
 * @param adapter - Database adapter to check
 * @returns Health check result with connection status and statistics
 *
 * @example
 * ```typescript
 * const adapter = await createAdapterFromEnv();
 * const health = await checkAdapterHealth(adapter);
 *
 * if (health.healthy) {
 *   console.log(`Database ${health.dialect} is healthy`);
 *   console.log('Pool stats:', health.poolStats);
 * } else {
 *   console.error(`Database error: ${health.error}`);
 * }
 * ```
 *
 * @public
 */
export async function checkAdapterHealth(adapter: DrizzleAdapter): Promise<{
  healthy: boolean;
  dialect: string;
  connected: boolean;
  error?: string;
  poolStats?: {
    total: number;
    idle: number;
    waiting: number;
    active: number;
  } | null;
}> {
  try {
    const connected = adapter.isConnected();

    // Connect if not already connected
    if (!connected) {
      await adapter.connect();
    }

    // Execute simple connectivity test query
    // All SQL databases support SELECT 1
    const capabilities = adapter.getCapabilities();
    await adapter.executeQuery("SELECT 1 as test");

    // Get pool statistics (null for SQLite which doesn't have pooling)
    const poolStats = adapter.getPoolStats();

    return {
      healthy: true,
      dialect: capabilities.dialect,
      connected: adapter.isConnected(),
      poolStats,
    };
  } catch (error) {
    return {
      healthy: false,
      dialect: adapter.getCapabilities().dialect,
      connected: adapter.isConnected(),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Deprecated functions (createDatabaseAdapter, createDatabaseAdapterFromEnv,
// DatabaseConfig) have been removed. Use createAdapter() and createAdapterFromEnv()
// from this module instead.
