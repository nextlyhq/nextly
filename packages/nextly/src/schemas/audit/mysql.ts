/**
 * Audit tables — MySQL.
 *
 * Tables: auditLog, activityLog.
 * Moved verbatim from packages/nextly/src/database/schema/mysql.ts as part of
 * Plan A schemas consolidation. No behavior change.
 *
 * Cross-table `relations()` (activityLogRelations) lives in
 * `./mysql-relations.ts` and is re-exported at the bottom of this file. See
 * `./postgres.ts` for the rationale.
 *
 * @module schemas/audit/mysql
 * @since v0.0.3-alpha (Plan A — schemas consolidation)
 */

import {
  mysqlTable,
  varchar,
  datetime,
  json,
  index,
  text,
  timestamp,
} from "drizzle-orm/mysql-core";

import { users } from "../users/mysql";

// Append-only by application convention — operators should revoke
// UPDATE / DELETE GRANTs on this table in production for stricter
// integrity.
export const auditLog = mysqlTable(
  "audit_log",
  {
    id: varchar("id", { length: 191 }).primaryKey(),
    kind: varchar("kind", { length: 64 }).notNull(),
    actorUserId: varchar("actor_user_id", { length: 191 }),
    targetUserId: varchar("target_user_id", { length: 191 }),
    ipAddress: varchar("ip_address", { length: 45 }),
    userAgent: text("user_agent"),
    metadata: json("metadata"),
    createdAt: datetime("created_at").notNull().default(new Date()),
  },
  t => [
    index("audit_log_kind_idx").on(t.kind),
    index("audit_log_actor_user_id_idx").on(t.actorUserId),
    index("audit_log_target_user_id_idx").on(t.targetUserId),
    index("audit_log_created_at_idx").on(t.createdAt),
  ]
);

/**
 * Activity log table for recording user actions across all collections (MySQL).
 *
 * See postgres.ts for detailed documentation.
 * Main differences:
 * - Uses varchar(191) for string IDs (MySQL utf8mb4 index length limit)
 * - Uses datetime for timestamps
 */
export const activityLog = mysqlTable(
  "activity_log",
  {
    id: varchar("id", { length: 191 }).primaryKey(),
    userId: varchar("user_id", { length: 191 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    userName: varchar("user_name", { length: 255 }).notNull(),
    userEmail: varchar("user_email", { length: 255 }).notNull(),
    action: varchar("action", { length: 10 }).notNull(), // 'create' | 'update' | 'delete'
    collection: varchar("collection", { length: 255 }).notNull(),
    entryId: varchar("entry_id", { length: 191 }),
    entryTitle: text("entry_title"),
    metadata: text("metadata"), // JSON string for additional context
    createdAt: timestamp("created_at").defaultNow().notNull(),
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
export { activityLogRelations } from "./mysql-relations";
