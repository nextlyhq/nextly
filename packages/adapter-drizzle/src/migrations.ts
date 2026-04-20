/**
 * Database migration utilities.
 *
 * @remarks
 * Provides core utilities for migration management including checksum calculation,
 * sorting, filtering, and validation. Also includes optional helpers for adapters
 * to use for common migration operations.
 *
 * @packageDocumentation
 */

import { createHash } from "crypto";

import type { DrizzleAdapter } from "./adapter";
import type {
  Migration,
  MigrationRecord,
  MigrationStatus,
  MigrationOptions,
} from "./types/migration";

// ============================================================
// Core Utilities
// ============================================================

/**
 * Calculate SHA-256 checksum for a migration.
 *
 * @remarks
 * Creates a checksum of the entire migration object including id, name, timestamp,
 * and the string representation of up/down functions. This allows detection of
 * any changes to the migration after it has been applied.
 *
 * @param migration - Migration to calculate checksum for
 * @returns Hexadecimal SHA-256 hash
 *
 * @example
 * ```typescript
 * const migration: Migration = {
 *   id: "20250104_001_create_users",
 *   name: "Create users table",
 *   timestamp: 1704326400000,
 *   up: "CREATE TABLE users (id UUID PRIMARY KEY);",
 * };
 *
 * const checksum = calculateChecksum(migration);
 * // Returns: "a3f5b8c9d2e1f0..."
 * ```
 *
 * @public
 */
