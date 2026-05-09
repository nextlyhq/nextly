/**
 * Database Migrations
 *
 * Exports migration management functions for running, rolling back,
 * and checking the status of database migrations.
 *
 * @example
 * ```typescript
 * import { createAdapter } from '../factory';
 * import { runMigrations, getMigrationStatus } from './migrations';
 *
 * const adapter = await createAdapter();
 *
 * // Check status
 * const status = await getMigrationStatus(adapter);
 * console.log(`Applied: ${status.appliedCount}, Pending: ${status.pendingCount}`);
 *
 * // Run pending migrations
 * const result = await runMigrations(adapter);
 * console.log(`Successfully applied ${result.applied.length} migrations`);
 * ```
 *
 * @packageDocumentation
 */

export {
  runMigrations,
  rollbackMigration,
  getMigrationStatus,
} from "./manager";

export type {
  Migration,
  MigrationResult,
  MigrationStatus,
  MigrationOptions,
} from "./manager";
