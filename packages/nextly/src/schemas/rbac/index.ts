/**
 * RBAC tables — dialect-aware barrel.
 *
 * Re-exports per-dialect Drizzle tables (roles, permissions, rolePermissions,
 * userRoles, roleInherits, userPermissionCache) under canonical names. The
 * runtime dialect determines which set of tables a caller sees.
 *
 * Distinct from `schemas/_zod/rbac.ts`, which holds Zod validators
 * (RoleSchema, PermissionSchema, etc.) for the same domain.
 *
 * @module schemas/rbac
 * @since v0.0.3-alpha (Plan A — schemas consolidation)
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import * as my from "./mysql";
import * as pg from "./postgres";
import * as sl from "./sqlite";

export { pg, my, sl };

/**
 * Returns Drizzle table objects for the RBAC feature group, for the requested
 * dialect.
 */
export function rbacTables(dialect: SupportedDialect) {
  switch (dialect) {
    case "postgresql":
      return {
        roles: pg.roles,
        permissions: pg.permissions,
        rolePermissions: pg.rolePermissions,
        userRoles: pg.userRoles,
        roleInherits: pg.roleInherits,
        userPermissionCache: pg.userPermissionCache,
      };
    case "mysql":
      return {
        roles: my.roles,
        permissions: my.permissions,
        rolePermissions: my.rolePermissions,
        userRoles: my.userRoles,
        roleInherits: my.roleInherits,
        userPermissionCache: my.userPermissionCache,
      };
    case "sqlite":
      return {
        roles: sl.roles,
        permissions: sl.permissions,
        rolePermissions: sl.rolePermissions,
        userRoles: sl.userRoles,
        roleInherits: sl.roleInherits,
        userPermissionCache: sl.userPermissionCache,
      };
    default: {
      // Exhaustiveness check — TypeScript flags any missing dialect at compile time.
      const _exhaustive: never = dialect;
      throw new Error(`Unsupported dialect: ${String(_exhaustive)}`);
    }
  }
}
