/**
 * API Keys table — PostgreSQL.
 *
 * Single table: apiKeys.
 * Moved verbatim from packages/nextly/src/database/schema/postgres.ts as part
 * of Plan A schemas consolidation. No behavior change.
 *
 * Drizzle v2 relations for this feature live centrally in
 * `../_dialect-bundles/postgres.relations.ts` (defineRelations).
 * (`users`, `roles`). Re-exported at the bottom so namespace consumers see it.
 *
 * @module schemas/api-keys/postgres
 * @since v0.0.3-alpha (Plan A — schemas consolidation)
 */

import {
  pgTable,
  text,
  timestamp,
  index,
  uniqueIndex,
  boolean,
  varchar,
} from "drizzle-orm/pg-core";

import { roles } from "../rbac/postgres";
import { users } from "../users/postgres";

/**
 * API Keys table for programmatic API authentication.
 *
 * Security invariants:
 * - Raw key values are NEVER stored. Only the SHA-256 hex digest (keyHash) is persisted.
 * - The full key is generated and returned exactly once (on creation), then discarded.
 * - Lookups are performed by hashing the incoming key and querying by keyHash.
 * - SHA-256 is used instead of bcrypt because API keys are 256-bit random strings —
 *   their entropy is the security guarantee, not the hash function. bcrypt's intentional
 *   slowness (~100ms) would add unacceptable latency to every API request. This is the
 *   same approach used by GitHub personal access tokens and Stripe API keys.
 *
 * Token types:
 * - "read-only"   — resolves to creator's read-* permissions only
 * - "full-access" — resolves to creator's full permission set (at request time)
 * - "role-based"  — resolves to the referenced role's permissions (at request time)
 *
 * Revocation:
 * - Keys are revoked by setting isActive = false (soft delete). Rows are never hard-deleted,
 *   preserving the audit trail (name, type, creator, last-used).
 */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    // Human-readable label, e.g. "Frontend App Key"
    name: varchar("name", { length: 255 }).notNull(),
    // Optional documentation about this key's intended use
    description: text("description"),
    // SHA-256 hex digest of the full key — primary lookup column, never the raw key
    keyHash: varchar("key_hash", { length: 64 }).notNull(),
    // First 16 characters of the full key for display (e.g. "nx_live_abcdefgh")
    keyPrefix: varchar("key_prefix", { length: 16 }).notNull(),
    // Token type determines permission resolution strategy at request time
    tokenType: varchar("token_type", { length: 20 }).notNull(),
    // FK to roles table — only set when tokenType = "role-based"
    // onDelete: "set null" — if the role is deleted, the key becomes permission-less (safe 403)
    // rather than auto-revoked, preserving the audit trail. The service returns [] permissions
    // for a role-based key with a null roleId.
    roleId: text("role_id").references(() => roles.id, {
      onDelete: "set null",
    }),
    // FK to users table — the user who created this key
    // onDelete: "cascade" — deleting a user removes all their keys
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Token expiry — null means Unlimited
    expiresAt: timestamp("expires_at", { withTimezone: false }),
    // Updated asynchronously (fire-and-forget, no await) on each valid authenticated request
    lastUsedAt: timestamp("last_used_at", { withTimezone: false }),
    // false = revoked (soft delete — row is preserved for audit trail)
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: false })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: false })
      .defaultNow()
      .notNull(),
  },
  t => [
    // Primary request-time lookup: hash the incoming key and query by keyHash
    uniqueIndex("api_keys_key_hash_unique").on(t.keyHash),
    // List all keys created by a specific user
    index("api_keys_user_id_idx").on(t.userId),
    // Find all keys affected when a role's permissions change (for cache invalidation)
    index("api_keys_role_id_idx").on(t.roleId),
    // Filter active/non-expired keys efficiently (primary validity check path)
    index("api_keys_is_active_expires_at_idx").on(t.isActive, t.expiresAt),
  ]
);
