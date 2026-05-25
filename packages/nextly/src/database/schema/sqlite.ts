import { relations } from "drizzle-orm";
import {
  sqliteTable,
  integer,
  text,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { users, accounts, sessions } from "../../schemas/users/sqlite";

export const systemMigrations = sqliteTable("system_migrations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  runAt: integer("run_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Auth.js v5 compatible tables — moved to schemas/users/sqlite.ts (Plan A Task 5).
// Re-exported here so existing consumers and relations() blocks below keep working
// until Task 16 sweeps imports to @nextly/schemas.
export { users, accounts, sessions } from "../../schemas/users/sqlite";

// Auth-token tables — moved to schemas/auth-tokens/sqlite.ts (Plan A Task 6).
// Re-exported here so existing consumers and relations() blocks below keep working
// until Task 16 sweeps imports to @nextly/schemas.
export {
  verificationTokens,
  emailVerificationTokens,
  passwordResetTokens,
  refreshTokens,
} from "../../schemas/auth-tokens/sqlite";
import {
  verificationTokens,
  emailVerificationTokens,
  passwordResetTokens,
  refreshTokens,
} from "../../schemas/auth-tokens/sqlite";

// Audit table for dynamic DDL
export const contentSchemaEvents = sqliteTable(
  "content_schema_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    op: text("op").notNull(),
    tableName: text("table_name").notNull(),
    sqlText: text("sql").notNull(),
    meta: text("meta"), // JSON stored as text in SQLite
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  t => [
    index("content_schema_events_created_at_idx").on(t.createdAt),
    index("content_schema_events_table_name_idx").on(t.tableName),
  ]
);

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

// -----------------------------
// RBAC tables (roles/permissions) — moved to schemas/rbac/sqlite.ts (Plan A Task 7).
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
} from "../../schemas/rbac/sqlite";
import {
  roles,
  permissions,
  rolePermissions,
  userRoles,
  roleInherits,
  userPermissionCache,
} from "../../schemas/rbac/sqlite";

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

// -----------------------------
// Activity Log
// -----------------------------

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

// -----------------------------
// Relations
// -----------------------------

// User relations
export const usersRelations = relations(users, ({ many }) => ({
  accounts: many(accounts),
  sessions: many(sessions),
  refreshTokens: many(refreshTokens),
  userRoles: many(userRoles),
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

/**
 * Media table for storing uploaded files and images
 *
 * Supports various storage backends (Vercel Blob, S3, R2, local filesystem)
 * Stores file metadata in database, actual files in configured storage
 *
 * SQLite variant - uses TEXT for timestamps and JSON as text
 */
export const media = sqliteTable(
  "media",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    // File identification
    filename: text("filename").notNull(),
    originalFilename: text("original_filename").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),

    // Image/video dimensions
    width: integer("width"),
    height: integer("height"),
    duration: integer("duration"),

    // Storage URLs
    url: text("url").notNull(),
    thumbnailUrl: text("thumbnail_url"),

    // Crop point for smart image cropping (percentage from top-left, 0-100)
    focalX: integer("focal_x"),
    focalY: integer("focal_y"),

    // Generated image size variants (stored as JSON text)
    sizes: text("sizes"),

    // Metadata
    altText: text("alt_text"),
    caption: text("caption"),
    tags: text("tags"), // SQLite stores JSON as TEXT

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
    uploadedAt: integer("uploaded_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  t => [
    index("media_uploaded_by_idx").on(t.uploadedBy),
    index("media_mime_type_idx").on(t.mimeType),
    index("media_uploaded_at_idx").on(t.uploadedAt),
    index("media_folder_id_idx").on(t.folderId),
  ]
);

export const mediaRelations = relations(media, ({ one }) => ({
  uploader: one(users, {
    fields: [media.uploadedBy],
    references: [users.id],
  }),
  folder: one(mediaFolders, {
    fields: [media.folderId],
    references: [mediaFolders.id],
  }),
}));

// userPermissionCache moved to schemas/rbac/sqlite.ts (Plan A Task 7) and
// re-exported above with the rest of the RBAC tables.

// Metadata table for tracking dynamic collections (SQLite)
export const dynamicCollections = sqliteTable(
  "dynamic_collections",
  {
    id: text("id").primaryKey(),
    // Core identification
    slug: text("slug").notNull().unique(),
    tableName: text("table_name").notNull().unique(),
    description: text("description"),

    // Display configuration (JSON)
    labels: text("labels", { mode: "json" })
      .notNull()
      .$type<{ singular: string; plural: string }>(),

    // Schema definition
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle JSON column with dynamic field definitions
    fields: text("fields", { mode: "json" }).notNull().$type<any[]>(),
    timestamps: integer("timestamps", { mode: "boolean" })
      .notNull()
      .default(true),

    // Why: opt-in Draft/Published lifecycle. When true, the runtime injects a
    // `status` system column on the data table and the admin Save Draft /
    // Publish split lights up. Default false keeps existing collections
    // untouched. Mirrors the declaration in
    // schemas/dynamic-collections/sqlite.ts so the runtime and canonical
    // descriptors agree on the columns the table actually has.
    status: integer("status", { mode: "boolean" }).default(false).notNull(),

    // Admin UI configuration (JSON)
    admin: text("admin", { mode: "json" }).$type<{
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
    source: text("source").notNull().default("ui"), // 'code' | 'ui' | 'built-in'
    locked: integer("locked", { mode: "boolean" }).notNull().default(false),
    configPath: text("config_path"), // For code-first collections

    // Schema versioning
    schemaHash: text("schema_hash").notNull(),
    schemaVersion: integer("schema_version").notNull().default(1),
    migrationStatus: text("migration_status").notNull().default("pending"), // 'synced' | 'pending' | 'generated' | 'applied'
    lastMigrationId: text("last_migration_id"),

    // Access control (JSON)
    accessRules: text("access_rules", { mode: "json" }).$type<{
      create?: { type: string; allowedRoles?: string[] };
      read?: { type: string; allowedRoles?: string[] };
      update?: { type: string; allowedRoles?: string[] };
      delete?: { type: string; allowedRoles?: string[] };
    }>(),

    // Hooks configuration (JSON array)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle JSON column with dynamic hook definitions
    hooks: text("hooks", { mode: "json" }).$type<any[]>(),

    // Ownership and timestamps
    createdBy: text("created_by").references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  t => [
    // Performance indexes for collection queries
    index("dynamic_collections_source_idx").on(t.source),
    index("dynamic_collections_created_by_idx").on(t.createdBy),
    index("dynamic_collections_created_at_idx").on(t.createdAt),
    index("dynamic_collections_updated_at_idx").on(t.updatedAt),
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
export { dynamicSinglesSqlite as dynamicSingles } from "../../schemas/dynamic-singles/sqlite";
export { dynamicComponentsSqlite as dynamicComponents } from "../../schemas/dynamic-components/sqlite";
// General Settings (site_settings singleton table) — needed for pushSchema + SchemaRegistry
export { siteSettingsSqlite as siteSettings } from "../../schemas/general-settings/sqlite";
export { userFieldDefinitionsSqlite as userFieldDefinitions } from "../../schemas/user-field-definitions/sqlite";
export { emailProvidersSqlite as emailProviders } from "../../schemas/email-providers/sqlite";
export { emailTemplatesSqlite as emailTemplates } from "../../schemas/email-templates/sqlite";

/**
 * Media Folders table for organizing media files (SQLite)
 *
 * Supports nested folder hierarchy for better media organization.
 * Folders can contain subfolders and media files.
 */
export const mediaFolders = sqliteTable(
  "media_folders",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    // Folder information
    name: text("name").notNull(),
    description: text("description"),

    // Hierarchy
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parentId: text("parent_id").references((): any => mediaFolders.id, {
      onDelete: "cascade",
    }), // Null for root folders

    // Ownership and timestamps
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  t => [
    index("media_folders_parent_id_idx").on(t.parentId),
    index("media_folders_created_by_idx").on(t.createdBy),
    index("media_folders_created_at_idx").on(t.createdAt),
  ]
);

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
 * Image Sizes table for named image size configurations (SQLite).
 * See postgres.ts for detailed documentation.
 */
export const imageSizes = sqliteTable(
  "image_sizes",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    name: text("name").notNull(),
    width: integer("width"),
    height: integer("height"),
    fit: text("fit").notNull().default("inside"),
    quality: integer("quality").notNull().default(80),
    format: text("format").notNull().default("auto"),
    isDefault: integer("is_default", { mode: "boolean" })
      .notNull()
      .default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  t => [uniqueIndex("image_sizes_name_unique").on(t.name)]
);

// Update usersRelations to include permissionCache
export const usersPermissionCacheRelation = relations(users, ({ many }) => ({
  permissionCache: many(userPermissionCache),
}));

// F8 PR 5: see postgres.ts re-export comment.
export { nextlyMigrationJournalSqlite as nextlyMigrationJournal } from "../../schemas/migration-journal/sqlite";

// nextly_meta — runtime key/value flags table.
// Used for state that doesn't belong in collection schemas. First consumer:
// seed.completedAt / seed.skippedAt for the dashboard SeedDemoContentCard.
// See migration 20260504_000000_nextly_meta.sql.
export const nextlyMeta = sqliteTable(
  "nextly_meta",
  {
    key: text("key").primaryKey(),
    value: text("value"),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  t => [index("nextly_meta_updated_at_idx").on(t.updatedAt)]
);
