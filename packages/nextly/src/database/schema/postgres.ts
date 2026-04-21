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
} from "drizzle-orm/pg-core";

export const systemMigrations = pgTable("system_migrations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  runAt: timestamp("run_at", { withTimezone: false }).defaultNow().notNull(),
});

// Auth.js v5 compatible tables
export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    email: text("email").notNull(),
    emailVerified: timestamp("email_verified", { withTimezone: false }),
    passwordUpdatedAt: timestamp("password_updated_at", {
      withTimezone: false,
    }),
    image: text("image"),
    passwordHash: text("password_hash").notNull(),
    isActive: boolean("is_active").notNull().default(false),
    // Brute-force protection: tracks failed login attempts and account lockout
    failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: false }),
    createdAt: timestamp("created_at", { withTimezone: false })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: false })
      .defaultNow()
      .notNull(),
  },
  t => [
    uniqueIndex("users_email_unique").on(t.email),
    index("users_created_at_idx").on(t.createdAt),
  ]
);

export const accounts = pgTable(
  "accounts",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
    createdAt: timestamp("created_at", { withTimezone: false })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: false })
      .defaultNow()
      .notNull(),
  },
  t => [
    uniqueIndex("accounts_provider_providerAccountId_unique").on(
      t.provider,
      t.providerAccountId
    ),
    index("accounts_user_id_idx").on(t.userId),
  ]
);

export const sessions = pgTable(
  "sessions",
  {
    sessionToken: text("session_token").primaryKey(),
    userId: text("user_id").notNull(),
    expires: timestamp("expires", { withTimezone: false }).notNull(),
  },
  t => [index("sessions_user_id_idx").on(t.userId)]
);

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: false }).notNull(),
  },
  t => [
    uniqueIndex("verification_tokens_identifier_token_pk").on(
      t.identifier,
      t.token
    ),
    index("verification_tokens_token_idx").on(t.token),
  ]
);

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

// Password reset tokens (custom table)
export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: serial("id").primaryKey(),
    identifier: text("identifier").notNull(),
    tokenHash: text("token_hash").notNull(),
    expires: timestamp("expires", { withTimezone: false }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: false }),
    createdAt: timestamp("created_at", { withTimezone: false })
      .defaultNow()
      .notNull(),
  },
  t => [
    uniqueIndex("prt_identifier_token_hash_unique").on(
      t.identifier,
      t.tokenHash
    ),
    index("prt_expires_idx").on(t.expires),
    index("prt_used_at_idx").on(t.usedAt),
  ]
);

// Email verification tokens (custom, hashed) to avoid storing raw tokens
export const emailVerificationTokens = pgTable(
  "email_verification_tokens",
  {
    id: serial("id").primaryKey(),
    identifier: text("identifier").notNull(),
    tokenHash: text("token_hash").notNull(),
    expires: timestamp("expires", { withTimezone: false }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: false })
      .defaultNow()
      .notNull(),
  },
  t => [
    uniqueIndex("evt_identifier_token_hash_unique").on(
      t.identifier,
      t.tokenHash
    ),
    index("evt_expires_idx").on(t.expires),
  ]
);

// Refresh tokens for custom auth session management
// Stores SHA-256 hashed opaque tokens, enables session revocation and token rotation
export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // SHA-256 hex digest of the opaque refresh token (never store raw tokens)
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    // Request metadata for session listing and security auditing
    userAgent: text("user_agent"),
    ipAddress: varchar("ip_address", { length: 45 }),
    expiresAt: timestamp("expires_at", { withTimezone: false }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: false })
      .defaultNow()
      .notNull(),
  },
  t => [
    // Primary lookup: hash incoming token and query by tokenHash
    index("refresh_tokens_token_hash_idx").on(t.tokenHash),
    // Cleanup all tokens for a user on password change or logout-all
    index("refresh_tokens_user_id_idx").on(t.userId),
    // Cleanup expired tokens efficiently
    index("refresh_tokens_expires_at_idx").on(t.expiresAt),
  ]
);

// -----------------------------
// RBAC tables (roles/permissions)
// -----------------------------

export const roles = pgTable(
  "roles",
  {
    id: text("id").primaryKey(),
    name: varchar("name", { length: 50 }).notNull(),
    slug: varchar("slug", { length: 50 }).notNull(),
    description: varchar("description", { length: 255 }),
    level: integer("level").notNull().default(0),
    isSystem: boolean("is_system").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: false })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: false })
      .defaultNow()
      .notNull(),
  },
  t => [
    uniqueIndex("roles_name_unique").on(t.name),
    uniqueIndex("roles_slug_unique").on(t.slug),
    // Performance indexes for common query patterns
    index("roles_level_idx").on(t.level), // For hierarchical role queries
    index("roles_is_system_idx").on(t.isSystem), // For filtering system vs custom roles
  ]
);

