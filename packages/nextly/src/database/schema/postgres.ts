import { relations } from "drizzle-orm";
import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  jsonb,
  index,
  uniqueIndex,
  boolean,
  varchar,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { users, accounts, sessions } from "../../schemas/users/postgres";

export const systemMigrations = pgTable("system_migrations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  runAt: timestamp("run_at", { withTimezone: false }).defaultNow().notNull(),
});

// Auth.js v5 compatible tables — moved to schemas/users/postgres.ts (Plan A Task 5).
// Re-exported here so existing consumers and relations() blocks below keep working
// until Task 16 sweeps imports to @nextly/schemas.
export { users, accounts, sessions } from "../../schemas/users/postgres";

// Auth-token tables — moved to schemas/auth-tokens/postgres.ts (Plan A Task 6).
// Re-exported here so existing consumers and relations() blocks below keep working
// until Task 16 sweeps imports to @nextly/schemas.
export {
  verificationTokens,
  emailVerificationTokens,
  passwordResetTokens,
  refreshTokens,
} from "../../schemas/auth-tokens/postgres";
import {
  verificationTokens,
  emailVerificationTokens,
  passwordResetTokens,
  refreshTokens,
} from "../../schemas/auth-tokens/postgres";

// Audit table for dynamic DDL
export const contentSchemaEvents = pgTable(
  "content_schema_events",
  {
    id: serial("id").primaryKey(),
    op: text("op").notNull(),
    tableName: text("table_name").notNull(),
    sqlText: text("sql").notNull(),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at", { withTimezone: false })
      .defaultNow()
      .notNull(),
  },
  t => [
    index("content_schema_events_created_at_idx").on(t.createdAt),
    index("content_schema_events_table_name_idx").on(t.tableName),
  ]
);

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
  },
  t => [
    index("audit_log_kind_idx").on(t.kind),
    index("audit_log_actor_user_id_idx").on(t.actorUserId),
    index("audit_log_target_user_id_idx").on(t.targetUserId),
    index("audit_log_created_at_idx").on(t.createdAt),
  ]
);

// -----------------------------
// RBAC tables (roles/permissions) — moved to schemas/rbac/postgres.ts (Plan A Task 7).
// Re-exported here so existing consumers and relations() blocks below keep working
// until Task 16 sweeps imports to @nextly/schemas.
// -----------------------------
export {
  roles,
  permissions,
  rolePermissions,
  userRoles,
  roleInherits,
  userPermissionCache,
} from "../../schemas/rbac/postgres";
import {
  roles,
  permissions,
  rolePermissions,
  userRoles,
  roleInherits,
  userPermissionCache,
} from "../../schemas/rbac/postgres";

/**
 * Field-level permissions table for granular access control.
 *
 * Enables administrators to control access to individual fields within collections,
 * supporting use cases like hiding sensitive data (SSN, salary, private notes)
 * from users without full access rights.
 *
 * Features:
 * - Field-level read/write permissions
 * - Conditional access (ownership, team, custom expressions)
 * - Nested field support (e.g., "user.profile.email")
 * - Works with dynamic collections
 *
 * Performance:
 * - Hybrid caching (in-memory LRU + database cache)
 * - Target: <5ms overhead per query
 * - Composite indexes for fast lookups
 *
 * Security:
 * - Fail-secure by default (deny on error)
 * - Audit logging for denied accesses
 * - Safe expression evaluation (sandboxed)
 */

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

// -----------------------------
// Activity Log
// -----------------------------

/**
 * Activity log table for recording user actions across all collections.
 *
 * Used by the dashboard activity feed to show recent create/update/delete
 * operations. User name and email are denormalized to avoid JOINs on every
 * dashboard load. Entry title is a snapshot at action time.
 *
 * Retention: 90-day default cleanup via ActivityLogService.cleanupOldActivities()
 */
export const activityLog = pgTable(
  "activity_log",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    userName: text("user_name").notNull(),
    userEmail: text("user_email").notNull(),
    action: varchar("action", { length: 10 }).notNull(), // 'create' | 'update' | 'delete'
    collection: varchar("collection", { length: 255 }).notNull(),
    entryId: text("entry_id"),
    entryTitle: text("entry_title"),
    metadata: text("metadata"), // JSON string for additional context
    createdAt: timestamp("created_at", { withTimezone: false })
      .defaultNow()
      .notNull(),
  },
  t => [
    index("idx_activity_log_created_at").on(t.createdAt),
    index("idx_activity_log_collection").on(t.collection, t.createdAt),
    index("idx_activity_log_user_id").on(t.userId, t.createdAt),
  ]
);

