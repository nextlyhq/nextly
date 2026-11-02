/**
 * The retired `manage-` permission rows, stored as an earlier release seeded
 * them. Nothing seeds them any more, but an install upgraded from that
 * release still has them, and roles holding them, until `nextly upgrade`
 * converts those roles: a test of that install plants them first.
 */
import { randomUUID } from "node:crypto";

import { RETIRED_MANAGE_RESOURCES } from "../../../auth/access/retired-manage-permissions";
import { getDialectTables } from "../../../database/index";

type Db = {
  insert: (table: unknown) => { values: (rows: unknown) => Promise<unknown> };
};

/** Stores `manage-<resource>` on each retired resource, as it was seeded. */
export async function plantRetiredManagePermissions(adapter: {
  getDrizzle: () => unknown;
}): Promise<Map<string, string>> {
  const { permissions } = getDialectTables();
  const rows = RETIRED_MANAGE_RESOURCES.map(resource => ({
    id: randomUUID(),
    name: `Manage ${resource}`,
    slug: `manage-${resource}`,
    action: "manage",
    resource,
  }));
  await (adapter.getDrizzle() as Db).insert(permissions).values(rows);
  return new Map(rows.map(row => [row.slug, row.id]));
}

/**
 * A role holding exactly `permissionIds`, stored through the adapter as an
 * earlier release stored it: every role writer now stores a retired `manage-`
 * permission as the plain four, so only this way keeps one on a role.
 */
export async function plantRole(
  adapter: { getDrizzle: () => unknown },
  slug: string,
  permissionIds: readonly string[]
): Promise<string> {
  const { roles, rolePermissions } = getDialectTables();
  const db = adapter.getDrizzle() as Db;
  const roleId = randomUUID();
  await db.insert(roles).values({
    id: roleId,
    name: slug,
    slug,
    level: 10,
    isSystem: false,
  });
  await db.insert(rolePermissions).values(
    permissionIds.map(permissionId => ({
      id: randomUUID(),
      roleId,
      permissionId,
    }))
  );
  return roleId;
}
