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
 * @module auth/access/retired-manage-permissions
 */

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
