/**
 * Audit tables — SQLite.
 *
 * Tables: auditLog, activityLog.
 * Moved verbatim from packages/nextly/src/database/schema/sqlite.ts as part of
 * Plan A schemas consolidation. No behavior change.
 *
 * Cross-table `relations()` (activityLogRelations) lives in
 * `./sqlite-relations.ts` and is re-exported at the bottom of this file. See
 * `./postgres.ts` for the rationale.
 *
 * @module schemas/audit/sqlite
 * @since v0.0.3-alpha (Plan A — schemas consolidation)
 */

import {
  sqliteTable,
  integer,
  text,
  index,
} from "drizzle-orm/sqlite-core";

import { users } from "../users/sqlite";

// Append-only by application convention — operators should revoke
// UPDATE/DELETE GRANTs on this table in production for stricter
// integrity. metadata is JSON-encoded text since SQLite has no native
// JSON column. NULL actor_user_id covers events with no authenticated
// actor (failed login, failed CSRF). NULL target_user_id covers
// non-target events (failed CSRF on a non-account-scoped path).
export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    actorUserId: text("actor_user_id"),
    targetUserId: text("target_user_id"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    metadata: text("metadata"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  t => [
    index("audit_log_kind_idx").on(t.kind),
    index("audit_log_actor_user_id_idx").on(t.actorUserId),
    index("audit_log_target_user_id_idx").on(t.targetUserId),
    index("audit_log_created_at_idx").on(t.createdAt),
  ]
);

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
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    userName: text("user_name").notNull(),
    userEmail: text("user_email").notNull(),
    action: text("action").notNull(), // 'create' | 'update' | 'delete'
    collection: text("collection").notNull(),
    entryId: text("entry_id"),
    entryTitle: text("entry_title"),
    metadata: text("metadata"), // JSON string for additional context
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  t => [
    index("idx_activity_log_created_at").on(t.createdAt),
    index("idx_activity_log_collection").on(t.collection, t.createdAt),
    index("idx_activity_log_user_id").on(t.userId, t.createdAt),
  ]
);

// ---------------------------------------------------------------------------
// Relations re-export — see `./postgres.ts` for the rationale.
// ---------------------------------------------------------------------------
export { activityLogRelations } from "./sqlite-relations";
