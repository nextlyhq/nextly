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

import { sqliteTable, integer, text, index } from "drizzle-orm/sqlite-core";

// Append-only by application convention. SQLite has no GRANT, so the posture is
// enforced by the application rather than the engine here; on Postgres and MySQL
// the guidance is to revoke DELETE and to scope UPDATE to the three columns an
// erasure touches, because a blanket revoke would make deleting a user fail —
// see the PostgreSQL definition. metadata is JSON-encoded text since SQLite has no native
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
    // When this row's request identifiers were erased, and NULL while they
    // were not. `ip_address` and `user_agent` are nullable for rows that
    // never carried them, so a bare NULL cannot say whether a person was
    // removed or was never recorded — which is the evidence an erasure
    // request needs.
    identityErasedAt: integer("identity_erased_at", { mode: "timestamp" }),
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
    userId: text("user_id").notNull(),
    /**
     * What KIND of caller `user_id` refers to.
     *
     * `user_id` is already documented as "the actor, as an opaque reference
     * that outlives their account" — the name is historical, the meaning is the
     * actor. What it could never say is WHICH KIND, so a write had to be by a
     * signed-in person to be recordable at all: any other actor was refused and
     * left no trace. Imports, API-key writes, job writes and bulk edits were
     * invisible rather than merely unattributed, and nothing about them is
     * recoverable after the fact.
     *
     * With the kind on the row, `user_id` holds a user's id, an API key's own
     * id, or a system caller's name, and the reader knows which. The accountable
     * human is derived rather than stored twice: for a key that is the key's
     * owner, which the keys table holds and outlives this row.
     *
     * NULL on rows written before this existed. Those are all user writes, since
     * no other kind was recordable — a fact about the old gate rather than an
     * assumption, so a reader may read NULL as `"user"`.
     */
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
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    identityErasedAt: integer("identity_erased_at", { mode: "timestamp" }),
  },
  t => [
    index("idx_activity_log_created_at").on(t.createdAt),
    index("idx_activity_log_collection").on(t.collection, t.createdAt),
    index("idx_activity_log_user_id").on(t.userId, t.createdAt),
  ]
);
