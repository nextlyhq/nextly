/**
 * The system resources whose `manage-` permission still counts as read,
 * create, update and delete on that same resource: a bridge for installs
 * whose roles were given `manage-<resource>` before every action had a plain
 * permission of its own. It never counts as publish or unpublish, as any
 * other action, or on any other resource, and a collection's `manage-`
 * permission means nothing here.
 *
 * A leaf module, importing nothing, so the admin's client-safe copy of this
 * list can be held to it by a test without pulling the access decision's
 * server code into the admin's build.
 *
 * @module auth/access/manage-bridge
 */

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

/** Whether a `manage-` permission on `resource` can count for `action`. */
export function manageCounts(action: string, resource: string): boolean {
  return MANAGE_COUNTS_AS.has(action) && MANAGE_COUNTS_ON.has(resource);
}
