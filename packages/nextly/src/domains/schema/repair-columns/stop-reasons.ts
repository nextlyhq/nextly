/**
 * The `logContext.reason` of each refusal `nextly repair-columns` stops on.
 *
 * Their own module, importing nothing, because two places read them: the errors
 * (`stop-errors`), and the CLI's error table, which names each one. Reading a name from a module
 * that loads the schema services would load them into every command that loads the error table.
 *
 * @module domains/schema/repair-columns/stop-reasons
 */

/** A registry row names no table. */
export const REGISTRY_ROW_WITHOUT_TABLE_REASON = "registry row without table";

/** A registry row is marked as diverged. */
export const REGISTRY_ROW_DIVERGED_REASON = "registry row diverged";

/** An applied migration's snapshot holds something that is not a snapshot. */
export const APPLIED_SNAPSHOT_INVALID_REASON = "applied snapshot invalid";

/** An applied migration's snapshot is there and its migration file is not. */
export const APPLIED_MIGRATION_FILE_MISSING_REASON =
  "applied migration file missing";

/** An applied migration newer than the newest snapshot read has none. */
export const APPLIED_SNAPSHOT_MISSING_REASON = "applied snapshot missing";

/** The snapshots are there and the disk does not give them. */
export const MIGRATION_SNAPSHOTS_UNREADABLE_REASON =
  "migration snapshots unreadable";
