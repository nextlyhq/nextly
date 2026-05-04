import { randomUUID } from "crypto";

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
import { and, eq } from "drizzle-orm";

import type {
  RBACDatabaseInstance,
  RolePermissionInsertData,
} from "@nextly/types/rbac-operations";

import { BaseService } from "../../../services/base-service";
import { invalidatePermissionCache } from "../../../services/lib/permissions";
import type { Logger } from "../../../services/shared";

/**
 * RolePermissionService handles role-permission relationship management.
 *
 * Responsibilities:
 * - Assign permissions to roles
 * - Remove permissions from roles
 * - List all permissions for a role
 * - Invalidate permission cache on changes
 *
 * @example
 * ```typescript
 * const service = new RolePermissionService(adapter, logger);
 * await service.addPermissionToRole(roleId, { action: 'read', resource: 'users' });
 * ```
 */
export class RolePermissionService extends BaseService {
  constructor(adapter: DrizzleAdapter, logger: Logger) {
    super(adapter, logger);
  }

  /**
   * Add a permission to a role.
   *
   * This method wraps both permission creation (if needed) and role-permission assignment
   * in a transaction to ensure atomicity. If any operation fails, all changes are rolled back.
   *
   * Note: This method requires PermissionService to ensure permission exists.
   * Currently calls ensurePermission directly - will be refactored for composition.
   *
   * @param roleId - Role ID to assign permission to
   * @param perm - Permission specification (action, resource, optional name/slug)
   * @returns void
   */
  async addPermissionToRole(
    roleId: string,
    perm: { action: string; resource: string; name?: string; slug?: string }
  ): Promise<void> {
    const permName = perm.name || `${perm.resource}:${perm.action}`;
    const permSlug = perm.slug || `${perm.resource}-${perm.action}`;

    // For now, inline the permission creation logic
    let permissionId: string;

    const existing = await (
      this.db as RBACDatabaseInstance
    ).query.permissions.findFirst({
      where: and(
        eq(this.tables.permissions.action, perm.action),
        eq(this.tables.permissions.resource, perm.resource)
      ),
      columns: {
        id: true,
      },
    });

    if (existing) {
      permissionId = String(existing.id);

      const id = randomUUID();
      const rolePermissionData: RolePermissionInsertData = {
        id,
        roleId,
        permissionId,
      };
      const insert = (this.db as RBACDatabaseInstance)
        .insert(this.tables.rolePermissions)
        .values(rolePermissionData);
      if (typeof insert.onConflictDoNothing === "function") {
        await insert.onConflictDoNothing();
      } else {
        await insert;
      }
    } else {
      const newPermId = randomUUID();
      const rolePermId = randomUUID();

      // Required by Drizzle ORM: transaction callback type varies by dialect and
      // cannot be narrowed without importing internal Drizzle helper types.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await this.db.transaction(async (tx: any) => {
        const permissionData = {
          id: newPermId,
          name: permName,
          slug: permSlug,
          action: perm.action,
          resource: perm.resource,
          description: null,
        };
        const permInsert = tx
          .insert(this.tables.permissions)
          .values(permissionData);
        if (typeof permInsert.onConflictDoNothing === "function") {
          await permInsert.onConflictDoNothing();
        } else {
          await permInsert;
        }

        const rolePermissionData: RolePermissionInsertData = {
          id: rolePermId,
          roleId,
          permissionId: newPermId,
        };
        const rpInsert = tx
          .insert(this.tables.rolePermissions)
          .values(rolePermissionData);
        if (typeof rpInsert.onConflictDoNothing === "function") {
          await rpInsert.onConflictDoNothing();
        } else {
          await rpInsert;
        }
      });

      permissionId = newPermId;
    }

    invalidatePermissionCache({ roleId });
  }

  /**
   * Remove a permission from a role.
   *
   * @param roleId - Role ID to remove permission from
   * @param perm - Permission specification (action, resource)
   * @returns void
   */
  async removePermissionFromRole(
    roleId: string,
    perm: { action: string; resource: string }
  ): Promise<void> {
    const permission = await (
      this.db as RBACDatabaseInstance
    ).query.permissions.findFirst({
      where: and(
        eq(this.tables.permissions.action, perm.action),
        eq(this.tables.permissions.resource, perm.resource)
      ),
      columns: {
        id: true,
      },
    });
    if (!permission) return;

    await (this.db as RBACDatabaseInstance)
      .delete(this.tables.rolePermissions)
      .where(
        and(
          eq(this.tables.rolePermissions.roleId, roleId),
          eq(this.tables.rolePermissions.permissionId, permission.id)
        )
      );

    invalidatePermissionCache({ roleId });
  }

  /**
   * Bulk-set (replace) all permissions for a role.
   *
   * Deletes all existing role-permission assignments for the role, then inserts
   * new assignments for each provided permission ID. This is an atomic replacement:
   * the caller passes the desired final set of permission IDs.
   *
   * @param roleId - Role ID to set permissions for
   * @param permissionIds - The complete desired set of permission IDs
   * @returns Updated array of permission objects with id, action, resource
   */
  async setRolePermissions(
    roleId: string,
    permissionIds: string[]
  ): Promise<Array<{ id: string; action: string; resource: string }>> {
    await (this.db as RBACDatabaseInstance)
      .delete(this.tables.rolePermissions)
      .where(eq(this.tables.rolePermissions.roleId, roleId));

    // Skip if empty — role ends up with no permissions
    if (permissionIds.length > 0) {
      const rows = permissionIds.map(permissionId => ({
        id: randomUUID(),
        roleId,
        permissionId,
      }));
      const insert = (this.db as RBACDatabaseInstance)
        .insert(this.tables.rolePermissions)
        .values(rows);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- onConflictDoNothing is PG/SQLite only, runtime check needed
      if (typeof (insert as any).onConflictDoNothing === "function") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (insert as any).onConflictDoNothing();
      } else {
        await insert;
      }
    }

    invalidatePermissionCache({ roleId });

    return this.listRolePermissions(roleId);
  }

  /**
   * List all permissions assigned to a role.
   *
   * @param roleId - Role ID to list permissions for
   * @returns Array of permission objects with id, action, resource
   */
  async listRolePermissions(
    roleId: string
  ): Promise<Array<{ id: string; action: string; resource: string }>> {
    const rolePermissions = await (
      this.db as RBACDatabaseInstance
    ).query.rolePermissions.findMany({
      where: eq(this.tables.rolePermissions.roleId, roleId),
      with: {
        permission: {
          columns: {
            id: true,
            action: true,
            resource: true,
          },
        },
      },
    });

    return rolePermissions.map(rp => ({
      id: rp.permissionId,
      action: rp.permission!.action,
      resource: rp.permission!.resource,
    }));
  }
}
