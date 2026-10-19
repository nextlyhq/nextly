/**
 * What a fixture database needs before it creates accounts through
 * `createLocalUser`.
 *
 * Creating an account asks whether the install already has an administrator:
 * while nobody holds `super-admin`, directly or through a role that inherits
 * it, an account the app provisions becomes the first one. Answering that
 * reads `roles`, `user_roles` and `role_inherits`, which every installed
 * database has, so a fixture that builds only the tables its own case needs
 * still has to carry these.
 *
 * And a fixture whose accounts must NOT become administrators — so that
 * deleting or demoting one is not refused as the last administrator — makes
 * an account of its own the administrator first. A user row alone no longer
 * does that: the question is who holds the role, not whether anybody exists.
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import {
  roleInherits as roleInheritsSqlite,
  roles as rolesSqlite,
  userRoles as userRolesSqlite,
} from "../../../schemas/rbac/sqlite";
import { ServiceContainer } from "../../../services/index";

/**
 * The SQLite tables account creation reads to find the install's
 * administrator, from the production schema, to spread into a fixture's
 * drizzle-kit table set. One list, so a fixture cannot carry some of them and
 * miss another.
 */
export const ADMINISTRATOR_TABLES_SQLITE = {
  roles: rolesSqlite,
  userRoles: userRolesSqlite,
  roleInherits: roleInheritsSqlite,
};

/**
 * Make an existing account the install's administrator, the way an install's
 * first account was made one: the `super-admin` role ensured, then assigned.
 */
export async function makeAdministrator(
  adapter: DrizzleAdapter,
  userId: string
): Promise<void> {
  const services = new ServiceContainer(adapter);
  const { id: roleId } = await services.roles.ensureSuperAdminRole();
  const assigned = await services.userRoles.assignRoleToUser(userId, roleId);
  if (!assigned.success) {
    throw new Error(
      `could not make ${userId} the administrator: ${assigned.message}`
    );
  }
}
