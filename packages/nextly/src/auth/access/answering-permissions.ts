/**
 * The permissions that hold an action on a resource, as the access decision
 * counts them, for the gates that compare stored permissions themselves: a
 * key's stored slugs, a signed-in user's permission rows.
 *
 * The decision counts a system resource's `manage-` permission as its read,
 * create, update and delete ({@link manageCounts}). A gate that matches
 * permissions by name rather than asking the decision counts it here, so no
 * gate answers a `manage-` holder otherwise.
 *
 * @module auth/access/answering-permissions
 */
import { permissionSlug } from "../../schemas/_zod/rbac";

import { manageCounts } from "./manage-bridge";

/** One permission, as `action` on `resource`. */
export interface AnsweringPermission {
  readonly action: string;
  readonly resource: string;
}

/**
 * The permissions any one of which holds `action` on `resource`: the
 * permission itself and, on a system resource, that resource's `manage-`
 * permission.
 */
export function answeringPermissions(
  action: string,
  resource: string
): AnsweringPermission[] {
  return manageCounts(action, resource)
    ? [
        { action, resource },
        { action: "manage", resource },
      ]
    : [{ action, resource }];
}

/** Whether a key's stored slugs name any permission holding the action. */
export function storedSlugHolds(
  stored: readonly string[],
  action: string,
  resource: string
): boolean {
  return answeringPermissions(action, resource).some(permission =>
    stored.includes(permissionSlug(permission.action, permission.resource))
  );
}
