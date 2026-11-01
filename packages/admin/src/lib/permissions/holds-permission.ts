/**
 * Whether a permission list holds a permission, as the server counts it.
 *
 * A permission is held where the list names it. A retired `manage-`
 * permission on media, settings or the Email hub is asked as the server asks
 * it: held only by holding all four plain permissions it stood for, so a role
 * `nextly upgrade` has not converted, holding the retired row alone, is shown
 * none of what it once opened, and a converted role is shown all of it. Every
 * permission check in the admin asks this.
 *
 * The rule is core's own (`auth/access/retired-manage-permissions`), imported
 * from its source: its imports are types alone, so it bundles into the client
 * as plain code.
 *
 * @module lib/permissions/holds-permission
 */
import {
  RETIRED_MANAGE_PLAIN_ACTIONS,
  isRetiredManage,
} from "../../../../nextly/src/auth/access/retired-manage-permissions";

export function holdsPermission(
  held: ReadonlySet<string>,
  permission: string
): boolean {
  const dash = permission.indexOf("-");
  if (dash > 0) {
    const action = permission.slice(0, dash);
    const resource = permission.slice(dash + 1);
    if (isRetiredManage(action, resource)) {
      return RETIRED_MANAGE_PLAIN_ACTIONS.every(plain =>
        held.has(`${plain}-${resource}`)
      );
    }
  }
  return held.has(permission);
}
