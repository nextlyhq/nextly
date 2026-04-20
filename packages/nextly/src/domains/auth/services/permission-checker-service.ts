import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
import { inArray } from "drizzle-orm";

import { BaseService } from "../../../services/base-service";
import type { Logger } from "../../../services/shared";

import { RoleInheritanceService } from "./role-inheritance-service";

/**
 * PermissionCheckerService handles authorization checking logic.
 *
 * Responsibilities:
 * - Get all permissions for a role (direct + inherited)
 * - Check if a user has specific permissions (future)
 * - Batch permission checking (future)
 *
 * This service depends on RoleInheritanceService for traversing role hierarchies.
 *
 * @example
 * ```typescript
 * const service = new PermissionCheckerService(adapter, logger);
 * const permissions = await service.getAllPermissionsForRole(roleId);
 * ```
 */
export class PermissionCheckerService extends BaseService {
  private roleInheritanceService: RoleInheritanceService;

  constructor(adapter: DrizzleAdapter, logger: Logger) {
    super(adapter, logger);
    this.roleInheritanceService = new RoleInheritanceService(adapter, logger);
  }
  /**
   * Get all permissions for a given role (direct + inherited).
   *
   * @param roleId - Role ID to get permissions for
   * @returns Array of permission IDs (deduplicated)
   */
  async getAllPermissionsForRole(roleId: string): Promise<string[]> {
    const childRoleIds =
      await this.roleInheritanceService.listDescendantRoles(roleId);

    const allRoleIds = [roleId, ...childRoleIds];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allPermissions = await (this.db as any)
      .select({
        permissionId: this.tables.rolePermissions.permissionId,
      })
      .from(this.tables.rolePermissions)
      .where(inArray(this.tables.rolePermissions.roleId, allRoleIds));

    const permissionSet = new Set<string>();
    for (const perm of allPermissions) {
      permissionSet.add(String(perm.permissionId));
    }

    return Array.from(permissionSet);
  }
}
