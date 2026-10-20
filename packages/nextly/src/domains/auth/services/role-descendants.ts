/**
 * The roles a role inherits, however far down.
 *
 * Its own module so that what asks about inheritance before it writes
 * (`super-admin-grant.ts`) and what writes inheritance
 * (`role-inheritance-service.ts`) share one walk without importing each
 * other.
 *
 * @module domains/auth/services/role-descendants
 */

import type { RBACDatabaseInstance } from "@nextly/types/rbac-operations";

/**
 * Maximum depth for role hierarchy traversal to prevent infinite loops.
 * This safety limit stops BFS traversal after visiting this many roles.
 */
export const MAX_ROLE_HIERARCHY_DEPTH = 2000;

/**
 * All descendant roles (children, grandchildren, etc.) of a role.
 *
 * Breadth-first. The starting role is NOT included, only its descendants.
 * Stops after visiting MAX_ROLE_HIERARCHY_DEPTH roles, so a cycle written
 * around the checks cannot loop forever.
 */
export async function listDescendantRoleIds(
  db: RBACDatabaseInstance,
  roleId: string
): Promise<string[]> {
  const visited = new Set<string>();
  const queue: string[] = [roleId];

  while (queue.length) {
    const batch = queue.splice(0, 50);
    const inheritances = await db.query.roleInherits.findMany({
      where: { parentRoleId: { in: batch } },
      columns: {
        childRoleId: true,
      },
    });

    for (const r of inheritances) {
      const child = String(r.childRoleId);
      if (!visited.has(child)) {
        visited.add(child);
        queue.push(child);
      }
    }

    // Safety limit to prevent infinite loops
    if (visited.size > MAX_ROLE_HIERARCHY_DEPTH) break;
  }

  return Array.from(visited);
}
