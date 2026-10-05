/**
 * Audit tables — SQLite.
 *
 * Tables: auditLog, activityLog.
 * Moved verbatim from packages/nextly/src/database/schema/sqlite.ts as part of
 * Plan A schemas consolidation. No behavior change.
 *
 * Drizzle v2 relations for this feature live centrally in
 * `../_dialect-bundles/sqlite.relations.ts` (defineRelations).
 * `./postgres.ts` for the rationale.
 *
 * @module schemas/audit/sqlite
 * @since v0.0.3-alpha (Plan A — schemas consolidation)
 */

import type { BuildColumns } from "drizzle-orm";
import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";

import {
  ACTIVITY_LOG_INDEXES,
  AUDIT_LOG_INDEXES,
  sqliteIndexes,
} from "../_internal/core-indexes";
import { sqliteTimestamp } from "../_internal/sqlite-timestamp";

// Append-only by application convention. SQLite has no GRANT, so the posture is
// enforced by the application rather than the engine here; on Postgres and MySQL
// the guidance is to revoke DELETE and to scope UPDATE to the three columns an
// erasure touches, because a blanket revoke would make deleting a user fail —
// see the PostgreSQL definition. metadata is JSON-encoded text since SQLite has no native
// JSON column. NULL actor_user_id covers events with no authenticated
// actor (failed login, failed CSRF). NULL target_user_id covers
// non-target events (failed CSRF on a non-account-scoped path).
/** `audit_log` columns, a fresh builder record per call (see `core-table-contributions`). */
export function auditLogColumns() {
  return {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    actorUserId: text("actor_user_id"),
    targetUserId: text("target_user_id"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    metadata: text("metadata"),
    createdAt: sqliteTimestamp("created_at"),
    // When this row's request identifiers were erased, and NULL while they
    // were not. `ip_address` and `user_agent` are nullable for rows that
    // never carried them, so a bare NULL cannot say whether a person was
    // removed or was never recorded — which is the evidence an erasure
    // request needs.
    identityErasedAt: integer("identity_erased_at", { mode: "timestamp" }),
  };
}

/** `audit_log` indexes, from `AUDIT_LOG_INDEXES`. */
export function auditLogExtraConfig(
  t: BuildColumns<"audit_log", ReturnType<typeof auditLogColumns>, "sqlite">
) {
  return sqliteIndexes(AUDIT_LOG_INDEXES, t);
}

// The same tables in another dialect's Drizzle builders: each dialect's
// column functions are distinct, so the declarations cannot be shared.
// fallow-ignore-next-line code-duplication
export const auditLog = sqliteTable(
  "audit_log",
  auditLogColumns(),
  auditLogExtraConfig
);

/** `activity_log` columns, a fresh builder record per call (see `core-table-contributions`). */
export function activityLogColumns() {
  return {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    /** What KIND of caller `user_id` refers to; see the PostgreSQL definition. */
    actorType: text("actor_type"),
    userName: text("user_name"),
    userEmail: text("user_email"),
    action: text("action").notNull(), // 'create' | 'update' | 'delete'
    collection: text("collection").notNull(),
    entryId: text("entry_id"),
    entryTitle: text("entry_title"),
    /** The language this mutation was made in; see `documentRefOf`. */
    locale: text("locale"),
    /** What the row is ABOUT; see `documentRefOf`. NULL on legacy rows. */
    subjectKind: text("subject_kind"),
    metadata: text("metadata"), // JSON string for additional context
    createdAt: sqliteTimestamp("created_at"),
    identityErasedAt: integer("identity_erased_at", { mode: "timestamp" }),
  };
}

/** `activity_log` indexes, from `ACTIVITY_LOG_INDEXES`. */
export function activityLogExtraConfig(
  t: BuildColumns<
    "activity_log",
    ReturnType<typeof activityLogColumns>,
    "sqlite"
  >
) {
  return sqliteIndexes(ACTIVITY_LOG_INDEXES, t);
}

/**
 * Activity log table for recording user actions across all collections (SQLite).
 *
 * See postgres.ts for detailed documentation.
 * Main differences:
 * - Uses TEXT for all string columns (SQLite has no varchar length enforcement)
 * - Uses INTEGER { mode: "timestamp" } for datetime columns
 */
export const activityLog = sqliteTable(
  "activity_log",
  activityLogColumns(),
  activityLogExtraConfig
);
