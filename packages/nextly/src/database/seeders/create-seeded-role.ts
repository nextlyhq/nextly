import type { ServiceContainer } from "@nextly/services/index";

import { isRoleConflict } from "../../domains/auth/services/role/role-mutation-service";
import type { Logger } from "../../services/shared";

type RoleService = ServiceContainer["roles"];

/**
 * Create a role a first start seeds: a preset, or one a plugin declares.
 *
 * Processes starting at once each find the role missing and create it; one
 * wins, and the rest fail on its name or slug. Only that failure, a role
 * conflict, with the role now there under this slug, is another process's
 * success, and it is logged at debug, by `createRole` too. Anything else is
 * thrown for the caller to report as it reports any other: a role this call
 * itself saved before failing to grant its permissions is not a success,
 * whatever a lookup by slug would find.
 */
export async function createSeededRole(
  roleService: RoleService,
  role: Parameters<RoleService["createRole"]>[0],
  logger: Logger
): Promise<void> {
  try {
    await roleService.createRole(role, { quietOnConflict: true });
  } catch (error) {
    if (!isRoleConflict(error)) throw error;
    if (!(await roleService.findRoleIdBySlug(role.slug))) throw error;
    logger.debug?.(`Role "${role.slug}" was created by another process`);
  }
}
