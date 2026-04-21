import { relations } from "drizzle-orm";
import {
  mysqlTable,
  int,
  varchar,
  datetime,
  json,
  index,
  uniqueIndex,
  text,
  boolean,
  timestamp,
} from "drizzle-orm/mysql-core";

export const systemMigrations = mysqlTable("system_migrations", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  runAt: datetime("run_at").notNull().default(new Date()),
});

// Auth.js v5 compatible tables
export const users = mysqlTable(
  "users",
  {
    // Auth.js adapters expect string ids; use varchar to ensure compatibility
    id: varchar("id", { length: 191 }).primaryKey(),
    name: varchar("name", { length: 255 }),
    email: varchar("email", { length: 255 }).notNull(),
    emailVerified: datetime("email_verified"),
    passwordUpdatedAt: datetime("password_updated_at"),
    image: varchar("image", { length: 255 }),
    passwordHash: varchar("password_hash", { length: 255 }),
    isActive: boolean("is_active").notNull().default(false),
    // Brute-force protection: tracks failed login attempts and account lockout
    failedLoginAttempts: int("failed_login_attempts").notNull().default(0),
    lockedUntil: datetime("locked_until"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  t => [
    uniqueIndex("users_email_unique").on(t.email),
    index("users_created_at_idx").on(t.createdAt),
  ]
);

export const accounts = mysqlTable(
  "accounts",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: varchar("user_id", { length: 191 }).notNull(),
    type: varchar("type", { length: 191 }).notNull(),
    provider: varchar("provider", { length: 191 }).notNull(),
    providerAccountId: varchar("provider_account_id", {
      length: 191,
    }).notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: int("expires_at"),
    token_type: varchar("token_type", { length: 191 }),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: varchar("session_state", { length: 255 }),
  },
  t => [
    uniqueIndex("accounts_provider_providerAccountId_unique").on(
      t.provider,
      t.providerAccountId
    ),
    index("accounts_user_id_idx").on(t.userId),
  ]
);

export const sessions = mysqlTable(
  "sessions",
  {
    sessionToken: varchar("session_token", { length: 255 }).primaryKey(),
    userId: varchar("user_id", { length: 191 }).notNull(),
    expires: datetime("expires").notNull(),
  },
  t => [index("sessions_user_id_idx").on(t.userId)]
);

export const verificationTokens = mysqlTable(
  "verification_tokens",
  {
    identifier: varchar("identifier", { length: 191 }).notNull(),
    token: varchar("token", { length: 191 }).notNull(),
    expires: datetime("expires").notNull(),
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
export const contentSchemaEvents = mysqlTable(
  "content_schema_events",
  {
    id: int("id").autoincrement().primaryKey(),
    op: varchar("op", { length: 191 }).notNull(),
    tableName: varchar("table_name", { length: 255 }).notNull(),
    sqlText: varchar("sql", { length: 1024 }).notNull(),
    meta: json("meta"),
    createdAt: datetime("created_at").notNull().default(new Date()),
  },
  t => [
    index("content_schema_events_created_at_idx").on(t.createdAt),
    index("content_schema_events_table_name_idx").on(t.tableName),
  ]
);

// Password reset tokens (custom table)
export const passwordResetTokens = mysqlTable(
  "password_reset_tokens",
  {
    id: int("id").autoincrement().primaryKey(),
    identifier: varchar("identifier", { length: 255 }).notNull(),
    tokenHash: varchar("token_hash", { length: 255 }).notNull(),
    expires: datetime("expires").notNull(),
    usedAt: datetime("used_at"),
    createdAt: datetime("created_at").notNull().default(new Date()),
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

// Email verification tokens (custom, hashed)
export const emailVerificationTokens = mysqlTable(
  "email_verification_tokens",
  {
    id: int("id").autoincrement().primaryKey(),
    identifier: varchar("identifier", { length: 255 }).notNull(),
    tokenHash: varchar("token_hash", { length: 255 }).notNull(),
    expires: datetime("expires").notNull(),
    createdAt: datetime("created_at").notNull().default(new Date()),
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
export const refreshTokens = mysqlTable(
  "refresh_tokens",
  {
    id: varchar("id", { length: 191 }).primaryKey(),
    userId: varchar("user_id", { length: 191 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // SHA-256 hex digest of the opaque refresh token (never store raw tokens)
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    // Request metadata for session listing and security auditing
    userAgent: text("user_agent"),
    ipAddress: varchar("ip_address", { length: 45 }),
    expiresAt: datetime("expires_at").notNull(),
    createdAt: datetime("created_at").notNull().default(new Date()),
  },
  t => [
    index("refresh_tokens_token_hash_idx").on(t.tokenHash),
    index("refresh_tokens_user_id_idx").on(t.userId),
    index("refresh_tokens_expires_at_idx").on(t.expiresAt),
  ]
);

// -----------------------------
// RBAC tables (roles/permissions)
// -----------------------------

export const roles = mysqlTable(
  "roles",
  {
    id: varchar("id", { length: 191 }).primaryKey(),
    name: varchar("name", { length: 50 }).notNull(),
    slug: varchar("slug", { length: 50 }).notNull(),
    description: varchar("description", { length: 255 }),
    level: int("level").notNull().default(0),
    isSystem: int("is_system").notNull().default(0),
    createdAt: datetime("created_at").notNull().default(new Date()),
    updatedAt: datetime("updated_at").notNull().default(new Date()),
  },
  t => [
    uniqueIndex("roles_name_unique").on(t.name),
    uniqueIndex("roles_slug_unique").on(t.slug),
    // Performance indexes for common query patterns
    index("roles_level_idx").on(t.level), // For hierarchical role queries
    index("roles_is_system_idx").on(t.isSystem), // For filtering system vs custom roles
  ]
);

export const permissions = mysqlTable(
  "permissions",
  {
    id: varchar("id", { length: 191 }).primaryKey(),
    name: varchar("name", { length: 100 }).notNull(),
    slug: varchar("slug", { length: 100 }).notNull(),
    action: varchar("action", { length: 50 }).notNull(),
    resource: varchar("resource", { length: 50 }).notNull(),
    description: varchar("description", { length: 255 }),
    createdAt: datetime("created_at").notNull().default(new Date()),
    updatedAt: datetime("updated_at").notNull().default(new Date()),
  },
  t => [
    uniqueIndex("permissions_action_resource_unique").on(t.action, t.resource),
    uniqueIndex("permissions_slug_unique").on(t.slug),
    index("permissions_resource_idx").on(t.resource),
    index("permissions_action_idx").on(t.action), // For action-based permission lookups
  ]
);

export const rolePermissions = mysqlTable(
  "role_permissions",
  {
    id: varchar("id", { length: 191 }).primaryKey(),
    roleId: varchar("role_id", { length: 191 }).notNull(),
    permissionId: varchar("permission_id", { length: 191 }).notNull(),
    createdAt: datetime("created_at").notNull().default(new Date()),
  },
  t => [
    uniqueIndex("role_permissions_role_permission_unique").on(
      t.roleId,
      t.permissionId
    ),
    index("role_permissions_role_id_idx").on(t.roleId),
  ]
);

export const userRoles = mysqlTable(
  "user_roles",
  {
    id: varchar("id", { length: 191 }).primaryKey(),
    userId: varchar("user_id", { length: 191 }).notNull(),
    roleId: varchar("role_id", { length: 191 }).notNull(),
    createdAt: datetime("created_at").notNull().default(new Date()),
    expiresAt: datetime("expires_at"),
  },
  t => [
    uniqueIndex("user_roles_user_role_unique").on(t.userId, t.roleId),
    index("user_roles_user_id_idx").on(t.userId),
    index("user_roles_expires_at_idx").on(t.expiresAt), // For filtering expired role assignments
  ]
);

export const roleInherits = mysqlTable(
  "role_inherits",
  {
    id: varchar("id", { length: 191 }).primaryKey(),
    parentRoleId: varchar("parent_role_id", { length: 191 }).notNull(),
    childRoleId: varchar("child_role_id", { length: 191 }).notNull(),
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
 * - By roleId: When role's permissions change (JSON contains query)
 * - TTL expiration: Background cleanup job
 *
 * Performance:
 * - Cache hit: <5ms (indexed lookup)
 * - Target: 60%+ query reduction
 * - Target: 90%+ cache hit rate
 */
export const userPermissionCache = mysqlTable(
  "user_permission_cache",
  {
    // Composite key: userId|action|resource
    id: varchar("id", { length: 255 }).primaryKey(),
    userId: varchar("user_id", { length: 191 }).notNull(),
    action: varchar("action", { length: 50 }).notNull(),
    resource: varchar("resource", { length: 100 }).notNull(),
    hasPermission: int("has_permission").notNull(), // MySQL: 0 or 1 for boolean
    // Store role IDs for invalidation (JSON array of strings)
    roleIds: json("role_ids").$type<string[]>().notNull(),
    expiresAt: datetime("expires_at").notNull(),
    createdAt: datetime("created_at").notNull().default(new Date()),
  },
  t => [
    // Primary invalidation path: by user
    index("upc_user_id_idx").on(t.userId),
    // Cleanup expired entries efficiently
    index("upc_expires_at_idx").on(t.expiresAt),
    // Composite index for fast cache lookups
    index("upc_user_action_resource_idx").on(t.userId, t.action, t.resource),
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
    createdAt: datetime("created_at").notNull().default(new Date()),
    updatedAt: datetime("updated_at").notNull().default(new Date()),
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

/**
 * Media table for storing uploaded files and images
 *
 * Supports various storage backends (Vercel Blob, S3, R2, local filesystem)
 * Stores file metadata in database, actual files in configured storage
 *
 * MySQL variant - uses JSON instead of JSONB for tags
 */
export const media = mysqlTable(
  "media",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    // File identification
    filename: varchar("filename", { length: 255 }).notNull(),
    originalFilename: varchar("original_filename", { length: 255 }).notNull(),
    mimeType: varchar("mime_type", { length: 100 }).notNull(),
    size: int("size").notNull(),

    // Image/video dimensions
    width: int("width"),
    height: int("height"),
    duration: int("duration"),

    // Storage URLs
    url: text("url").notNull(),
    thumbnailUrl: text("thumbnail_url"),

    // Crop point for smart image cropping (percentage from top-left, 0-100)
    focalX: int("focal_x"),
    focalY: int("focal_y"),

    // Generated image size variants (JSON with size name → metadata)
    sizes: json("sizes"),

    // Metadata
    altText: text("alt_text"),
    caption: text("caption"),
    tags: json("tags"), // MySQL uses JSON type for arrays

    // Folder organization (null for root/unorganized files)
    folderId: varchar("folder_id", { length: 255 }).references(
      (): any => mediaFolders.id,
      { onDelete: "set null" }
    ),

    // Ownership and timestamps
    // Nullable: CLI seeds, data imports, and other system-context uploads
    // may not have a user to attribute the upload to.
    uploadedBy: varchar("uploaded_by", { length: 255 }).references(
      () => users.id,
      { onDelete: "cascade" }
    ),
    uploadedAt: datetime("uploaded_at").notNull().default(new Date()),
    updatedAt: datetime("updated_at").notNull().default(new Date()),
  },
  t => [
    index("media_uploaded_by_idx").on(t.uploadedBy),
    index("media_mime_type_idx").on(t.mimeType),
    index("media_uploaded_at_idx").on(t.uploadedAt),
    index("media_folder_id_idx").on(t.folderId),
  ]
);

/**
 * Media Folders table for organizing media files (MySQL)
 */
export const mediaFolders = mysqlTable(
  "media_folders",
  {
    id: varchar("id", { length: 255 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    // Folder information
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),

    // Hierarchy
    parentId: varchar("parent_id", { length: 255 }).references(
      (): any => mediaFolders.id,
      { onDelete: "cascade" }
    ),

    // Ownership and timestamps
    createdBy: varchar("created_by", { length: 191 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: datetime("created_at").notNull().default(new Date()),
    updatedAt: datetime("updated_at").notNull().default(new Date()),
  },
  t => [
    index("media_folders_parent_id_idx").on(t.parentId),
    index("media_folders_created_by_idx").on(t.createdBy),
    index("media_folders_created_at_idx").on(t.createdAt),
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
 * Image Sizes table for named image size configurations (MySQL).
 * See postgres.ts for detailed documentation.
 */
export const imageSizes = mysqlTable(
  "image_sizes",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    name: varchar("name", { length: 50 }).notNull(),
    width: int("width"),
    height: int("height"),
    fit: varchar("fit", { length: 20 }).notNull().default("inside"),
    quality: int("quality").notNull().default(80),
    format: varchar("format", { length: 10 }).notNull().default("auto"),
    isDefault: boolean("is_default").notNull().default(true),
    sortOrder: int("sort_order").notNull().default(0),
    createdAt: datetime("created_at")
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: datetime("updated_at")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  t => [uniqueIndex("image_sizes_name_unique").on(t.name)]
);

// Metadata table for tracking dynamic collections
export const dynamicCollections = mysqlTable(
  "dynamic_collections",
  {
    id: varchar("id", { length: 191 }).primaryKey(),
    // Core identification
    slug: varchar("slug", { length: 100 }).unique().notNull(),
    tableName: varchar("table_name", { length: 255 }).unique().notNull(),
    description: text("description"),

    // Display configuration (JSON)
    labels: json("labels")
      .notNull()
      .$type<{ singular: string; plural: string }>(),

    // Schema definition
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle JSON column with dynamic field definitions
    fields: json("fields").notNull().$type<any[]>(),
    timestamps: boolean("timestamps").notNull().default(true),

    // Admin UI configuration (JSON)
    admin: json("admin").$type<{
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
    schemaVersion: int("schema_version").notNull().default(1),
    migrationStatus: varchar("migration_status", { length: 20 })
      .notNull()
      .default("pending"), // 'synced' | 'pending' | 'generated' | 'applied'
    lastMigrationId: varchar("last_migration_id", { length: 100 }),

    // Access control (JSON)
    accessRules: json("access_rules").$type<{
      create?: { type: string; allowedRoles?: string[] };
      read?: { type: string; allowedRoles?: string[] };
      update?: { type: string; allowedRoles?: string[] };
      delete?: { type: string; allowedRoles?: string[] };
    }>(),

    // Hooks configuration (JSON array)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle JSON column with dynamic hook definitions
    hooks: json("hooks").$type<any[]>(),

    // Ownership and timestamps
    createdBy: varchar("created_by", { length: 191 }).references(
      () => users.id
    ),
    createdAt: datetime("created_at").notNull().default(new Date()),
    updatedAt: datetime("updated_at").notNull().default(new Date()),
  },
  t => [
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
export { dynamicSinglesMysql as dynamicSingles } from "../../schemas/dynamic-singles/mysql";
export { dynamicComponentsMysql as dynamicComponents } from "../../schemas/dynamic-components/mysql";

// -----------------------------
// General Settings (site_settings singleton table)
// -----------------------------
// Re-export from the separate module so that:
// 1. pushSchema() includes it in table creation
// 2. SchemaRegistry registers it for Drizzle query API access
// 3. The general-settings service can query it via this.tables.siteSettings
export { siteSettingsMysql as siteSettings } from "../../schemas/general-settings/mysql";
export { userFieldDefinitionsMysql as userFieldDefinitions } from "../../schemas/user-field-definitions/mysql";
export { emailProvidersMysql as emailProviders } from "../../schemas/email-providers/mysql";
export { emailTemplatesMysql as emailTemplates } from "../../schemas/email-templates/mysql";
