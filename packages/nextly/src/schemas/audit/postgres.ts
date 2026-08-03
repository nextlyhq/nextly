/**
 * Audit tables — PostgreSQL.
 *
 * Tables: auditLog, activityLog.
 * Moved verbatim from packages/nextly/src/database/schema/postgres.ts as part
 * of Plan A schemas consolidation. No behavior change.
 *
 * Drizzle v2 relations for this feature live centrally in
 * `../_dialect-bundles/postgres.relations.ts` (defineRelations).
 * cross-feature import. Re-exported at the bottom so namespace consumers
 * see it.
 *
 * @module schemas/audit/postgres
 * @since v0.0.3-alpha (Plan A — schemas consolidation)
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  index,
  varchar,
} from "drizzle-orm/pg-core";

// Append-only by application convention — operators should revoke
// UPDATE / DELETE GRANTs on this table in production for stricter
// integrity.
export const auditLog = pgTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    kind: varchar("kind", { length: 64 }).notNull(),
    actorUserId: text("actor_user_id"),
    targetUserId: text("target_user_id"),
    ipAddress: varchar("ip_address", { length: 45 }),
    userAgent: text("user_agent"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: false })
      .defaultNow()
      .notNull(),
    // When this row's request identifiers were erased, and NULL while they
    // were not. `ip_address` and `user_agent` are nullable for rows that
    // never carried them, so a bare NULL cannot say whether a person was
    // removed or was never recorded — which is the evidence an erasure
    // request needs.
    identityErasedAt: timestamp("identity_erased_at", {
      withTimezone: false,
    }),
  },
  t => [
    index("audit_log_kind_idx").on(t.kind),
    index("audit_log_actor_user_id_idx").on(t.actorUserId),
    index("audit_log_target_user_id_idx").on(t.targetUserId),
    index("audit_log_created_at_idx").on(t.createdAt),
  ]
);

/**
 * Activity log table for recording user actions across all collections.
 *
 * Used by the dashboard activity feed to show recent create/update/delete
 * operations. User name and email are denormalized to avoid JOINs on every
 * dashboard load. Entry title is a snapshot at action time.
 *
 * `user_id` carries NO foreign key, deliberately. It is an opaque historical
 * reference to whoever acted, and it has to outlive them: a cascade would let
 * the subject of an audit trail erase it by being deleted, and a restricting
 * constraint would make deleting an account that ever did anything fail
 * outright. The actor's identity is instead erased in place —
 * `eraseActorPersonalData` NULLs `user_name` / `user_email` and stamps
 * `identity_erased_at` — so the audit FACT survives while the personal data
 * does not.
 *
 * `user_name` / `user_email` are therefore nullable: NULL means erased, and
 * `identity_erased_at` records when, which is the evidence an erasure request
 * needs and which a bare NULL cannot supply. It times THIS ROW's erasure
 * rather than the account's deletion: for an entry erased by a deletion the
 * two coincide, because the erasure runs inside that transaction, and for one
 * written after the account was already gone nothing retains when that
 * deletion happened — so naming it for the deletion would put a number in an
 * audit field that no record supports.
 *
 * Retention: 90-day default cleanup via ActivityLogService.cleanupOldActivities()
 */
export const activityLog = pgTable(
  "activity_log",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    userName: text("user_name"),
    userEmail: text("user_email"),
    action: varchar("action", { length: 10 }).notNull(), // 'create' | 'update' | 'delete'
    collection: varchar("collection", { length: 255 }).notNull(),
    entryId: text("entry_id"),
    entryTitle: text("entry_title"),
    metadata: text("metadata"), // JSON string for additional context
    createdAt: timestamp("created_at", { withTimezone: false })
      .defaultNow()
      .notNull(),
    identityErasedAt: timestamp("identity_erased_at", { withTimezone: false }),
  },
  t => [
    index("idx_activity_log_created_at").on(t.createdAt),
    index("idx_activity_log_collection").on(t.collection, t.createdAt),
    index("idx_activity_log_user_id").on(t.userId, t.createdAt),
  ]
);
