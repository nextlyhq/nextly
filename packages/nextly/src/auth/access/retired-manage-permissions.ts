/**
 * The retired `manage-` permissions: `manage-<resource>` on media, settings,
 * email providers and email templates, each retired in favour of the plain
 * read, create, update and delete on that same resource. No gate counts one
 * any more; a role an earlier release left holding one keeps its access only
 * once `nextly upgrade` has stored the plain four in its place.
 *
 * `manage-background-jobs`, `manage-permissions` and a plugin's own `manage-`
 * permissions are not retired, and mean what they always have.
 *
 * It also says how a role stores a retired one (`storedAsPlain`), so every
 * writer of a role's permissions asks it here, without loading the service
 * that keeps them. It imports nothing but types.
 *
 * @module auth/access/retired-manage-permissions
 */
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

const RETIRED_ON: ReadonlySet<string> = new Set([
  "media",
  "settings",
  "email-providers",
  "email-templates",
]);
const STOOD_FOR: ReadonlySet<string> = new Set([
  "read",
  "create",
  "update",
  "delete",
]);

/**
 * The resources whose `manage-` permission is retired, and the plain actions
 * it stood for there: what a role holding one is converted to, what any
 * writer stores in its place, and what a gate still asking it is answered by.
 */
export const RETIRED_MANAGE_RESOURCES: readonly string[] = [...RETIRED_ON];
export const RETIRED_MANAGE_PLAIN_ACTIONS: readonly string[] = [...STOOD_FOR];

/** Whether a permission is a retired one: `manage-` on one of those resources. */
export function isRetiredManage(action: string, resource: string): boolean {
  return action === "manage" && RETIRED_ON.has(resource);
}

/**
 * Whether `action` on `resource` is one of the plain permissions a retired
 * `manage-` permission stood for. Those resources are no entries and declare
 * no rule, so each such action is a permission alone.
 */
export function isPlainOfRetiredManage(
  action: string,
  resource: string
): boolean {
  return STOOD_FOR.has(action) && RETIRED_ON.has(resource);
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
      row.resource === resource && RETIRED_MANAGE_PLAIN_ACTIONS.includes(row.action)
  );
  return RETIRED_MANAGE_PLAIN_ACTIONS.every(action =>
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
        { column: "action", op: "IN", value: [...RETIRED_MANAGE_PLAIN_ACTIONS] },
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
 * `manage-` id is kept as it is, counting for nothing, until `nextly upgrade`
 * converts it once they exist.
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
        { column: "action", op: "IN", value: [...RETIRED_MANAGE_PLAIN_ACTIONS] },
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
