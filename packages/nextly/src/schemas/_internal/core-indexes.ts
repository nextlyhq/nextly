/**
 * The indexes of the extendable core tables, described once for all three
 * dialects, and the per-dialect functions that turn a description into
 * Drizzle index builders.
 *
 * Each dialect's table module passes its table's description through its own
 * function, so an index is declared in one place and a dialect cannot come to
 * carry a different set by an edit made to one file.
 *
 * @module schemas/_internal/core-indexes
 */
import {
  index as mysqlIndex,
  uniqueIndex as mysqlUniqueIndex,
} from "drizzle-orm/mysql-core";
import {
  index as pgIndex,
  uniqueIndex as pgUniqueIndex,
} from "drizzle-orm/pg-core";
import {
  index as sqliteIndex,
  uniqueIndex as sqliteUniqueIndex,
} from "drizzle-orm/sqlite-core";

/** One index: its name and the column KEYS it covers, in order. */
export interface CoreIndex<K extends string> {
  readonly name: string;
  readonly columns: readonly [K, ...K[]];
  readonly unique?: true;
}

export const USERS_INDEXES = [
  { name: "users_email_unique", columns: ["email"], unique: true },
  { name: "users_created_at_idx", columns: ["createdAt"] },
] as const satisfies readonly CoreIndex<string>[];

// Performance indexes for common queries.
export const MEDIA_INDEXES = [
  // Filter by uploader.
  { name: "media_uploaded_by_idx", columns: ["uploadedBy"] },
  // Filter by file type (image/*, video/*, ...).
  { name: "media_mime_type_idx", columns: ["mimeType"] },
  // Sort by upload date.
  { name: "media_uploaded_at_idx", columns: ["uploadedAt"] },
  // Filter by folder.
  { name: "media_folder_id_idx", columns: ["folderId"] },
] as const satisfies readonly CoreIndex<string>[];

export const NEXTLY_JOBS_INDEXES = [
  // The due-job query reads exactly these two columns together.
  { name: "nextly_jobs_due_idx", columns: ["state", "runAt"] },
  // Ordering index for the recent-jobs read, which sorts the whole table by
  // `updatedAt` before its small limit applies. Without it that is a full
  // scan and sort on every monitoring request, and it degrades with queue
  // volume rather than staying bounded — the due index above cannot serve it,
  // because its leading column is `state`.
  //
  // A DECLARATION IS NOT AN UPGRADE PATH. A fresh install gets this index
  // when the table is pushed; an existing one does not, because
  // `drizzleTableToTableSpec` records only names and columns, so index-only
  // drift produces no operations and `reconcileCore` returns early before the
  // push that would create it. SQLite is repaired by the hand-written core
  // DDL in `database/sqlite-core-tables.ts`, which re-runs idempotently;
  // PostgreSQL and MySQL need a general core index-repair step in
  // `nextly upgrade`, which is filed rather than built here — see
  // `schemas/nextly-i18n-archive/ddl.ts` for the same problem solved for one
  // table.
  { name: "nextly_jobs_recent_idx", columns: ["updatedAt"] },
  { name: "nextly_jobs_dedupe_idx", columns: ["dedupeKey"], unique: true },
] as const satisfies readonly CoreIndex<string>[];

export const AUDIT_LOG_INDEXES = [
  { name: "audit_log_kind_idx", columns: ["kind"] },
  { name: "audit_log_actor_user_id_idx", columns: ["actorUserId"] },
  { name: "audit_log_target_user_id_idx", columns: ["targetUserId"] },
  { name: "audit_log_created_at_idx", columns: ["createdAt"] },
] as const satisfies readonly CoreIndex<string>[];

export const ACTIVITY_LOG_INDEXES = [
  { name: "idx_activity_log_created_at", columns: ["createdAt"] },
  { name: "idx_activity_log_collection", columns: ["collection", "createdAt"] },
  { name: "idx_activity_log_user_id", columns: ["userId", "createdAt"] },
] as const satisfies readonly CoreIndex<string>[];

type PgIndexColumn = Parameters<ReturnType<typeof pgIndex>["on"]>[0];
type MysqlIndexColumn = Parameters<ReturnType<typeof mysqlIndex>["on"]>[0];
type SqliteIndexColumn = Parameters<ReturnType<typeof sqliteIndex>["on"]>[0];

/** PostgreSQL index builders for `indexes`, over a table's extra-config columns. */
export function pgIndexes<K extends string>(
  indexes: readonly CoreIndex<K>[],
  table: Record<K, PgIndexColumn>
) {
  return indexes.map(({ name, unique, columns: [head, ...tail] }) =>
    (unique ? pgUniqueIndex : pgIndex)(name).on(
      table[head],
      ...tail.map(key => table[key])
    )
  );
}

/** MySQL index builders for `indexes`, over a table's extra-config columns. */
export function mysqlIndexes<K extends string>(
  indexes: readonly CoreIndex<K>[],
  table: Record<K, MysqlIndexColumn>
) {
  return indexes.map(({ name, unique, columns: [head, ...tail] }) =>
    (unique ? mysqlUniqueIndex : mysqlIndex)(name).on(
      table[head],
      ...tail.map(key => table[key])
    )
  );
}

/** SQLite index builders for `indexes`, over a table's extra-config columns. */
export function sqliteIndexes<K extends string>(
  indexes: readonly CoreIndex<K>[],
  table: Record<K, SqliteIndexColumn>
) {
  return indexes.map(({ name, unique, columns: [head, ...tail] }) =>
    (unique ? sqliteUniqueIndex : sqliteIndex)(name).on(
      table[head],
      ...tail.map(key => table[key])
    )
  );
}