export function calculateChecksum(migration: Migration): string {
  // Serialize migration to a consistent string format
  const content = JSON.stringify({
    id: migration.id,
    name: migration.name,
    timestamp: migration.timestamp,
    up:
      typeof migration.up === "string" ? migration.up : migration.up.toString(),
    down:
      typeof migration.down === "string"
        ? migration.down
        : migration.down?.toString() || null,
  });

  // Create SHA-256 hash
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Sort migrations by timestamp in ascending order.
 *
 * @remarks
 * Provides deterministic ordering of migrations. If timestamps are equal,
 * falls back to sorting by migration ID alphabetically.
 *
 * @param migrations - Array of migrations to sort
 * @returns New sorted array (original array is not modified)
 *
 * @example
 * ```typescript
 * const migrations = [
 *   { id: "003", timestamp: 1704412800000, ... },
 *   { id: "001", timestamp: 1704326400000, ... },
 *   { id: "002", timestamp: 1704326400000, ... },
 * ];
 *
 * const sorted = sortMigrations(migrations);
 * // Returns: [001, 002, 003] (001 and 002 same timestamp, sorted by id)
 * ```
 *
 * @public
 */
export function sortMigrations(migrations: Migration[]): Migration[] {
  return [...migrations].sort((a, b) => {
    // Primary sort: timestamp ascending
    if (a.timestamp !== b.timestamp) {
      return a.timestamp - b.timestamp;
    }
    // Secondary sort: id alphabetically (for deterministic ordering)
    return a.id.localeCompare(b.id);
  });
}

/**
 * Filter migrations to get only pending (unapplied) migrations.
 *
 * @remarks
 * Returns migrations that have not been applied to the database yet.
 * A migration is considered pending if its ID is not present in the
 * applied migration records.
 *
 * @param migrations - All available migrations
 * @param applied - Records of applied migrations from database
 * @returns Array of pending migrations
 *
 * @example
 * ```typescript
 * const allMigrations = [
 *   { id: "001_create_users", ... },
 *   { id: "002_create_posts", ... },
 *   { id: "003_create_comments", ... },
 * ];
 *
 * const appliedRecords = [
 *   { id: "001_create_users", appliedAt: new Date(), ... },
 * ];
 *
 * const pending = filterPending(allMigrations, appliedRecords);
 * // Returns: [002_create_posts, 003_create_comments]
 * ```
 *
 * @public
 */
export function filterPending(
  migrations: Migration[],
  applied: MigrationRecord[]
): Migration[] {
  const appliedIds = new Set(applied.map(record => record.id));
  return migrations.filter(migration => !appliedIds.has(migration.id));
}

/**
 * Filter migration records to get only those that match given migrations.
 *
 * @remarks
 * Returns applied migration records that correspond to the given migrations.
 * Useful for getting the subset of applied records relevant to a specific
 * set of migrations.
 *
 * @param migrations - Migrations to match
 * @param applied - All applied migration records from database
 * @returns Array of matching applied records
 *
 * @example
 * ```typescript
 * const migrations = [
 *   { id: "001_create_users", ... },
 *   { id: "002_create_posts", ... },
 * ];
 *
 * const allApplied = [
 *   { id: "001_create_users", appliedAt: new Date(), ... },
 *   { id: "002_create_posts", appliedAt: new Date(), ... },
 *   { id: "003_create_comments", appliedAt: new Date(), ... },
 * ];
 *
 * const relevant = filterApplied(migrations, allApplied);
 * // Returns: [001_create_users, 002_create_posts]
 * ```
 *
 * @public
 */
export function filterApplied(
  migrations: Migration[],
  applied: MigrationRecord[]
): MigrationRecord[] {
  const migrationIds = new Set(migrations.map(migration => migration.id));
  return applied.filter(record => migrationIds.has(record.id));
}

/**
 * Validate that a migration's checksum matches its applied record.
 *
 * @remarks
 * Compares the calculated checksum of a migration against the stored checksum
 * in its migration record. Returns false if checksums don't match or if the
 * record has no checksum.
 *
 * @param migration - Migration to validate
 * @param record - Applied migration record with stored checksum
 * @returns true if checksums match, false otherwise
 *
 * @example
 * ```typescript
 * const migration: Migration = { id: "001", ... };
 * const record: MigrationRecord = {
 *   id: "001",
 *   checksum: "a3f5b8c9...",
 *   ...
 * };
 *
 * const isValid = validateChecksum(migration, record);
 * // Returns: true if checksums match, false if modified
 * ```
 *
 * @public
 */
export function validateChecksum(
  migration: Migration,
  record: MigrationRecord
): boolean {
  if (!record.checksum) {
    // No checksum stored, cannot validate
    return false;
  }

  const currentChecksum = calculateChecksum(migration);
  return currentChecksum === record.checksum;
}

/**
 * Detect migrations that have been modified after being applied.
 *
 * @remarks
 * Compares checksums of migrations against their applied records to detect
 * any modifications. Returns records for migrations that have been changed
 * since they were applied to the database.
 *
 * This is critical for detecting potentially dangerous situations where a
 * migration that has already run has been modified.
 *
 * @param migrations - Current migrations
 * @param applied - Applied migration records with checksums
 * @returns Array of records for modified migrations
 *
 * @example
 * ```typescript
 * const migrations = [{ id: "001", up: "CREATE TABLE users_v2 ..." }];
 * const applied = [{ id: "001", checksum: "original_hash", ... }];
 *
 * const modified = detectModified(migrations, applied);
 * // Returns: [{ id: "001", ... }] if migration was changed
 * ```
 *
 * @public
 */
export function detectModified(
  migrations: Migration[],
  applied: MigrationRecord[]
): MigrationRecord[] {
  const migrationMap = new Map(migrations.map(m => [m.id, m]));
  const modified: MigrationRecord[] = [];

  for (const record of applied) {
    const migration = migrationMap.get(record.id);
    if (migration && !validateChecksum(migration, record)) {
      modified.push(record);
    }
  }

  return modified;
}

/**
 * Get comprehensive migration status.
 *
 * @remarks
 * Analyzes migrations and applied records to produce a complete status report
 * including current migration, applied/pending counts, and full lists.
 *
 * @param migrations - All available migrations
 * @param applied - Applied migration records from database
 * @returns Complete migration status information
 *
 * @example
 * ```typescript
 * const status = getMigrationStatus(allMigrations, appliedRecords);
 * console.log(`Current: ${status.current}`);
 * console.log(`Applied: ${status.appliedCount}, Pending: ${status.pendingCount}`);
 * ```
 *
 * @public
 */
export function getMigrationStatus(
  migrations: Migration[],
  applied: MigrationRecord[]
): MigrationStatus {
  const sortedMigrations = sortMigrations(migrations);
  const sortedApplied = [...applied].sort(
    (a, b) => b.appliedAt.getTime() - a.appliedAt.getTime()
  );

  const pending = filterPending(sortedMigrations, applied);
  const current = sortedApplied.length > 0 ? sortedApplied[0].id : null;

  return {
    current,
    appliedCount: applied.length,
    pendingCount: pending.length,
    applied,
    pending,
  };
}

// ============================================================
// Migration Validation
// ============================================================

/**
 * Validation result for migrations.
 *
 * @public
 */
export interface MigrationValidationResult {
  /** Whether all validations passed */
  valid: boolean;

  /** List of validation errors */
  errors: string[];

  /** List of validation warnings */
  warnings: string[];

  /** Migrations that have been modified */
  modified: MigrationRecord[];

  /** Duplicate migration IDs found */
  duplicates: string[];
}

/**
 * Validate migrations for common issues.
 *
 * @remarks
 * Performs comprehensive validation including:
 * - Duplicate migration IDs
 * - Modified applied migrations (checksum mismatch)
 * - Missing required fields
 * - Invalid timestamps
 *
 * @param migrations - Migrations to validate
 * @param applied - Applied migration records (for checksum validation)
 * @param options - Migration options (for strictness configuration)
 * @returns Validation result with errors and warnings
 *
 * @example
 * ```typescript
 * const result = validateMigrations(migrations, applied, {
 *   strictChecksums: true
 * });
 *
 * if (!result.valid) {
 *   console.error("Validation errors:", result.errors);
 *   throw new Error("Migration validation failed");
 * }
 * ```
 *
 * @public
 */
export function validateMigrations(
  migrations: Migration[],
  applied: MigrationRecord[],
  options?: MigrationOptions
): MigrationValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const duplicates: string[] = [];

  // Check for duplicate IDs
  const idCounts = new Map<string, number>();
  for (const migration of migrations) {
    const count = (idCounts.get(migration.id) || 0) + 1;
    idCounts.set(migration.id, count);
    if (count > 1) {
      duplicates.push(migration.id);
    }
  }

  if (duplicates.length > 0) {
    errors.push(`Duplicate migration IDs found: ${duplicates.join(", ")}`);
  }

  // Validate required fields
  for (const migration of migrations) {
    if (!migration.id) {
      errors.push("Migration missing required field: id");
    }
    if (!migration.name) {
      errors.push(`Migration ${migration.id} missing required field: name`);
    }
    if (!migration.timestamp || typeof migration.timestamp !== "number") {
      errors.push(`Migration ${migration.id} missing or invalid timestamp`);
    }
    if (!migration.up) {
      errors.push(`Migration ${migration.id} missing required field: up`);
    }
  }

  // Check for modified migrations
  const modified = detectModified(migrations, applied);

  if (modified.length > 0) {
    const modifiedIds = modified.map(r => r.id).join(", ");
    const message = `Applied migrations have been modified: ${modifiedIds}`;

    // Use strictChecksums option if available, default to true (strict)
    const strictChecksums = options?.strictChecksums ?? true;

    if (strictChecksums) {
      errors.push(message);
    } else {
      warnings.push(message);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    modified,
    duplicates,
  };
}

// ============================================================
// Migration Helpers (for adapters)
// ============================================================

/**
 * Helper functions for managing migrations in database adapters.
 *
 * @remarks
 * These helpers reduce boilerplate code in dialect-specific adapters by
 * providing common operations like creating migration tables, recording
 * migrations, and querying migration status.
 *
 * Adapters can use these helpers or implement their own logic.
 *
 * @public
 */
export interface MigrationHelpers {
  /**
   * Create the migrations tracking table if it doesn't exist.
   *
   * @remarks
   * Creates a table named `nextly_migrations` with columns:
   * - id (string, primary key)
   * - name (string)
   * - applied_at (timestamp)
   * - checksum (string, optional)
   *
   * Uses CREATE TABLE IF NOT EXISTS for safety.
   *
   * @param adapter - Database adapter to use
   * @returns Promise that resolves when table is created
   */
  createMigrationsTable(adapter: DrizzleAdapter): Promise<void>;

  /**
   * Get all applied migration records from the database.
   *
   * @remarks
   * Queries the `nextly_migrations` table and returns all records
   * sorted by applied_at descending (most recent first).
   *
   * @param adapter - Database adapter to use
   * @returns Promise with array of applied migration records
   */
  getAppliedMigrations(adapter: DrizzleAdapter): Promise<MigrationRecord[]>;

  /**
   * Record a migration as applied in the database.
   *
   * @remarks
   * Inserts a new record into the `nextly_migrations` table with:
   * - Migration ID, name
   * - Current timestamp for applied_at
   * - Calculated checksum
   *
   * Should be called within a transaction during migration execution.
   *
   * @param adapter - Database adapter to use
   * @param migration - Migration that was applied
   * @returns Promise that resolves when record is inserted
   */
  recordMigration(adapter: DrizzleAdapter, migration: Migration): Promise<void>;

  /**
   * Remove a migration record from the database.
   *
   * @remarks
   * Deletes a record from the `nextly_migrations` table.
   * Used during migration rollback operations.
   *
   * Should be called within a transaction during rollback.
   *
   * @param adapter - Database adapter to use
   * @param migrationId - ID of the migration to remove
   * @returns Promise that resolves when record is deleted
   */
  removeMigrationRecord(
    adapter: DrizzleAdapter,
    migrationId: string
  ): Promise<void>;

  /**
   * Check if migrations table exists.
   *
   * @remarks
   * Queries database metadata to check if the `nextly_migrations` table exists.
   * Useful for determining if initialization is needed.
   *
   * @param adapter - Database adapter to use
   * @returns Promise with boolean indicating if table exists
   */
  migrationsTableExists(adapter: DrizzleAdapter): Promise<boolean>;
}

/**
 * Implementation of migration helpers.
 *
 * @remarks
 * Provides default implementations using the adapter's query methods.
 * These work across all dialects but adapters can optimize for their
 * specific database if needed.
 *
 * @public
 */
export const migrationHelpers: MigrationHelpers = {
  async createMigrationsTable(adapter: DrizzleAdapter): Promise<void> {
    const caps = adapter.getCapabilities();
    const dialect = caps.dialect;

    // Build CREATE TABLE statement with dialect-specific syntax
    let sql = "";

    if (dialect === "postgresql") {
      sql = `
        CREATE TABLE IF NOT EXISTS nextly_migrations (
          id VARCHAR(255) PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          checksum VARCHAR(64)
        )
      `;
    } else if (dialect === "mysql") {
      sql = `
        CREATE TABLE IF NOT EXISTS nextly_migrations (
          id VARCHAR(255) PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          checksum VARCHAR(64)
        )
      `;
    } else if (dialect === "sqlite") {
      sql = `
        CREATE TABLE IF NOT EXISTS nextly_migrations (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          checksum TEXT
        )
      `;
    } else {
      throw new Error(`Unsupported dialect: ${dialect}`);
    }

    await adapter.executeQuery(sql);
  },

  async getAppliedMigrations(
    adapter: DrizzleAdapter
  ): Promise<MigrationRecord[]> {
    const results = await adapter.select<{
      id: string;
      name: string;
      applied_at: Date;
      checksum?: string;
    }>("nextly_migrations", {
      orderBy: [{ column: "applied_at", direction: "desc" }],
    });

    return results.map(row => ({
      id: row.id,
      name: row.name,
      appliedAt: new Date(row.applied_at),
      checksum: row.checksum,
    }));
  },

  async recordMigration(
    adapter: DrizzleAdapter,
    migration: Migration
  ): Promise<void> {
    const checksum = calculateChecksum(migration);

    await adapter.insert("nextly_migrations", {
      id: migration.id,
      name: migration.name,
      applied_at: new Date(),
      checksum,
    });
  },

  async removeMigrationRecord(
    adapter: DrizzleAdapter,
    migrationId: string
  ): Promise<void> {
    await adapter.delete("nextly_migrations", {
      and: [{ column: "id", op: "=", value: migrationId }],
    });
  },

  async migrationsTableExists(adapter: DrizzleAdapter): Promise<boolean> {
    try {
      // Try to query the table - if it doesn't exist, this will throw
      await adapter.select("nextly_migrations", { limit: 1 });
      return true;
    } catch {
      return false;
    }
  },
};

// ============================================================
// Type Exports
// ============================================================

// Re-export migration types for convenience
export type {
  Migration,
  MigrationRecord,
  MigrationResult,
  MigrationStatus,
  MigrationOptions,
} from "./types/migration";
