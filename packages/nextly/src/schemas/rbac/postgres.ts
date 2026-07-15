/**
 * RBAC tables — PostgreSQL.
 *
 * Tables: roles, permissions, rolePermissions, userRoles, roleInherits,
 * userPermissionCache.
 * Moved verbatim from packages/nextly/src/database/schema/postgres.ts as part
 * of Plan A schemas consolidation. No behavior change.
 *
 * Cross-table `relations()` blocks (rolesRelations, permissionsRelations,
 * rolePermissionsRelations, userRolesRelations, roleInheritsRelations) live
 * in `./postgres-relations.ts` to keep this file free of cross-feature
 * imports (`users`, `apiKeys`). Re-exported at the bottom so namespace
 * consumers see them.
 *
 * The Zod RBAC validators (RoleSchema, PermissionSchema, etc.) live at
 * schemas/_zod/rbac.ts and are unrelated to this file.
 *
 * @module schemas/rbac/postgres
 * @since v0.0.3-alpha (Plan A — schemas consolidation)
 */

import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  index,
  uniqueIndex,
  boolean,
  varchar,
} from "drizzle-orm/pg-core";

import { users } from "../users/postgres";

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
    /**
     * Who declared this permission — a plugin name, or null for the ones the
     * framework seeds per collection and single.
     *
     * Stored rather than guessed. A plugin's custom permission (D36) names a
     * resource that is not a content type, and without provenance the admin
     * inferred one from the slug and drew it as a collection that does not
     * exist. It is also what a future prune would need: a permission can only
     * be retired safely if it is known who stopped declaring it.
     */
    owner: varchar("owner", { length: 191 }),
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
