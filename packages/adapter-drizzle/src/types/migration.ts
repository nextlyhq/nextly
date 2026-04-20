/**
 * Database migration type definitions.
 *
 * @packageDocumentation
 */

import type { TransactionContext } from "./transaction";

/**
 * Migration definition.
 *
 * @remarks
 * Represents a single database migration with up and optional down functions.
 * Migrations can be defined as raw SQL strings or as functions that use the
 * transaction context for more complex operations.
 *
 * @public
 */
export interface Migration {
  /** Unique migration identifier (e.g., "20250104_001_create_users") */
  id: string;

  /** Human-readable migration name */
  name: string;

  /** Unix timestamp when migration was created */
  timestamp: number;

  /** Forward migration (apply changes) */
  up: string | ((tx: TransactionContext) => Promise<void>);

  /** Reverse migration (undo changes) - optional */
  down?: string | ((tx: TransactionContext) => Promise<void>);
}

/**
 * Migration record stored in the database.
 *
 * @remarks
 * Tracks which migrations have been applied to the database.
 * The migrations table is automatically created by the adapter.
 *
 * @public
 */
export interface MigrationRecord {
  /** Migration identifier */
  id: string;

  /** Migration name */
  name: string;

  /** When the migration was applied */
  appliedAt: Date;

  /** Optional checksum to detect migration changes */
  checksum?: string;
}

/**
 * Migration execution result.
 *
 * @remarks
 * Provides information about migration status including applied and
 * pending migrations.
 *
 * @public
 */
export interface MigrationResult {
  /** Migrations that were applied in this execution */
  applied: MigrationRecord[];

  /** Migrations that are pending (not yet applied) */
  pending: Migration[];

  /** ID of the current (most recent) migration, or null if none applied */
  current: string | null;
}

/**
 * Options for migration execution.
 *
 * @public
 */
export interface MigrationOptions {
  /** Target migration to migrate to (default: latest) */
  target?: string;

  /** Dry run mode - don't actually apply migrations */
  dryRun?: boolean;

  /** Run migrations in a single transaction (default: true) */
  useTransaction?: boolean;

  /**
   * Strict checksum validation (default: true).
   * If true, modified migrations will cause an error.
   * If false, modified migrations will generate a warning.
   */
  strictChecksums?: boolean;
}

/**
 * Migration status information.
 *
 * @public
 */
export interface MigrationStatus {
  /** Current migration ID (most recently applied) */
  current: string | null;

  /** Total number of applied migrations */
  appliedCount: number;

  /** Total number of pending migrations */
  pendingCount: number;

  /** Applied migration records */
  applied: MigrationRecord[];

  /** Pending migrations */
  pending: Migration[];
}
