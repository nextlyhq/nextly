import type { ServiceContainer } from "@nextly/services/index";

import type { Logger } from "../../services/shared";

type RoleService = ServiceContainer["roles"];

/**
 * Create a role a first start seeds: a preset, or one a plugin declares.
 *
 * Processes starting at once each find the role missing and create it; one
 * wins, and the rest fail on its name or slug. The role is then there, so that
 * is logged at debug. A failure that left no role is thrown, for the caller to
 * report as it reports any other.
 */
export async function createSeededRole(
  roleService: RoleService,
  role: Parameters<RoleService["createRole"]>[0],
  logger: Logger
): Promise<void> {
  try {
    await roleService.createRole(role);
  } catch (error) {
    if (!(await roleService.findRoleIdBySlug(role.slug))) throw error;
    logger.debug?.(`Role "${role.slug}" was created by another process`);
  }
}
