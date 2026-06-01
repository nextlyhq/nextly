/**
 * Drizzle `relations()` declarations for the RBAC tables — PostgreSQL.
 *
 * RBAC tables (`roles`, `permissions`, `rolePermissions`, `userRoles`,
 * `roleInherits`, `userPermissionCache`) participate in several many-to-many
 * and inheritance graphs. The relations live here, separate from
 * `rbac/postgres.ts`, so the table-definition file stays free of cross-feature
 * imports (`users`, `apiKeys`).
 *
 * @module schemas/rbac/postgres-relations
 * @since v0.0.3-alpha (Plan A — schemas consolidation, Task 17)
 */

import { relations } from "drizzle-orm";

import { apiKeys } from "../api-keys/postgres";
import { users } from "../users/postgres";

import {
  roles,
  permissions,
  rolePermissions,
  userRoles,
  roleInherits,
} from "./postgres";

/**
 * Role aggregates — every association rooted at the `roles` table.
 *
 * `childInherits` / `parentInherits` use the `roleInherits` self-join with
 * `relationName` keys; both ends are exposed so a UI can render either
 * "roles below this one" or "roles this one inherits from".
 */
export const rolesRelations = relations(roles, ({ many }) => ({
  rolePermissions: many(rolePermissions),
  userRoles: many(userRoles),
  apiKeys: many(apiKeys),
  childInherits: many(roleInherits, { relationName: "parentRole" }),
  parentInherits: many(roleInherits, { relationName: "childRole" }),
}));

/**
 * Permission row → its role-permission grants.
 */
export const permissionsRelations = relations(permissions, ({ many }) => ({
  rolePermissions: many(rolePermissions),
}));

/**
 * Role-permission join row → owning role and permission.
 */
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

/**
 * User-role join row → owning user and role.
 */
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

/**
 * Role-inheritance self-join. `relationName` matches `rolesRelations` so
 * Drizzle can disambiguate the two endpoints on the same source table.
 */
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
