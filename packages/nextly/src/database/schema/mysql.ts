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
  type AnyMySqlColumn,
} from "drizzle-orm/mysql-core";

import { users, accounts, sessions } from "../../schemas/users/mysql";

// Legacy table — moved to schemas/_legacy/mysql.ts (Plan A Task 13).
// Re-exported here so existing consumers keep working until Plan B removes
// the table entirely via `nextly upgrade`.
export { systemMigrations } from "../../schemas/_legacy/mysql";

// Auth.js v5 compatible tables — moved to schemas/users/mysql.ts (Plan A Task 5).
// Re-exported here so existing consumers and relations() blocks below keep working
// until Task 16 sweeps imports to @nextly/schemas.
export { users, accounts, sessions } from "../../schemas/users/mysql";

// Auth-token tables — moved to schemas/auth-tokens/mysql.ts (Plan A Task 6).
// Re-exported here so existing consumers and relations() blocks below keep working
// until Task 16 sweeps imports to @nextly/schemas.
export {
  verificationTokens,
  emailVerificationTokens,
  passwordResetTokens,
  refreshTokens,
} from "../../schemas/auth-tokens/mysql";
import {
  verificationTokens,
  emailVerificationTokens,
  passwordResetTokens,
  refreshTokens,
} from "../../schemas/auth-tokens/mysql";

// Legacy audit table — moved to schemas/_legacy/mysql.ts (Plan A Task 13).
// Re-exported here so existing consumers keep working until Plan B removes
// the table entirely (superseded by nextly_schema_events).
export { contentSchemaEvents } from "../../schemas/_legacy/mysql";

// Audit tables — moved to schemas/audit/mysql.ts (Plan A Task 9).
// Re-exported here so existing consumers and relations() blocks below keep working
// until Task 16 sweeps imports to @nextly/schemas.
export { auditLog, activityLog } from "../../schemas/audit/mysql";
import { auditLog, activityLog } from "../../schemas/audit/mysql";

// -----------------------------
// RBAC tables (roles/permissions) — moved to schemas/rbac/mysql.ts (Plan A Task 7).
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
} from "../../schemas/rbac/mysql";
import {
  roles,
  permissions,
  rolePermissions,
  userRoles,
  roleInherits,
  userPermissionCache,
} from "../../schemas/rbac/mysql";

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

// apiKeys — moved to schemas/api-keys/mysql.ts (Plan A Task 11).
// Re-exported here so existing consumers and relations() blocks below keep working
// until Task 16 sweeps imports to @nextly/schemas.
export { apiKeys } from "../../schemas/api-keys/mysql";
import { apiKeys } from "../../schemas/api-keys/mysql";

// -----------------------------
// Activity Log
// -----------------------------

// activityLog moved to schemas/audit/mysql.ts (Plan A Task 9) and re-exported
// with auditLog above.

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

// Media tables — moved to schemas/media/mysql.ts (Plan A Task 8).
// Re-exported here so existing consumers and relations() blocks below keep working
// until Task 16 sweeps imports to @nextly/schemas.
export { media, mediaFolders, imageSizes } from "../../schemas/media/mysql";
import { media, mediaFolders, imageSizes } from "../../schemas/media/mysql";

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

// imageSizes moved to schemas/media/mysql.ts (Plan A Task 8) and re-exported
// with the rest of the media tables above.

// Metadata table for tracking dynamic collections.
//
// Plan A Task 12 note: see database/schema/postgres.ts for the rationale —
// the runtime canonical remains this declaration. The diverging
// `dynamicCollectionsMysql` at schemas/dynamic-collections/mysql.ts is left
// in place for the new public-API surface but not aliased here.
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

    // Why: opt-in Draft/Published lifecycle. When true, the runtime injects a
    // `status` system column on the data table and the admin Save Draft /
    // Publish split lights up. Default false keeps existing collections
    // untouched. Mirrors the declaration in
    // schemas/dynamic-collections/mysql.ts so the runtime and canonical
    // descriptors agree on the columns the table actually has.
    status: boolean("status").default(false).notNull(),

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
// 3. The site-settings service can query it via this.tables.siteSettings
export { siteSettingsMysql as siteSettings } from "../../schemas/site-settings/mysql";
export { userFieldDefinitionsMysql as userFieldDefinitions } from "../../schemas/user-field-definitions/mysql";
export { emailProvidersMysql as emailProviders } from "../../schemas/email-providers/mysql";
export { emailTemplatesMysql as emailTemplates } from "../../schemas/email-templates/mysql";

// F8 PR 5: see postgres.ts re-export comment.
export { nextlyMigrationJournalMysql as nextlyMigrationJournal } from "../../schemas/migration-journal/mysql";

// nextlyMeta — moved to schemas/nextly-meta/mysql.ts (Plan A Task 10).
// Re-exported here so existing consumers keep working until Task 16 sweeps
// imports to @nextly/schemas.
export { nextlyMeta } from "../../schemas/nextly-meta/mysql";
