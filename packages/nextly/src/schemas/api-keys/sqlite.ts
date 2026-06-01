/**
 * API Keys table — SQLite.
 *
 * Single table: apiKeys.
 * Moved verbatim from packages/nextly/src/database/schema/sqlite.ts as part of
 * Plan A schemas consolidation. No behavior change.
 *
 * Cross-table `relations()` (apiKeysRelations) lives in `./sqlite-relations.ts`
 * and is re-exported at the bottom of this file. See `./postgres.ts` for the
 * rationale.
 *
 * @module schemas/api-keys/sqlite
 * @since v0.0.3-alpha (Plan A — schemas consolidation)
 */

import {
  sqliteTable,
  integer,
  text,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { roles } from "../rbac/sqlite";
import { users } from "../users/sqlite";

/**
 * API Keys table for programmatic API authentication (SQLite).
 *
 * See postgres.ts for full documentation. Main differences:
 * - Uses TEXT for all string columns (SQLite has no varchar length enforcement)
 * - Uses INTEGER { mode: "timestamp" } for all datetime columns
 * - Uses INTEGER { mode: "boolean" } for boolean columns
 * - JSON stored as TEXT where applicable
 */
export const apiKeys = sqliteTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    // SHA-256 hex digest — primary lookup column, never the raw key
    keyHash: text("key_hash").notNull(),
    // First 16 characters of the full key for display
    keyPrefix: text("key_prefix").notNull(),
    tokenType: text("token_type").notNull(),
    // onDelete: "set null" — deleted role makes key permission-less (safe 403)
    roleId: text("role_id").references(() => roles.id, {
      onDelete: "set null",
    }),
    // onDelete: "cascade" — deleting a user removes all their keys
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp" }),
    lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  t => [
    uniqueIndex("api_keys_key_hash_unique").on(t.keyHash),
    index("api_keys_user_id_idx").on(t.userId),
    index("api_keys_role_id_idx").on(t.roleId),
    index("api_keys_is_active_expires_at_idx").on(t.isActive, t.expiresAt),
  ]
);
