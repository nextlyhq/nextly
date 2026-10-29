/**
 * The system resources whose `manage-` permission still counts as read,
 * create, update and delete on that same resource: a bridge for installs
 * whose roles were given `manage-<resource>` before every action had a plain
 * permission of its own. It never counts as publish or unpublish, as any
 * other action, or on any other resource, and a collection's `manage-`
 * permission means nothing here.
 *
 * A leaf module, importing nothing but types, so the admin's client-safe
 * copy of this list can be held to it by a test without pulling the access
 * decision's server code into the admin's build. It also says how a role stores a
 * retired `manage-` permission (`storedAsPlain`), so every writer of a role's
 * permissions asks it here, without loading the service that keeps them.
 *
 * @module auth/access/manage-bridge
 */
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

const MANAGE_COUNTS_ON: ReadonlySet<string> = new Set([
  "media",
  "settings",
  "email-providers",
  "email-templates",
]);
const MANAGE_COUNTS_AS: ReadonlySet<string> = new Set([
  "read",
  "create",
  "update",
  "delete",
]);

/**
 * The resources a `manage-` permission is bridged on, and the actions it
 * counts as there: what a role holding one is converted to, and what any
 * writer stores in its place.
 */
export const MANAGE_BRIDGED_RESOURCES: readonly string[] = [
  ...MANAGE_COUNTS_ON,
];
const MANAGE_BRIDGED_ACTIONS: readonly string[] = [...MANAGE_COUNTS_AS];

/** Whether a `manage-` permission on `resource` can count for `action`. */
export function manageCounts(action: string, resource: string): boolean {
  return MANAGE_COUNTS_AS.has(action) && MANAGE_COUNTS_ON.has(resource);
}

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
 * Read inside a writer's transaction as a locking read: the rows are locked
 * for the rest of it and read as they are committed now, not as the
 * transaction's snapshot saw them, so one edited into another permission
 * since is not taken for what it was.
 */
export async function plainFourOnLocked(
  tx: PermissionReader,
  resource: string
): Promise<string[]> {
  const rows = await tx.select<PermissionRow>("permissions", {
    columns: ["id", "action", "resource"],
    forUpdate: true,
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
  maxParams: number,
  lock = false
): Promise<string[]> {
  // A locking read locks what it reads and reads it as committed now.
  const locking = lock ? { forUpdate: true } : {};
  const ids = [...new Set(permissionIds.map(String))];
  if (ids.length === 0) return ids;
  const rows: PermissionRow[] = [];
  for (const batch of batches(ids, maxParams)) {
    rows.push(
      ...(await reader.select<PermissionRow>("permissions", {
        columns: ["id", "action", "resource"],
        ...locking,
        where: { and: [{ column: "id", op: "IN", value: batch }] },
      }))
    );
  }
  const retired = rows.filter(row => isRetiredManage(row.action, row.resource));
  if (retired.length === 0) return ids;
  const resources = [...new Set(retired.map(row => row.resource))];
  const plain = await reader.select<PermissionRow>("permissions", {
    columns: ["id", "action", "resource"],
    ...locking,
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

/**
 * `storedAsPlain` inside a writer's transaction, as locking reads: every
 * permission row it reads, the ids asked for and the plain ones it chooses,
 * is locked for the rest of the transaction and read as it is committed now,
 * not as the transaction's snapshot saw it. A row edited into another
 * permission since an earlier read is stored as it is now, never as it was.
 */
export async function storedAsPlainLocked(
  tx: PermissionReader,
  permissionIds: readonly string[],
  maxParams: number
): Promise<Set<string>> {
  return new Set(await storedAsPlain(tx, permissionIds, maxParams, true));
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
