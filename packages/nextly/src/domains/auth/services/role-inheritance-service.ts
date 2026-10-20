import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { and, eq } from "drizzle-orm";

import type {
  DatabaseError,
  RBACDatabaseInstance,
  RoleInheritanceInsertData,
} from "@nextly/types/rbac-operations";

import { BaseService } from "../../../services/base-service";
import type { Logger } from "../../../services/shared";

import { afterRoleGrantsChanged } from "./role-grants-changed";
import {
  listDescendantRoleIds,
  MAX_ROLE_HIERARCHY_DEPTH,
} from "./role-descendants";
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
    // Before the write: the parent comes to confer whatever the child does,
    // so inheriting a role that confers super-admin is giving it.
    await refuseGrantingSuperAdmin(
      this.db as RBACDatabaseInstance,
      [childRoleId],
      {
        parentRoleId,
        childRoleId,
      }
    );
    if (await this.willCreateCycle(childRoleId, parentRoleId))
      throw new Error("INHERIT_CYCLE_FORBIDDEN");

    // Avoid duplicate errors across dialects by pre-checking
    const duplicate = await (
      this.db as RBACDatabaseInstance
    ).query.roleInherits.findFirst({
      where: { parentRoleId: parentRoleId, childRoleId: childRoleId },
      columns: {
        id: true,
      },
    });

    if (!duplicate) {
      const id = `${parentRoleId}::${childRoleId}`;
      try {
        const inheritanceData: RoleInheritanceInsertData = {
          id,
          childRoleId,
          parentRoleId,
        };
        const insert = (this.db as RBACDatabaseInstance)
          .insert(this.tables.roleInherits)
          .values(inheritanceData);
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
    }

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
    await (this.db as RBACDatabaseInstance)
      .delete(this.tables.roleInherits)
      .where(
        and(
          eq(this.tables.roleInherits.childRoleId, childRoleId),
          eq(this.tables.roleInherits.parentRoleId, parentRoleId)
        )
      );

    await afterRoleGrantsChanged(childRoleId);
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
    return listDescendantRoleIds(this.db as RBACDatabaseInstance, roleId);
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
