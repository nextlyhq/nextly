/**
 * Audit tables — MySQL.
 *
 * Tables: auditLog, activityLog.
 * Moved verbatim from packages/nextly/src/database/schema/mysql.ts as part of
 * Plan A schemas consolidation. No behavior change.
 *
 * Drizzle v2 relations for this feature live centrally in
 * `../_dialect-bundles/mysql.relations.ts` (defineRelations).
 * `./postgres.ts` for the rationale.
 *
 * @module schemas/audit/mysql
 * @since v0.0.3-alpha (Plan A — schemas consolidation)
 */

import { sql } from "drizzle-orm";
import {
  mysqlTable,
  varchar,
  datetime,
  json,
  index,
  text,
  timestamp,
} from "drizzle-orm/mysql-core";

// Append-only by application convention, with two exceptions the application
// itself performs and an operator hardening this table has to allow for:
//
//   REVOKE UPDATE, DELETE ON audit_log FROM app_role;
//   GRANT UPDATE (ip_address, user_agent, identity_erased_at)
//     ON audit_log TO app_role;
//   GRANT DELETE ON audit_log TO app_role;
//
// UPDATE, column-scoped: erasing the address and client a deleted account
// connected from is an UPDATE, and it runs inside the deletion's transaction,
// so a blanket revoke makes deleting a user fail. Scoping it to those three
// columns keeps every other one immutable while allowing exactly that erasure.
//
// DELETE: retention needs it. `audit.retention.authMaxAgeMs` prunes rows past
// their window, and a role without DELETE fails every pass silently, since
// retention must never fail the request that offered it — so the table grows
// unbounded while the setting reads as enforced. Revoke it only together with
// `audit: { retention: { authMaxAgeMs: false } }`, so the configuration says
// what the privileges actually do.
//
// The append-only posture and these two duties only look contradictory while
// the grant is all-or-nothing.
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
    // DDL-side CURRENT_TIMESTAMP (matching postgres's defaultNow()):
    // a JavaScript `new Date()` default bakes one module-load-time literal
    // into the emitted DDL, so every boot saw a different default and v1's
    // differ emitted MODIFY COLUMN churn forever (the pre-v1 MySQL differ
    // returned empty statement lists and masked this).
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    // When this row's request identifiers were erased, and NULL while they
    // were not. `ip_address` and `user_agent` are nullable for rows that
    // never carried them, so a bare NULL cannot say whether a person was
    // removed or was never recorded — which is the evidence an erasure
    // request needs.
    // `datetime`, not `timestamp`, for the same reason the activity log's stamp
    // is: a nullable MySQL TIMESTAMP is subject to the server's
    // explicit_defaults_for_timestamp mode, which can rewrite the column and
    // leave the live schema disagreeing with the desired one forever.
    identityErasedAt: datetime("identity_erased_at"),
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
    userId: varchar("user_id", { length: 191 }).notNull(),
    userName: varchar("user_name", { length: 255 }),
    userEmail: varchar("user_email", { length: 255 }),
    action: varchar("action", { length: 10 }).notNull(), // 'create' | 'update' | 'delete'
    collection: varchar("collection", { length: 255 }).notNull(),
    entryId: varchar("entry_id", { length: 191 }),
    entryTitle: text("entry_title"),
    /** The language this mutation was made in; see `documentRefOf`. */
    locale: varchar("locale", { length: 32 }),
    /** What the row is ABOUT; see `documentRefOf`. NULL on legacy rows. */
    subjectKind: varchar("subject_kind", { length: 16 }),
    metadata: text("metadata"), // JSON string for additional context
    createdAt: timestamp("created_at").defaultNow().notNull(),
    // `datetime`, not `timestamp`: a nullable MySQL TIMESTAMP is subject to
    // the server's explicit_defaults_for_timestamp mode, which can rewrite it
    // to NOT NULL DEFAULT CURRENT_TIMESTAMP and make every row read as an
    // erased actor.
    identityErasedAt: datetime("identity_erased_at"),
  },
  t => [
    index("idx_activity_log_created_at").on(t.createdAt),
    index("idx_activity_log_collection").on(t.collection, t.createdAt),
    index("idx_activity_log_user_id").on(t.userId, t.createdAt),
  ]
);
