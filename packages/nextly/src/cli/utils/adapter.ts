/**
 * CLI Database Adapter Utilities
 *
 * Helper functions for creating and managing database adapters
 * in CLI commands.
 *
 * @module cli/utils/adapter
 * @since 1.0.0
 */

import type { Logger } from "./logger";

/**
 * Supported database dialects
 */
export type SupportedDialect = "postgresql" | "mysql" | "sqlite";

/**
 * Options for creating a database adapter
 */
export interface CreateAdapterOptions {
  /**
   * Database dialect (postgresql, mysql, sqlite)
   * If not provided, will be detected from DATABASE_URL or DB_DIALECT env var
   */
  dialect?: SupportedDialect;

  /**
   * Database connection URL
   * If not provided, will use DATABASE_URL env var
   */
  databaseUrl?: string;

  /**
   * Logger instance for output
   */
  logger?: Logger;
}

/**
 * Result of database environment validation
 */
export interface DatabaseEnvValidation {
  /** Whether the environment is valid */
  valid: boolean;
  /** Error messages if invalid */
  errors: string[];
  /** Detected dialect */
  dialect?: SupportedDialect;
  /** Database URL */
  databaseUrl?: string;
}

/**
 * Detect database dialect from connection URL
 *
 * @param url - Database connection URL
 * @returns Detected dialect or undefined
 */
export function detectDialectFromUrl(
  url: string
): SupportedDialect | undefined {
  if (url.startsWith("postgresql://") || url.startsWith("postgres://")) {
    return "postgresql";
  }
  if (url.startsWith("mysql://")) {
    return "mysql";
  }
  if (
    url.startsWith("file:") ||
    url.endsWith(".db") ||
    url.endsWith(".sqlite") ||
    url.endsWith(".sqlite3")
  ) {
    return "sqlite";
  }
  return undefined;
}

/**
 * Validate database environment variables
 *
 * @returns Validation result with errors if any
 */
export function validateDatabaseEnv(): DatabaseEnvValidation {
  const errors: string[] = [];
  const databaseUrl = process.env.DATABASE_URL;
  const dialectEnv = process.env.DB_DIALECT as SupportedDialect | undefined;

  if (!databaseUrl) {
    errors.push("DATABASE_URL environment variable is required");
  }

  let dialect: SupportedDialect | undefined = dialectEnv;
  if (!dialect && databaseUrl) {
    dialect = detectDialectFromUrl(databaseUrl);
  }

  if (!dialect) {
    errors.push(
      "Could not detect database dialect. Set DB_DIALECT to one of: postgresql, mysql, sqlite"
    );
  } else if (!["postgresql", "mysql", "sqlite"].includes(dialect)) {
    errors.push(
      `Invalid DB_DIALECT: ${dialect}. Must be one of: postgresql, mysql, sqlite`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    dialect: errors.length === 0 ? dialect : undefined,
    databaseUrl: errors.length === 0 ? databaseUrl : undefined,
  };
}

/**
 * Database adapter interface (minimal for CLI use)
 */
export interface CLIDatabaseAdapter {
  dialect: SupportedDialect;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  getCapabilities(): { dialect: SupportedDialect };
}

/**
 * Create a database adapter from environment or options
 *
 * @param options - Adapter creation options
 * @returns Database adapter instance
 * @throws Error if environment is invalid or adapter creation fails
 *
 * @example
 * ```typescript
 * const adapter = await createAdapter({ logger });
 * try {
 *   // Use adapter...
 * } finally {
 *   await adapter.disconnect();
 * }
 * ```
 */
export async function createAdapter(
  options: CreateAdapterOptions = {}
): Promise<CLIDatabaseAdapter> {
  const { logger } = options;

  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  let dialect = options.dialect;

  if (!dialect && databaseUrl) {
    dialect = detectDialectFromUrl(databaseUrl);
  }
  if (!dialect) {
    dialect = process.env.DB_DIALECT as SupportedDialect | undefined;
  }

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  if (!dialect) {
    throw new Error(
      "Could not detect database dialect. Set DB_DIALECT environment variable."
    );
  }

  logger?.debug(`Creating ${dialect} adapter...`);

  const { createAdapterFromEnv } = await import("../../database/factory");

  const originalDialect = process.env.DB_DIALECT;
  const originalUrl = process.env.DATABASE_URL;

  try {
    process.env.DB_DIALECT = dialect;
    process.env.DATABASE_URL = databaseUrl;

    const adapter = await createAdapterFromEnv();
    return adapter as unknown as CLIDatabaseAdapter;
  } finally {
    if (originalDialect !== undefined) {
      process.env.DB_DIALECT = originalDialect;
    }
    if (originalUrl !== undefined) {
      process.env.DATABASE_URL = originalUrl;
    }
  }
}

/**
 * Execute a function with a database adapter, ensuring cleanup
 *
 * @param fn - Function to execute with the adapter
 * @param options - Adapter creation options
 * @returns Result of the function
 *
 * @example
 * ```typescript
 * const result = await withAdapter(async (adapter) => {
 *   return await someOperation(adapter);
 * }, { logger });
 * ```
 */
export async function withAdapter<T>(
  fn: (adapter: CLIDatabaseAdapter) => Promise<T>,
  options: CreateAdapterOptions = {}
): Promise<T> {
  const adapter = await createAdapter(options);
  try {
    return await fn(adapter);
  } finally {
    await adapter.disconnect();
  }
}

/**
 * Get a human-readable name for a dialect
 *
 * @param dialect - Database dialect
 * @returns Human-readable name
 */
export function getDialectDisplayName(dialect: SupportedDialect): string {
  switch (dialect) {
    case "postgresql":
      return "PostgreSQL";
    case "mysql":
      return "MySQL";
    case "sqlite":
      return "SQLite";
    default:
      return dialect;
  }
}

/**
 * Check if a dialect supports a specific feature
 *
 * @param dialect - Database dialect
 * @param feature - Feature to check
 * @returns Whether the feature is supported
 */
export function dialectSupports(
  dialect: SupportedDialect,
  feature: "transactions" | "jsonb" | "arrays" | "uuids"
): boolean {
  switch (feature) {
    case "transactions":
      return true;
    case "jsonb":
      return dialect === "postgresql";
    case "arrays":
      return dialect === "postgresql";
    case "uuids":
      return dialect === "postgresql";
    default:
      return false;
  }
}
