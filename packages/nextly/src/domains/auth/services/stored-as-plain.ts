/**
 * How a role's permissions are stored: a retired `manage-` permission as the
 * plain read, create, update and delete it stood for.
 *
 * Every writer of a role's permissions stores through this, so a module of
 * its own, light enough for the role writers to import without the service
 * that keeps a role's permissions.
 *
 * @module domains/auth/services/stored-as-plain
 */
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import {
  MANAGE_BRIDGED_ACTIONS,
  MANAGE_BRIDGED_RESOURCES,
} from "../../../auth/access/manage-bridge";

/** Whether a permission is a retired `manage-` one: bridged, and stored as the plain four. */
export function isRetiredManage(action: string, resource: string): boolean {
  return action === "manage" && MANAGE_BRIDGED_RESOURCES.includes(resource);
}

/** Where `storedAsPlain` reads permission rows: an adapter or a transaction. */
type PermissionReader = Pick<TransactionContext, "select">;

/** A permission row as `storedAsPlain` reads it. */
type PermissionRow = { id: unknown; action: string; resource: string };

/**
 * The ids of the plain read, create, update and delete on `resource` among
 * `rows`, or none unless all four are there: a retired `manage-` permission
 * is stored as the plain four whole, or kept as it is.
 */
function wholeFour(rows: readonly PermissionRow[], resource: string): string[] {
  const four = rows.filter(
    row =>
      row.resource === resource && MANAGE_BRIDGED_ACTIONS.includes(row.action)
  );
  return MANAGE_BRIDGED_ACTIONS.every(action =>
    four.some(row => row.action === action)
  )
    ? four.map(row => String(row.id))
    : [];
}

/**
 * The ids of the plain four a retired `manage-` permission on `resource` is
 * stored as, or none where one of them is missing and it is kept as it is.
 */
export async function plainFourOn(
  reader: PermissionReader,
  resource: string
): Promise<string[]> {
  const rows = await reader.select<PermissionRow>("permissions", {
    columns: ["id", "action", "resource"],
    where: {
      and: [
        { column: "action", op: "IN", value: [...MANAGE_BRIDGED_ACTIONS] },
        { column: "resource", op: "=", value: resource },
      ],
    },
  });
  return wholeFour(rows, resource);
}

/**
 * The permission ids as a role stores them: each retired `manage-` one
 * replaced by the plain read, create, update and delete on its resource, and
 * every other id as it is. Where a resource lacks one of the plain four, its
 * `manage-` id is kept, so the role loses nothing; the bridge still counts it
 * until `nextly upgrade` converts it once they exist.
 */
export async function storedAsPlain(
  reader: PermissionReader,
  permissionIds: readonly string[],
  maxParams: number
): Promise<string[]> {
  const ids = [...new Set(permissionIds.map(String))];
  if (ids.length === 0) return ids;
  const rows: PermissionRow[] = [];
  for (const batch of batches(ids, maxParams)) {
    rows.push(
      ...(await reader.select<PermissionRow>("permissions", {
        columns: ["id", "action", "resource"],
        where: { and: [{ column: "id", op: "IN", value: batch }] },
      }))
    );
  }
  const retired = rows.filter(row => isRetiredManage(row.action, row.resource));
  if (retired.length === 0) return ids;
  const resources = [...new Set(retired.map(row => row.resource))];
  const plain = await reader.select<PermissionRow>("permissions", {
    columns: ["id", "action", "resource"],
    where: {
      and: [
        { column: "action", op: "IN", value: [...MANAGE_BRIDGED_ACTIONS] },
        { column: "resource", op: "IN", value: resources },
      ],
    },
  });
  const replaced = new Set<string>();
  const added: string[] = [];
  for (const resource of resources) {
    const four = wholeFour(plain, resource);
    if (four.length === 0) continue;
    for (const row of retired) {
      if (row.resource === resource) replaced.add(String(row.id));
    }
    added.push(...four);
  }
  return [...new Set([...ids.filter(id => !replaced.has(id)), ...added])];
}

/** `items` in runs of at most `size`, and never less than one per run. */
export function batches<T>(items: readonly T[], size: number): T[][] {
  const step = Math.max(1, Math.floor(size));
  const runs: T[][] = [];
  for (let start = 0; start < items.length; start += step) {
    runs.push(items.slice(start, start + step));
  }
  return runs;
}