export const permissions = pgTable(
  "permissions",
  {
    id: text("id").primaryKey(),
    name: varchar("name", { length: 100 }).notNull(),
    slug: varchar("slug", { length: 100 }).notNull(),
    action: varchar("action", { length: 50 }).notNull(),
    resource: varchar("resource", { length: 50 }).notNull(),
    description: varchar("description", { length: 255 }),
    createdAt: timestamp("created_at", { withTimezone: false })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: false })
      .defaultNow()
      .notNull(),
  },
  t => [
    uniqueIndex("permissions_action_resource_unique").on(t.action, t.resource),
    uniqueIndex("permissions_slug_unique").on(t.slug),
    index("permissions_resource_idx").on(t.resource),
    index("permissions_action_idx").on(t.action), // For action-based permission lookups
  ]
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    id: text("id").primaryKey(),
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionId: text("permission_id")
      .notNull()
      .references(() => permissions.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: false })
      .defaultNow()
      .notNull(),
  },
  t => [
    uniqueIndex("role_permissions_role_permission_unique").on(
      t.roleId,
      t.permissionId
    ),
    index("role_permissions_role_id_idx").on(t.roleId),
  ]
);

export const userRoles = pgTable(
  "user_roles",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: false })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: false }),
  },
  t => [
    uniqueIndex("user_roles_user_role_unique").on(t.userId, t.roleId),
    index("user_roles_user_id_idx").on(t.userId),
    index("user_roles_expires_at_idx").on(t.expiresAt), // For filtering expired role assignments
  ]
);

export const roleInherits = pgTable(
  "role_inherits",
  {
    id: text("id").primaryKey(),
    parentRoleId: text("parent_role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    childRoleId: text("child_role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
  },
  t => [
    uniqueIndex("role_inherits_parent_child_unique").on(
      t.parentRoleId,
      t.childRoleId
    ),
    index("role_inherits_child_idx").on(t.childRoleId),
    index("role_inherits_parent_idx").on(t.parentRoleId), // For bidirectional hierarchy queries
  ]
);

/**
 * Permission cache table for denormalized permission storage.
 *
 * This table stores pre-computed permission check results to reduce
 * database queries and improve performance for permission checking.
 *
 * Cache Strategy:
 * - Tier 1: In-memory LRU cache (10k entries, 60s TTL)
 * - Tier 2: Database cache (this table, 24h TTL default)
 * - Tier 3: Fresh computation from RBAC tables
 *
 * Invalidation:
 * - By userId: When user's roles change
 * - By roleId: When role's permissions change (JSONB contains query)
 * - TTL expiration: Background cleanup job
 *
 * Performance:
 * - Cache hit: <5ms (indexed lookup)
 * - Target: 60%+ query reduction
 * - Target: 90%+ cache hit rate
 */
export const userPermissionCache = pgTable(
  "user_permission_cache",
  {
    // Composite key: userId|action|resource
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    action: varchar("action", { length: 50 }).notNull(),
    resource: varchar("resource", { length: 100 }).notNull(),
    hasPermission: boolean("has_permission").notNull(),
    // Store role IDs for invalidation (JSONB array of strings)
    roleIds: jsonb("role_ids").$type<string[]>().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: false }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: false })
      .defaultNow()
      .notNull(),
  },
  t => [
    // Primary invalidation path: by user
    index("upc_user_id_idx").on(t.userId),
    // Cleanup expired entries efficiently
    index("upc_expires_at_idx").on(t.expiresAt),
    // Composite index for fast cache lookups
    index("upc_user_action_resource_idx").on(t.userId, t.action, t.resource),
    // Note: GIN index on roleIds is added manually in migration SQL
    // for efficient JSONB contains queries used by invalidateByRole()
    // Note: createdAt has no index - it's only for audit/display purposes
  ]
);

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
    // First 16 characters of the full key for display (e.g. "sk_live_abcdefgh")
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

/**
 * Media table for storing uploaded files and images
 *
 * Supports various storage backends (Vercel Blob, S3, R2, local filesystem)
 * Stores file metadata in database, actual files in configured storage
 *
 * @example
 * const media = await db.insert(media).values({
 *   filename: 'abc123.png',
 *   originalFilename: 'profile-photo.png',
 *   mimeType: 'image/png',
 *   size: 102400,
 *   width: 1920,
 *   height: 1080,
 *   url: 'https://blob.vercel-storage.com/abc123.png',
 *   uploadedBy: userId,
 * });
 */
