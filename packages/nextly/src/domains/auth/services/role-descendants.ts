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

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { inArray } from "drizzle-orm";

import { getDialectTables } from "../../../database";

/**
 * The one read the walk makes, as any Drizzle handle or transaction offers it,
 * so the walk can run inside the transaction of the write it decides.
 */
export interface RoleInheritsReader {
  select(fields: unknown): {
    from(table: unknown): {
      where(condition: unknown): PromiseLike<Array<Record<string, unknown>>>;
    };
  };
}

/**
 * Maximum depth for role hierarchy traversal to prevent infinite loops.
 * This safety limit stops BFS traversal after visiting this many roles.
 */
export const MAX_ROLE_HIERARCHY_DEPTH = 2000;

/**
 * All descendant roles (children, grandchildren, etc.) of a role, and whether
 * the walk reached all of them.
 *
 * Breadth-first. The starting role is NOT included, only its descendants.
 * Stops after visiting MAX_ROLE_HIERARCHY_DEPTH roles, so a cycle written
 * around the checks cannot loop forever, and then says so: `complete` is
 * false, and a caller deciding something from the set must not treat a cut
 * short walk as the whole of it.
 */
export async function walkDescendantRoleIds(
  db: RoleInheritsReader,
  dialect: SupportedDialect,
  roleId: string
): Promise<{ ids: string[]; complete: boolean }> {
  // The tables of the database `db` reads, not of the environment's setting.
  const { roleInherits } = getDialectTables(dialect);
  const visited = new Set<string>();
  const queue: string[] = [roleId];

  while (queue.length) {
    const batch = queue.splice(0, 50);
    const inheritances = await db
      .select({ childRoleId: roleInherits.childRoleId })
      .from(roleInherits)
      .where(inArray(roleInherits.parentRoleId, batch));

    for (const r of inheritances) {
      const child = String(r.childRoleId);
      if (!visited.has(child)) {
        visited.add(child);
        queue.push(child);
      }
    }

    // Safety limit to prevent infinite loops
    if (visited.size > MAX_ROLE_HIERARCHY_DEPTH) {
      return { ids: Array.from(visited), complete: false };
    }
  }

  return { ids: Array.from(visited), complete: true };
}

/**
 * All descendant roles of a role, as far as the walk's limit reaches. For
 * listing them; a decision asks {@link walkDescendantRoleIds}, which says when
 * the list is cut short.
 */
export async function listDescendantRoleIds(
  db: RoleInheritsReader,
  dialect: SupportedDialect,
  roleId: string
): Promise<string[]> {
  return (await walkDescendantRoleIds(db, dialect, roleId)).ids;
}
