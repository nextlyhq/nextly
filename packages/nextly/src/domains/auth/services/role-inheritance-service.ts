import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { and, eq } from "drizzle-orm";

import type {
  DatabaseError,
  RBACDatabaseInstance,
  RoleInheritanceInsertData,
} from "@nextly/types/rbac-operations";

import { NextlyError } from "../../../errors";
import { BaseService } from "../../../services/base-service";
import type { Logger } from "../../../services/shared";
import {
  refuseRemovingLastSuperAdmin,
  type LastSuperAdminTx,
} from "../../users/services/last-super-admin";

import {
  listDescendantRoleIds,
  MAX_ROLE_HIERARCHY_DEPTH,
} from "./role-descendants";
import { afterRoleGrantsChanged } from "./role-grants-changed";
import { refuseGrantingSuperAdmin } from "./super-admin-grant";

/**
 * RoleInheritanceService handles role hierarchy management.
 *
 * Responsibilities:
 * - Add parent-child role relationships
 * - Remove role inheritance relationships
 * - List ancestor roles (parents, grandparents, etc.)
 * - List descendant roles (children, grandchildren, etc.)
 * - Prevent circular inheritance (cycle detection)
 *
 * Role hierarchy enables permission inheritance:
 * - Child roles inherit permissions from parent roles
 * - Multi-level inheritance is supported (child → parent → grandparent)
 * - Cycles are forbidden to maintain consistency
 *
 * @example
 * ```typescript
 * const service = new RoleInheritanceService(adapter, logger);
 * await service.addRoleInheritance(childRoleId, parentRoleId);
 * const ancestors = await service.listAncestorRoles(roleId);
 * ```
 */
export class RoleInheritanceService extends BaseService {
  constructor(adapter: DrizzleAdapter, logger: Logger) {
    super(adapter, logger);
  }

  /**
   * Add a parent-child role inheritance relationship.
   *
   * The child role will inherit all permissions from the parent role.
   * Multi-level inheritance is supported.
   *
   * @param childRoleId - Child role ID (inherits from parent)
   * @param parentRoleId - Parent role ID (provides permissions)
   * @throws Error if self-inheritance or cycle would be created
   */
  async addRoleInheritance(
    childRoleId: string,
    parentRoleId: string
  ): Promise<void> {
    if (childRoleId === parentRoleId) throw new Error("INHERIT_SELF_FORBIDDEN");
    await this.refuseEditingSystemRole(parentRoleId);
    if (await this.willCreateCycle(childRoleId, parentRoleId))
      throw new Error("INHERIT_CYCLE_FORBIDDEN");

    // One transaction for the decision and the write. The parent comes to
    // confer whatever the child does, so inheriting a role that confers
    // super-admin is giving it: asked first, under the lock every change to
    // who is a super-admin takes, so no concurrent change lands in between.
    await this.withTransaction(async tx => {
      await refuseGrantingSuperAdmin(
        tx as LastSuperAdminTx,
        this.dialect,
        [childRoleId],
        { parentRoleId, childRoleId }
      );
      const txDb = tx as RBACDatabaseInstance;
      const { roleInherits } = this.tables;

      // Avoid duplicate errors across dialects by pre-checking
      const duplicate = await (tx as LastSuperAdminTx)
        .select({ id: roleInherits.id })
        .from(roleInherits)
        .where(
          and(
            eq(roleInherits.parentRoleId, parentRoleId),
            eq(roleInherits.childRoleId, childRoleId)
          )
        )
        .limit(1);
      if (duplicate.length > 0) return;

      const id = `${parentRoleId}::${childRoleId}`;
      try {
        const inheritanceData: RoleInheritanceInsertData = {
          id,
          childRoleId,
          parentRoleId,
        };
        const insert = txDb.insert(roleInherits).values(inheritanceData);
        if (typeof insert.onConflictDoNothing === "function") {
          await insert.onConflictDoNothing();
        } else {
          await insert;
        }
      } catch (e: unknown) {
        const error = e as DatabaseError;
        const code = String(error?.code || "");
        const msg = String(error?.message || "").toLowerCase();
        if (!(code === "ER_DUP_ENTRY" || msg.includes("duplicate"))) throw e;
      }
    });

    await afterRoleGrantsChanged(childRoleId);
  }

