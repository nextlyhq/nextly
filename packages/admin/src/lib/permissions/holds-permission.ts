/**
 * Whether a permission list holds a permission, as the server counts it.
 *
 * A permission is held where the list names it, or, on media, settings and
 * the Email hub, where the list names that resource's `manage-` permission,
 * which the server still counts as its read, create, update and delete
 * ({@link manageCountsFor}). Every permission check in the admin asks this, so
 * a role given the plain permissions and a role still holding `manage-` are
 * shown what the server lets each do.
 *
 * @module lib/permissions/holds-permission
 */
import { manageCountsFor } from "./levels";

export function holdsPermission(
  held: ReadonlySet<string>,
  permission: string
): boolean {
  if (held.has(permission)) return true;
  const dash = permission.indexOf("-");
  if (dash === -1) return false;
  const action = permission.slice(0, dash);
  const resource = permission.slice(dash + 1);
  return manageCountsFor(action, resource) && held.has(`manage-${resource}`);
}
