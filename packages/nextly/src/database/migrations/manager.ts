/**
 * Migration Manager
 *
 * High-level migration management that works with the DrizzleAdapter interface.
 * Provides functions to run, rollback, and check status of database migrations.
 *
 * @remarks
 * This module bridges filesystem-based SQL migrations with the Migration interface,
 * enabling consistent migration management across PostgreSQL, MySQL, and SQLite.
 *
 * Key features:
 * - Loads migrations from dialect-specific folders
 * - Delegates execution to DrizzleAdapter
 * - Supports both development (src/) and production (dist/) paths
 * - Configurable validation (strict checksums by default)
 * - Works across all three database dialects
 *
 * @example
 * ```typescript
 * import { createAdapter } from '../factory';
 * import { runMigrations, getMigrationStatus } from './manager';
 *
 * const adapter = await createAdapter();
 * const result = await runMigrations(adapter);
 * console.log(`Applied ${result.applied.length} migrations`);
 * ```
 *
 * @packageDocumentation
 */

import { existsSync, readdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
import {
  sortMigrations,
  validateMigrations,
  getMigrationStatus as getStatusFromUtility,
  migrationHelpers,
} from "@revnixhq/adapter-drizzle/migrations";
import type {
  Migration,
  MigrationResult,
  MigrationStatus,
  MigrationOptions,
  TransactionContext,
} from "@revnixhq/adapter-drizzle/types";

// ============================================================================
// Path Resolution
// ============================================================================

/**
 * Get the current directory, works in both ESM and CJS
 *
 * @internal
 */
function getCurrentDirectory(): string {
  // For CommonJS (__dirname is defined)
  if (typeof __dirname !== "undefined") {
    return __dirname;
  }

  // For ESM (need to use import.meta.url)
  // @ts-ignore - import.meta is available in ESM environments
  if (typeof import.meta !== "undefined" && import.meta.url) {
    // @ts-ignore - import.meta.url is available in ESM environments
    return dirname(fileURLToPath(import.meta.url));
  }

  // Fallback
  return process.cwd();
}

/**
 * Resolve the migrations folder path for a given dialect.
 *
 * @remarks
 * Handles both development and production scenarios:
 * - Development: src/database/migrations/{dialect}
 * - Production: dist/database/migrations/{dialect}
 * - Installed package: node_modules/@nextly/nextly/dist/database/migrations/{dialect}
 *
 * @param dialect - Database dialect (postgresql, mysql, sqlite)
 * @returns Absolute path to migrations folder
 * @throws {Error} If migrations folder cannot be found
 *
 * @internal
 */
function resolveMigrationsFolder(dialect: string): string {
  const currentDir = getCurrentDirectory();

  // Try multiple possible locations in order of preference
  const possiblePaths = [
    // Development: When running from src/database/migrations/
    join(currentDir, dialect),
    // Development: When running from compiled dist/database/migrations/
    join(currentDir, dialect),
    // Production: When bundled in dist/
    join(currentDir, "migrations", dialect),
    // Installed package: node_modules/@nextly/nextly/dist/...
    join(currentDir, "..", "..", "..", "migrations", dialect),
    // Fallback: Relative to process.cwd()
    join(process.cwd(), "src", "database", "migrations", dialect),
    join(process.cwd(), "dist", "database", "migrations", dialect),
  ];

  // Return the first path that exists
  for (const path of possiblePaths) {
    if (existsSync(path)) {
      return path;
    }
  }

  // If no path found, throw descriptive error
  throw new Error(
    `Failed to locate migrations folder for dialect "${dialect}". Attempted paths:\n${possiblePaths.map((p, i) => `  ${i + 1}. ${p}`).join("\n")}\n\nCurrent directory: ${currentDir}\nProcess cwd: ${process.cwd()}`
  );
}

// ============================================================================
// Migration Loading
// ============================================================================

/**
 * Parse migration ID to extract timestamp.
 *
 * @remarks
 * Migration IDs follow the pattern: `0000_migration_name.sql`
 * where `0000` is a sequential number that we treat as timestamp.
 *
 * @param id - Migration ID (e.g., "0001_create_users")
 * @returns Unix timestamp in milliseconds
 *
 * @internal
 */
function parseTimestampFromId(id: string): number {
  // Extract the numeric prefix (e.g., "0001" from "0001_create_users")
  const match = id.match(/^(\d+)/);
  if (!match) {
    // If no numeric prefix, use current time
    return Date.now();
  }

  // Convert to timestamp (multiply by a large number to spread them out)
  // This ensures proper ordering while keeping timestamps reasonable
  const sequence = parseInt(match[1], 10);
  return sequence * 1000; // Simple sequential timestamp
}

/**
 * Extract human-readable name from migration ID.
 *
 * @remarks
 * Converts "0001_create_users_table" to "Create users table"
 *
 * @param id - Migration ID
 * @returns Human-readable migration name
 *
 * @internal
 */
function extractNameFromId(id: string): string {
  // Remove numeric prefix and .sql extension
  const withoutPrefix = id.replace(/^\d+_/, "");
  const withoutExtension = withoutPrefix.replace(/\.sql$/, "");

  // Convert underscores to spaces and capitalize
  return withoutExtension
    .split("_")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Load migrations from filesystem for a given dialect.
 *
 * @remarks
 * Scans the dialect-specific migrations folder, reads SQL files,
 * and converts them to Migration objects. Filters out non-SQL files
 * like meta/ folder and _journal.json.
 *
 * SQL migrations are wrapped in a function that executes via the
 * transaction context's executeQuery method.
 *
 * @param dialect - Database dialect
 * @returns Array of Migration objects sorted by timestamp
 * @throws {Error} If migrations folder cannot be found or read
 *
 * @internal
 */
async function loadMigrationsFromFilesystem(
  dialect: string
): Promise<Migration[]> {
  const migrationsFolder = resolveMigrationsFolder(dialect);

  // Read directory contents
  let files: string[];
  try {
    files = readdirSync(migrationsFolder);
  } catch (error) {
    throw new Error(
      `Failed to read migrations folder: ${migrationsFolder}\n${error instanceof Error ? error.message : String(error)}`
    );
  }

  // Filter to only .sql files (ignore meta/ folder, _journal.json, etc.)
  const sqlFiles = files.filter(
    file => file.endsWith(".sql") && !file.startsWith(".")
  );

  // Convert SQL files to Migration objects
  const migrations: Migration[] = [];

  for (const file of sqlFiles) {
    const filePath = join(migrationsFolder, file);
    const id = file.replace(/\.sql$/, ""); // Remove .sql extension

    try {
      const sql = readFileSync(filePath, "utf-8");

      migrations.push({
        id,
        name: extractNameFromId(id),
        timestamp: parseTimestampFromId(id),
        // Wrap SQL in a function that executes via transaction context
        up: async (tx: TransactionContext) => {
          await tx.execute(sql);
        },
        // Down migrations not supported yet (would need separate down.sql files)
        down: undefined,
      });
    } catch (error) {
      throw new Error(
        `Failed to read migration file: ${filePath}\n${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // Sort by timestamp to ensure correct order
  return sortMigrations(migrations);
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Run all pending migrations.
 *
 * @remarks
 * Loads migrations from the filesystem, validates them, and delegates
 * execution to the adapter. The adapter handles transaction management,
 * recording applied migrations, and returning results.
 *
 * By default, uses strict checksum validation. Set `strictChecksums: false`
 * in options to allow modified migrations (useful in development).
 *
 * @param adapter - Connected DrizzleAdapter instance
 * @param options - Optional migration options
 * @returns Migration result with applied and pending migrations
 * @throws {Error} If migration validation fails (strict mode)
 * @throws {Error} If migrations folder cannot be found
 * @throws {Error} If migration execution fails
 *
 * @example
 * ```typescript
 * const adapter = await createAdapter();
 * const result = await runMigrations(adapter);
 *
 * console.log(`Applied: ${result.applied.length}`);
 * console.log(`Pending: ${result.pending.length}`);
 * console.log(`Current: ${result.current}`);
 * ```
 *
 * @example
 * ```typescript
 * // Allow modified migrations in development
 * const result = await runMigrations(adapter, {
 *   strictChecksums: false,
 * });
 * ```
 *
 * @public
 */
export async function runMigrations(
  adapter: DrizzleAdapter,
  options?: MigrationOptions
): Promise<MigrationResult> {
  // Load migrations from filesystem
  const migrations = await loadMigrationsFromFilesystem(
    adapter.getCapabilities().dialect
  );

  // Ensure migrations table exists
  await migrationHelpers.createMigrationsTable(adapter);

  // Get applied migrations from database
  const appliedRecords = await migrationHelpers.getAppliedMigrations(adapter);

  // Validate migrations (checks for duplicates, modified migrations, etc.)
  const validation = validateMigrations(migrations, appliedRecords, options);

  if (!validation.valid) {
    throw new Error(
      `Migration validation failed:\n${validation.errors.map(e => `  - ${e}`).join("\n")}`
    );
  }

  // Log warnings if any
  if (validation.warnings.length > 0) {
    console.warn("Migration warnings:");
    validation.warnings.forEach(w => console.warn(`  - ${w}`));
  }

  // Delegate to adapter for execution
  // Note: Options are validated above but not passed to adapter.migrate()
  // since the adapter's migrate() signature only accepts migrations array
  return adapter.migrate(migrations);
}

/**
 * Rollback the last applied migration.
 *
 * @remarks
 * Delegates to the adapter's rollback method, which should:
 * 1. Identify the most recent migration
 * 2. Execute its down() function (if defined)
 * 3. Remove the migration record from the database
 * 4. Return the result
 *
 * Note: SQL-based migrations loaded from filesystem don't have down()
 * functions yet. This will be supported in a future version with
 * separate .down.sql files or TypeScript migrations.
 *
 * @param adapter - Connected DrizzleAdapter instance
 * @returns Migration result after rollback
 * @throws {Error} If no migrations to rollback
 * @throws {Error} If migration doesn't have down() function
 * @throws {Error} If rollback execution fails
 *
 * @example
 * ```typescript
 * const result = await rollbackMigration(adapter);
 * console.log(`Rolled back: ${result.applied[0]?.id}`);
 * ```
 *
 * @public
 */
export async function rollbackMigration(
  adapter: DrizzleAdapter
): Promise<MigrationResult> {
  return adapter.rollback();
}

/**
 * Get current migration status.
 *
 * @remarks
 * Returns comprehensive information about applied and pending migrations,
 * including counts and the current (most recent) migration ID.
 *
 * Useful for displaying migration status in CLI tools or admin panels.
 *
 * @param adapter - Connected DrizzleAdapter instance
 * @returns Migration status information
 * @throws {Error} If migrations folder cannot be found
 *
 * @example
 * ```typescript
 * const status = await getMigrationStatus(adapter);
 *
 * console.log(`Current migration: ${status.current || 'none'}`);
 * console.log(`Applied: ${status.appliedCount}`);
 * console.log(`Pending: ${status.pendingCount}`);
 *
 * if (status.pendingCount > 0) {
 *   console.log('\nPending migrations:');
 *   status.pending.forEach(m => console.log(`  - ${m.id}: ${m.name}`));
 * }
 * ```
 *
 * @public
 */
export async function getMigrationStatus(
  adapter: DrizzleAdapter
): Promise<MigrationStatus> {
  // Load migrations from filesystem
  const migrations = await loadMigrationsFromFilesystem(
    adapter.getCapabilities().dialect
  );

  // Ensure migrations table exists
  const tableExists = await migrationHelpers.migrationsTableExists(adapter);
  if (!tableExists) {
    await migrationHelpers.createMigrationsTable(adapter);
  }

  // Get applied migrations from database
  const appliedRecords = await migrationHelpers.getAppliedMigrations(adapter);

  // Use utility to compute status
  return getStatusFromUtility(migrations, appliedRecords);
}

// ============================================================================
// Type Exports
// ============================================================================

// Re-export types for convenience
export type {
  Migration,
  MigrationResult,
  MigrationStatus,
  MigrationOptions,
} from "@revnixhq/adapter-drizzle/types";
