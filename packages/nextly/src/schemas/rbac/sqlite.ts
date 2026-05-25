/**
 * RBAC tables — SQLite.
 *
 * Tables: roles, permissions, rolePermissions, userRoles, roleInherits,
 * userPermissionCache.
 * Moved verbatim from packages/nextly/src/database/schema/sqlite.ts as part of
 * Plan A schemas consolidation. No behavior change.
 *
 * Note: cross-table `relations()` blocks remain in database/schema/sqlite.ts
 * during Plan A — they reference tables that move in later tasks. Relations
 * consolidate in Task 17 once database/schema/ is removed.
 *
 * @module schemas/rbac/sqlite
 * @since v0.0.3-alpha (Plan A — schemas consolidation)
 */

import {
  sqliteTable,
  integer,
  text,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { users } from "../users/sqlite";

export const roles = sqliteTable(
  "roles",
  {
    id: text("id").primaryKey(),
    name: text("name", { length: 50 }).notNull(),
    slug: text("slug", { length: 50 }).notNull().unique(),
    description: text("description", { length: 255 }),
    level: integer("level").notNull().default(0),
    isSystem: integer("is_system", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  t => [
    uniqueIndex("roles_name_unique").on(t.name),
    uniqueIndex("roles_slug_unique").on(t.slug),
    // Performance indexes for common query patterns
    index("roles_level_idx").on(t.level), // For hierarchical role queries
    index("roles_is_system_idx").on(t.isSystem), // For filtering system vs custom roles
  ]
);

export const permissions = sqliteTable(
  "permissions",
  {
    id: text("id").primaryKey(),
    name: text("name", { length: 100 }).notNull(),
    slug: text("slug", { length: 100 }).notNull().unique(),
    action: text("action", { length: 50 }).notNull(),
    resource: text("resource", { length: 50 }).notNull(),
    description: text("description", { length: 255 }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  t => [
    uniqueIndex("permissions_action_resource_unique").on(t.action, t.resource),
    uniqueIndex("permissions_slug_unique").on(t.slug),
    index("permissions_resource_idx").on(t.resource),
    index("permissions_action_idx").on(t.action), // For action-based permission lookups
  ]
);

export const rolePermissions = sqliteTable(
  "role_permissions",
  {
    id: text("id").primaryKey(),
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionId: text("permission_id")
      .notNull()
      .references(() => permissions.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  t => [
    uniqueIndex("role_permissions_role_permission_unique").on(
      t.roleId,
      t.permissionId
    ),
    index("role_permissions_role_id_idx").on(t.roleId),
  ]
);

export const userRoles = sqliteTable(
  "user_roles",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    expiresAt: integer("expires_at", { mode: "timestamp" }),
  },
  t => [
    uniqueIndex("user_roles_user_role_unique").on(t.userId, t.roleId),
    index("user_roles_user_id_idx").on(t.userId),
    index("user_roles_expires_at_idx").on(t.expiresAt), // For filtering expired role assignments
  ]
);

export const roleInherits = sqliteTable(
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
 * Permission cache table for denormalized permission storage (SQLite).
 *
 * See postgres.ts for detailed documentation.
 * Main differences:
 * - Uses TEXT instead of JSONB for roleIds field (stored as JSON string)
 * - Uses INTEGER for timestamps (Unix timestamp mode)
 * - Uses INTEGER for boolean hasPermission field (1 = true, 0 = false)
 */
export const userPermissionCache = sqliteTable(
  "user_permission_cache",
  {
    // Composite key: userId|action|resource
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    resource: text("resource").notNull(),
    hasPermission: integer("has_permission", { mode: "boolean" }).notNull(),
    // Store role IDs for invalidation (JSON array stored as text)
    roleIds: text("role_ids").notNull(), // JSON array of strings
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  t => [
    // Primary invalidation path: by user
    index("upc_user_id_idx").on(t.userId),
    // Cleanup expired entries efficiently
    index("upc_expires_at_idx").on(t.expiresAt),
    // Composite index for fast cache lookups
    index("upc_user_action_resource_idx").on(t.userId, t.action, t.resource),
  ]
);
