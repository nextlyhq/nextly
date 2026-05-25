/**
 * RBAC tables — MySQL.
 *
 * Tables: roles, permissions, rolePermissions, userRoles, roleInherits,
 * userPermissionCache.
 * Moved verbatim from packages/nextly/src/database/schema/mysql.ts as part of
 * Plan A schemas consolidation. No behavior change.
 *
 * Note: cross-table `relations()` blocks remain in database/schema/mysql.ts
 * during Plan A — they reference tables that move in later tasks. Relations
 * consolidate in Task 17 once database/schema/ is removed.
 *
 * @module schemas/rbac/mysql
 * @since v0.0.3-alpha (Plan A — schemas consolidation)
 */

import {
  mysqlTable,
  int,
  varchar,
  datetime,
  json,
  index,
  uniqueIndex,
} from "drizzle-orm/mysql-core";

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
