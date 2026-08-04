import { randomUUID } from "crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { and, eq } from "drizzle-orm";

import type {
  RBACDatabaseInstance,
  RolePermissionInsertData,
} from "@nextly/types/rbac-operations";

import { permissionName, permissionSlug } from "../../../schemas/_zod/rbac";
import { BaseService } from "../../../services/base-service";
import { invalidatePermissionCache } from "../../../services/lib/permissions";
import type { Logger } from "../../../services/shared";

/**
 * The transaction methods this service calls.
 *
 * `withTransaction` hands back a dialect-specific instance typed `unknown`,
 * because naming all three would bind this file to all three driver packages.
 * Narrowing to what is actually used keeps the body typed without an `any`.
 *
 * `onConflictDoNothing` is optional because only some dialect builders expose
 * it; the call site tests for it before using it.
 */
interface TransactionLike {
  insert(table: unknown): {
    values(data: unknown): Promise<unknown> & {
      onConflictDoNothing?: () => Promise<unknown>;
    };
  };
}

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
    // Composed by the shared helpers rather than written out. This method
    // creates the permission row when the pair has none, and it is reached from
    // the REST surface with neither field supplied — so what these fallbacks
    // produce IS the identity every later authorization check looks up.
    const permName = perm.name || permissionName(perm.action, perm.resource);
    const permSlug = perm.slug || permissionSlug(perm.action, perm.resource);

    let permissionId: string;

    const existing = await (
      this.db as RBACDatabaseInstance
    ).query.permissions.findFirst({
      where: { action: perm.action, resource: perm.resource },
      columns: {
        id: true,
        slug: true,
      },
    });

    if (existing) {
      permissionId = String(existing.id);
      await this.healReversedSlug(permissionId, String(existing.slug), perm);

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

      // `withTransaction`, not Drizzle's `db.transaction`. better-sqlite3 is
      // synchronous and rejects any callback returning a promise, so calling
      // the driver directly threw `Transaction function cannot return a
      // promise` on SQLite — this whole branch, the one that CREATES the
      // permission, was unreachable there. The base-service helper opens
      // `BEGIN IMMEDIATE` on the shared connection for that dialect and uses
      // the native transaction on Postgres and MySQL.
      await this.withTransaction(async txRaw => {
        const tx = txRaw as TransactionLike;
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

    void invalidatePermissionCache({ roleId });
  }

  /**
   * Bring a row written by the reversed composition back onto the convention.
   *
   * An install upgraded from a version that composed `resource-action` still
   * holds those rows, and creating-if-missing never reaches them: identity is
   * `(action, resource)`, so the lookup finds the row and the corrected
   * composition is simply not used. The permission stays one that no
   * authorization check can resolve — which is the original bug, surviving the
   * fix.
   *
   * Renaming is safe here for the reason `ensurePermission` gives for doing the
   * same thing: a slug is a label rather than a key, grants reference the row
   * by id, so bringing a stale one into line renames without revoking.
   *
   * Deliberately narrow. It repairs ONLY a slug that is exactly the reversed
   * composition, and only where the caller supplied none of its own — so a
   * deliberately custom slug (`manage-api-keys` on action `update`, say) is
   * left alone rather than renamed to something its declarer never chose.
   */
  private async healReversedSlug(
    permissionId: string,
    currentSlug: string,
    perm: { action: string; resource: string; slug?: string }
  ): Promise<void> {
    if (perm.slug !== undefined) return;
    const reversed = permissionSlug(perm.resource, perm.action);
    if (currentSlug !== reversed) return;

    const canonical = permissionSlug(perm.action, perm.resource);
    if (canonical === reversed) return;

    await (this.db as RBACDatabaseInstance)
      .update(this.tables.permissions)
      .set({ slug: canonical })
      .where(eq(this.tables.permissions.id, permissionId));
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
      where: { action: perm.action, resource: perm.resource },
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

    void invalidatePermissionCache({ roleId });
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

    void invalidatePermissionCache({ roleId });

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
      where: { roleId: roleId },
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
