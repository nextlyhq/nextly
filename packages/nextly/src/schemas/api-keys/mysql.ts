/**
 * API Keys table — MySQL.
 *
 * Single table: apiKeys.
 * Moved verbatim from packages/nextly/src/database/schema/mysql.ts as part of
 * Plan A schemas consolidation. No behavior change.
 *
 * Cross-table `relations()` (apiKeysRelations) lives in `../_dialect-bundles/mysql.relations.ts`
 * and is re-exported at the bottom of this file. See `./postgres.ts` for the
 * rationale.
 *
 * @module schemas/api-keys/mysql
 * @since v0.0.3-alpha (Plan A — schemas consolidation)
 */

import { sql } from "drizzle-orm";
import {
  mysqlTable,
  varchar,
  datetime,
  index,
  uniqueIndex,
  text,
  boolean,
} from "drizzle-orm/mysql-core";

import { roles } from "../rbac/mysql";
import { users } from "../users/mysql";

/**
 * API Keys table for programmatic API authentication (MySQL).
 *
 * See postgres.ts for full documentation. Main differences:
 * - Uses varchar(191) for string IDs (MySQL utf8mb4 index length limit)
 * - Uses datetime instead of timestamp for nullable date columns
 * - Uses boolean for isActive (consistent with users.isActive in MySQL schema)
 */
export const apiKeys = mysqlTable(
  "api_keys",
  {
    id: varchar("id", { length: 191 }).primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    // SHA-256 hex digest — primary lookup column, never the raw key
    keyHash: varchar("key_hash", { length: 64 }).notNull(),
    // First 16 characters of the full key for display
    keyPrefix: varchar("key_prefix", { length: 16 }).notNull(),
    tokenType: varchar("token_type", { length: 20 }).notNull(),
    // onDelete: "set null" — deleted role makes key permission-less (safe 403)
    roleId: varchar("role_id", { length: 191 }).references(() => roles.id, {
      onDelete: "set null",
    }),
    // onDelete: "cascade" — deleting a user removes all their keys
    userId: varchar("user_id", { length: 191 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: datetime("expires_at"),
    lastUsedAt: datetime("last_used_at"),
    isActive: boolean("is_active").notNull().default(true),
    // DDL-side CURRENT_TIMESTAMP (matching postgres's defaultNow()):
    // a JavaScript `new Date()` default bakes one module-load-time literal
    // into the emitted DDL, so every boot saw a different default and v1's
    // differ emitted MODIFY COLUMN churn forever (the pre-v1 MySQL differ
    // returned empty statement lists and masked this).
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  t => [
    uniqueIndex("api_keys_key_hash_unique").on(t.keyHash),
    index("api_keys_user_id_idx").on(t.userId),
    index("api_keys_role_id_idx").on(t.roleId),
    index("api_keys_is_active_expires_at_idx").on(t.isActive, t.expiresAt),
  ]
);
