/**
 * RBAC tables — dialect-aware barrel.
 *
 * Re-exports per-dialect Drizzle tables (roles, permissions, rolePermissions,
 * userRoles, roleInherits) under canonical names. The
 * runtime dialect determines which set of tables a caller sees.
 *
 * Distinct from `schemas/_zod/rbac.ts`, which holds Zod validators
 * (RoleSchema, PermissionSchema, etc.) for the same domain.
 *
 * @module schemas/rbac
 * @since v0.0.3-alpha (Plan A — schemas consolidation)
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { loadedDialect } from "../../database/dialect-tables";

/**
 * Returns Drizzle table objects for the RBAC feature group, for the requested
 * dialect.
 */
export function rbacTables(dialect: SupportedDialect) {
  // The loaded dialect's own tables, so only that dialect's files are
  // imported; `createAdapter` loads them.
  const { roles, permissions, rolePermissions, userRoles, roleInherits } =
    loadedDialect(dialect).tables;
  return { roles, permissions, rolePermissions, userRoles, roleInherits };
}