// -----------------------------
// Relations
// -----------------------------

// User relations
export const usersRelations = relations(users, ({ many }) => ({
  accounts: many(accounts),
  sessions: many(sessions),
  refreshTokens: many(refreshTokens),
  userRoles: many(userRoles),
  permissionCache: many(userPermissionCache),
  apiKeys: many(apiKeys),
  activityLogs: many(activityLog),
}));

// RefreshToken relations
export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
  user: one(users, {
    fields: [refreshTokens.userId],
    references: [users.id],
  }),
}));

// Account relations
export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, {
    fields: [accounts.userId],
    references: [users.id],
  }),
}));

// Session relations
export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}));

// Role relations
export const rolesRelations = relations(roles, ({ many }) => ({
  rolePermissions: many(rolePermissions),
  userRoles: many(userRoles),
  apiKeys: many(apiKeys),
  childInherits: many(roleInherits, { relationName: "parentRole" }),
  parentInherits: many(roleInherits, { relationName: "childRole" }),
}));

// Permission relations
export const permissionsRelations = relations(permissions, ({ many }) => ({
  rolePermissions: many(rolePermissions),
}));

// RolePermission relations
export const rolePermissionsRelations = relations(
  rolePermissions,
  ({ one }) => ({
    role: one(roles, {
      fields: [rolePermissions.roleId],
      references: [roles.id],
    }),
    permission: one(permissions, {
      fields: [rolePermissions.permissionId],
      references: [permissions.id],
    }),
  })
);

// UserRole relations
export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, {
    fields: [userRoles.userId],
    references: [users.id],
  }),
  role: one(roles, {
    fields: [userRoles.roleId],
    references: [roles.id],
  }),
}));

// RoleInheritance relations
export const roleInheritsRelations = relations(roleInherits, ({ one }) => ({
  parentRole: one(roles, {
    fields: [roleInherits.parentRoleId],
    references: [roles.id],
    relationName: "parentRole",
  }),
  childRole: one(roles, {
    fields: [roleInherits.childRoleId],
    references: [roles.id],
    relationName: "childRole",
  }),
}));

// ApiKey relations
export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  user: one(users, {
    fields: [apiKeys.userId],
    references: [users.id],
  }),
  role: one(roles, {
    fields: [apiKeys.roleId],
    references: [roles.id],
  }),
}));

// ActivityLog relations
export const activityLogRelations = relations(activityLog, ({ one }) => ({
  user: one(users, {
    fields: [activityLog.userId],
    references: [users.id],
  }),
}));

