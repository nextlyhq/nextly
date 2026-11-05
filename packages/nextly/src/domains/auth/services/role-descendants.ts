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

import { MAX_ROLE_HIERARCHY_DEPTH, walkRoleGraph } from "./role-graph";

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
  // The starting role is not counted as visited, so a cycle back to it lists
  // it among its own descendants, as a holder of it would then hold it.
  return walkRoleGraph(
    [roleId],
    async batch =>
      (
        await db
          .select({ childRoleId: roleInherits.childRoleId })
          .from(roleInherits)
          .where(inArray(roleInherits.parentRoleId, [...batch]))
      ).map(row => row.childRoleId),
    { seedsVisited: false, limit: MAX_ROLE_HIERARCHY_DEPTH }
  );
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