export const media = pgTable(
  "media",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    // File identification
    filename: varchar("filename", { length: 255 }).notNull(), // Stored filename (UUID-based or storage-generated)
    originalFilename: varchar("original_filename", { length: 255 }).notNull(), // User's original filename
    mimeType: varchar("mime_type", { length: 100 }).notNull(), // "image/png", "video/mp4", "application/pdf"
    size: integer("size").notNull(), // File size in bytes

    // Image/video dimensions (null for non-media files)
    width: integer("width"),
    height: integer("height"),
    duration: integer("duration"), // Video duration in seconds

    // Storage URLs
    url: text("url").notNull(), // Public URL to access the file
    thumbnailUrl: text("thumbnail_url"), // Optimized thumbnail URL (300x300)

    // Crop point for smart image cropping (percentage from top-left, 0-100)
    focalX: integer("focal_x"), // Horizontal position (0=left, 100=right)
    focalY: integer("focal_y"), // Vertical position (0=top, 100=bottom)

    // Generated image size variants (JSONB with size name → metadata)
    sizes: jsonb("sizes"),

    // Metadata for accessibility and searchability
    altText: text("alt_text"), // Alt text for images (accessibility)
    caption: text("caption"), // Optional caption/description
    tags: text("tags").array(), // Array of tags for organization and search

    // Folder organization (null for root/unorganized files)
    // Note: FK reference uses arrow function for forward reference since mediaFolders is defined later
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    folderId: text("folder_id").references((): any => mediaFolders.id, {
      onDelete: "set null",
    }),

    // Ownership and timestamps
    // Nullable: CLI seeds, data imports, and other system-context uploads
    // may not have a user to attribute the upload to.
    uploadedBy: text("uploaded_by").references(() => users.id, {
      onDelete: "cascade",
    }),
    uploadedAt: timestamp("uploaded_at", { withTimezone: false })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: false })
      .defaultNow()
      .notNull(),
  },
  t => [
    // Performance indexes for common queries
    index("media_uploaded_by_idx").on(t.uploadedBy), // Filter by uploader
    index("media_mime_type_idx").on(t.mimeType), // Filter by file type (image/*, video/*, etc.)
    index("media_uploaded_at_idx").on(t.uploadedAt), // Sort by upload date
    index("media_tags_idx").on(t.tags), // Search by tags
    index("media_folder_id_idx").on(t.folderId), // Filter by folder
  ]
);

/**
 * Media Folders table for organizing media files
 *
 * Supports nested folder hierarchy for better media organization.
 * Folders can contain subfolders and media files.
 *
 * @example
 * ```typescript
 * // Create a folder
 * await db.insert(mediaFolders).values({
 *   name: 'Product Images',
 *   description: 'All product photos',
 *   createdBy: userId,
 * });
 *
 * // Create a subfolder
 * await db.insert(mediaFolders).values({
 *   name: 'Electronics',
 *   parentId: productImagesId,
 *   createdBy: userId,
 * });
 * ```
 */
export const mediaFolders = pgTable(
  "media_folders",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    // Folder information
    name: varchar("name", { length: 255 }).notNull(), // Folder name
    description: text("description"), // Optional description

    // Hierarchy
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parentId: text("parent_id").references((): any => mediaFolders.id, {
      onDelete: "cascade",
    }), // Null for root folders

    // Ownership and timestamps
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: false })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: false })
      .defaultNow()
      .notNull(),
  },
  t => [
    index("media_folders_parent_id_idx").on(t.parentId), // For querying subfolders
    index("media_folders_created_by_idx").on(t.createdBy), // For filtering by creator
    index("media_folders_created_at_idx").on(t.createdAt), // For sorting by creation date
  ]
);

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

/**
 * Image Sizes table for named image size configurations.
 *
 * Stores configured image sizes (thumbnail, medium, large, etc.) that are
 * generated for every uploaded image. Supports both code-first (synced from
 * nextly.config.ts) and Visual (managed in admin Settings) approaches.
 *
 * @example
 * ```typescript
 * await db.insert(imageSizes).values({
 *   name: 'thumbnail',
 *   width: 150,
 *   height: 150,
 *   fit: 'cover',
 *   quality: 80,
 *   format: 'webp',
 * });
 * ```
 */
export const imageSizes = pgTable(
  "image_sizes",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    // Size definition
    name: varchar("name", { length: 50 }).notNull(), // Unique name (e.g., "thumbnail", "medium", "large")
    width: integer("width"), // Target width in pixels (null = auto, keep aspect ratio)
    height: integer("height"), // Target height in pixels (null = auto, keep aspect ratio)
    fit: varchar("fit", { length: 20 }).notNull().default("inside"), // 'cover' | 'inside' | 'contain' | 'fill'
    quality: integer("quality").notNull().default(80), // Image quality 1-100
    format: varchar("format", { length: 10 }).notNull().default("auto"), // 'auto' | 'webp' | 'jpeg' | 'png' | 'avif'

    // Management flags
    isDefault: boolean("is_default").notNull().default(true), // true = applies to all collections
    sortOrder: integer("sort_order").notNull().default(0), // For UI ordering

    // Timestamps
    createdAt: timestamp("created_at", { withTimezone: false })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: false })
      .defaultNow()
      .notNull(),
  },
  t => [uniqueIndex("image_sizes_name_unique").on(t.name)]
);