// Metadata table for tracking dynamic collections
export const dynamicCollections = pgTable(
  "dynamic_collections",
  {
    id: text("id").primaryKey(),
    // Core identification
    slug: varchar("slug", { length: 100 }).unique().notNull(),
    tableName: varchar("table_name", { length: 255 }).unique().notNull(),
    description: text("description"),

    // Display configuration (JSON)
    labels: jsonb("labels")
      .notNull()
      .$type<{ singular: string; plural: string }>(),

    // Schema definition
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle JSON column with dynamic field definitions
    fields: jsonb("fields").notNull().$type<any[]>(),
    timestamps: boolean("timestamps").notNull().default(true),

    // Why: opt-in Draft/Published lifecycle. When true, the runtime injects a
    // `status` system column on the data table and the admin Save Draft /
    // Publish split lights up. Default false keeps existing collections
    // untouched. Mirrors the declaration in
    // schemas/dynamic-collections/postgres.ts so the runtime and canonical
    // descriptors agree on the columns the table actually has.
    status: boolean("status").default(false).notNull(),

    // Admin UI configuration (JSON)
    admin: jsonb("admin").$type<{
      group?: string;
      icon?: string;
      hidden?: boolean;
      useAsTitle?: string;
      order?: number;
      sidebarGroup?: string;
      isPlugin?: boolean;
      pagination?: { defaultLimit?: number; limits?: number[] };
    }>(),

    // Source and locking
    source: varchar("source", { length: 20 }).notNull().default("ui"), // 'code' | 'ui' | 'built-in'
    locked: boolean("locked").notNull().default(false),
    configPath: varchar("config_path", { length: 500 }), // For code-first collections

    // Schema versioning
    schemaHash: varchar("schema_hash", { length: 64 }).notNull(),
    schemaVersion: integer("schema_version").notNull().default(1),
    migrationStatus: varchar("migration_status", { length: 20 })
      .notNull()
      .default("pending"), // 'synced' | 'pending' | 'generated' | 'applied'
    lastMigrationId: varchar("last_migration_id", { length: 100 }),

    // Access control (JSON)
    accessRules: jsonb("access_rules").$type<{
      create?: { type: string; allowedRoles?: string[] };
      read?: { type: string; allowedRoles?: string[] };
      update?: { type: string; allowedRoles?: string[] };
      delete?: { type: string; allowedRoles?: string[] };
    }>(),

    // Hooks configuration (JSON array)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle JSON column with dynamic hook definitions
    hooks: jsonb("hooks").$type<any[]>(),

    // Ownership and timestamps
    createdBy: text("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: false })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: false })
      .defaultNow()
      .notNull(),
  },
  t => [
    // Performance indexes for collection queries
    index("dynamic_collections_source_idx").on(t.source), // For filtering by source type
    index("dynamic_collections_created_by_idx").on(t.createdBy), // For filtering by creator
    index("dynamic_collections_created_at_idx").on(t.createdAt), // For sorting by creation date
    index("dynamic_collections_updated_at_idx").on(t.updatedAt), // For sorting by last modified
  ]
);

export const dynamicCollectionsRelations = relations(
  dynamicCollections,
  ({ one }) => ({
    creator: one(users, {
      fields: [dynamicCollections.createdBy],
      references: [users.id],
    }),
  })
);

// -----------------------------
// Dynamic Singles
// -----------------------------
// Re-export the dynamic Singles schema defined in the separate module
export { dynamicSinglesPg as dynamicSingles } from "../../schemas/dynamic-singles/postgres";
export { dynamicComponentsPg as dynamicComponents } from "../../schemas/dynamic-components/postgres";
// General Settings (site_settings singleton table) — needed for pushSchema + SchemaRegistry
export { siteSettingsPg as siteSettings } from "../../schemas/general-settings/postgres";
export { userFieldDefinitionsPg as userFieldDefinitions } from "../../schemas/user-field-definitions/postgres";
export { emailProvidersPg as emailProviders } from "../../schemas/email-providers/postgres";
export { emailTemplatesPg as emailTemplates } from "../../schemas/email-templates/postgres";

// Media tables — moved to schemas/media/postgres.ts (Plan A Task 8).
// Re-exported here so existing consumers and relations() blocks below keep working
// until Task 16 sweeps imports to @nextly/schemas.
export {
  media,
  mediaFolders,
  imageSizes,
} from "../../schemas/media/postgres";
import {
  media,
  mediaFolders,
  imageSizes,
} from "../../schemas/media/postgres";

export const mediaRelations = relations(media, ({ one }) => ({
  uploader: one(users, {
    fields: [media.uploadedBy],
    references: [users.id],
  }),
}));

export const mediaFoldersRelations = relations(
  mediaFolders,
  ({ one, many }) => ({
    createdByUser: one(users, {
      fields: [mediaFolders.createdBy],
      references: [users.id],
    }),
    parentFolder: one(mediaFolders, {
      fields: [mediaFolders.parentId],
      references: [mediaFolders.id],
      relationName: "subfolders",
    }),
    subfolders: many(mediaFolders, {
      relationName: "subfolders",
    }),
    mediaFiles: many(media),
  })
);

// imageSizes moved to schemas/media/postgres.ts (Plan A Task 8) and re-exported
// with the rest of the media tables above.

// F8 PR 5: nextly_migration_journal — records every pipeline apply
// (success/failure/abort) for audit + observability. Distinct from
// `nextly_migrations` (which is the file-based migration ledger
// powering `nextly migrate`). Defined in
// schemas/migration-journal/postgres.ts; re-exported here so
// getDialectTables() picks it up and ensureCoreTables creates it
// at first boot.
export { nextlyMigrationJournalPg as nextlyMigrationJournal } from "../../schemas/migration-journal/postgres";

// nextly_meta — runtime key/value flags table.
// Used for state that doesn't belong in collection schemas. First consumer:
// seed.completedAt / seed.skippedAt for the dashboard SeedDemoContentCard.
// See migration 20260504_000000_nextly_meta.sql.
export const nextlyMeta = pgTable(
  "nextly_meta",
  {
    key: text("key").primaryKey(),
    value: jsonb("value"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  t => [index("nextly_meta_updated_at_idx").on(t.updatedAt)]
);
