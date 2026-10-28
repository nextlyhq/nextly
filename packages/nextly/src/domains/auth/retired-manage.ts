/**
 * The roles still holding a retired `manage-` permission.
 *
 * `manage-<resource>` on media, settings, email providers and email templates
 * is retired: every writer of a role's permissions stores it as the plain
 * read, create, update and delete there (`storedAsPlain`), and the bridge
 * counts one an earlier release stored for one more release. `nextly upgrade`
 * converts the roles found here, and each start names them until it has.
 *
 * Read through the adapter's own `select`, by table and column name, so one
 * question serves the CLI and the boot on every dialect.
 *
 * @module domains/auth/retired-manage
 */
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import { RETIRED_MANAGE_RESOURCES } from "../../auth/access/retired-manage-permissions";

/** Where the roles are read: an adapter or a transaction. */
type Reader = Pick<TransactionContext, "select">;

/** A role holding a retired `manage-` permission, and which ones, by slug. */
export interface RoleHoldingRetiredManage {
  id: string;
  name: string;
  permissions: string[];
}

/** Every role holding a retired `manage-` permission, by name. */
export async function rolesHoldingRetiredManage(
  reader: Reader
): Promise<RoleHoldingRetiredManage[]> {
  const retired = await reader.select<{ id: unknown; slug: unknown }>(
    "permissions",
    {
      columns: ["id", "slug"],
      where: {
        and: [
          { column: "action", op: "=", value: "manage" },
          {
            column: "resource",
            op: "IN",
            value: [...RETIRED_MANAGE_RESOURCES],
          },
        ],
      },
    }
  );
  if (retired.length === 0) return [];
  const slugOf = new Map(
    retired.map(row => [String(row.id), String(row.slug)])
  );
  const held = await reader.select<{ roleId: unknown; permissionId: unknown }>(
    "role_permissions",
    {
      columns: ["roleId", "permissionId"],
      where: {
        and: [{ column: "permissionId", op: "IN", value: [...slugOf.keys()] }],
      },
    }
  );
  if (held.length === 0) return [];
  const byRole = new Map<string, string[]>();
  for (const row of held) {
    const roleId = String(row.roleId);
    byRole.set(roleId, [
      ...(byRole.get(roleId) ?? []),
      slugOf.get(String(row.permissionId)) ?? "",
    ]);
  }
  const roles = await reader.select<{ id: unknown; name: unknown }>("roles", {
    columns: ["id", "name"],
    where: { and: [{ column: "id", op: "IN", value: [...byRole.keys()] }] },
  });
  return roles
    .map(role => ({
      id: String(role.id),
      name: String(role.name),
      permissions: [...(byRole.get(String(role.id)) ?? [])].sort(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The startup warning naming each role still holding a retired `manage-`
 * permission once, with the command that converts it.
 */
export function formatRetiredManageWarning(
  roles: readonly RoleHoldingRetiredManage[]
): string {
  return [
    "[nextly] These roles hold a retired manage permission, which still counts as read, create, update and delete there for this release only. Run `nextly upgrade` to give each the plain permissions in its place:",
    ...roles.map(role => `  - ${role.name}: ${role.permissions.join(", ")}`),
  ].join("\n");
}