  /**
   * Remove a parent-child role inheritance relationship.
   *
   * @param childRoleId - Child role ID
   * @param parentRoleId - Parent role ID
   */
  async removeRoleInheritance(
    childRoleId: string,
    parentRoleId: string
  ): Promise<void> {
    await this.refuseEditingSystemRole(parentRoleId);
    // In a transaction of its own, under the lock every change to who is a
    // super-admin takes: the role's holders may be super-admins only through
    // this inheritance, and the last of them is kept.
    await this.withTransaction(async tx => {
      await refuseRemovingLastSuperAdmin(
        tx as LastSuperAdminTx,
        this.tables,
        this.dialect,
        { kind: "removeInheritance", parentRoleId, childRoleId }
      );
      await (tx as RBACDatabaseInstance)
        .delete(this.tables.roleInherits)
        .where(
          and(
            eq(this.tables.roleInherits.childRoleId, childRoleId),
            eq(this.tables.roleInherits.parentRoleId, parentRoleId)
          )
        );
    });

    await afterRoleGrantsChanged(childRoleId);
  }

  /**
   * Refuse a change to what a system role inherits.
   *
   * A role's inheritance is part of the role, and a system role is one core
   * seeds and keeps as it is: role update refuses to change one, and this is
   * the same refusal for the inheritance routes.
   *
   * @throws {NextlyError} `forbidden` when `roleId` is a system role.
   */
  private async refuseEditingSystemRole(roleId: string): Promise<void> {
    const { roles } = this.tables;
    const [role] = (await (this.db as LastSuperAdminTx)
      .select({ isSystem: roles.isSystem })
      .from(roles)
      .where(eq(roles.id, roleId))
      .limit(1)) as Array<{ isSystem: unknown }>;
    if (role && Boolean(role.isSystem)) {
      throw NextlyError.builtIn({
        thing: "role",
        change: "change",
        logContext: { reason: "system-role-immutable", roleId },
      });
    }
  }

  /**
   * List all ancestor roles (parents, grandparents, etc.) for a given role.
   *
   * Uses breadth-first traversal to find all roles in the hierarchy above this role.
   * Note: The starting roleId is NOT included in the results - only its ancestors.
   *
   * Safety limit: Stops after visiting MAX_ROLE_HIERARCHY_DEPTH roles to prevent infinite loops.
   *
   * @param roleId - Role ID to find ancestors for
   * @returns Array of ancestor role IDs (excluding the starting roleId)
   */
  async listAncestorRoles(roleId: string): Promise<string[]> {
    const visited = new Set<string>();
    const queue: string[] = [roleId];

    while (queue.length) {
      const batch = queue.splice(0, 50);
      const inheritances = await (
        this.db as RBACDatabaseInstance
      ).query.roleInherits.findMany({
        where: { childRoleId: { in: batch } },
        columns: {
          parentRoleId: true,
        },
      });

      for (const r of inheritances) {
        const parent = String(r.parentRoleId);
        if (!visited.has(parent)) {
          visited.add(parent);
          queue.push(parent);
        }
      }

      // Safety limit to prevent infinite loops
      if (visited.size > MAX_ROLE_HIERARCHY_DEPTH) break;
    }

    return Array.from(visited);
  }

  /**
   * List all descendant roles (children, grandchildren, etc.) for a given role.
   *
   * Uses breadth-first traversal to find all roles in the hierarchy below this role.
   * Note: The starting roleId is NOT included in the results - only its descendants.
   *
   * Safety limit: Stops after visiting MAX_ROLE_HIERARCHY_DEPTH roles to prevent infinite loops.
   *
   * @param roleId - Role ID to find descendants for
   * @returns Array of descendant role IDs (excluding the starting roleId)
   */
  async listDescendantRoles(roleId: string): Promise<string[]> {
    return listDescendantRoleIds(
      this.db as LastSuperAdminTx,
      this.dialect,
      roleId
    );
  }

  private async willCreateCycle(
    childRoleId: string,
    parentRoleId: string
  ): Promise<boolean> {
    // Adding edge child<-parent would create a cycle if child is an ancestor of parent
    const ancestorsOfParent = await this.listAncestorRoles(parentRoleId);
    return ancestorsOfParent.includes(childRoleId);
  }
}
