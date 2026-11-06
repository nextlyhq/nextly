/**
 * Whether a key's stored slugs hold an action on a resource, for the gates
 * that compare stored permissions themselves rather than asking the decision.
 *
 * A permission holds only its own action on its own resource, as the
 * decision counts it; a retired `manage-` permission counts for nothing.
 *
 * @module auth/access/answering-permissions
 */
import { permissionSlug } from "../../schemas/_zod/rbac";

/** Whether a key's stored slugs name the permission holding the action. */
export function storedSlugHolds(
  stored: readonly string[],
  action: string,
  resource: string
): boolean {
  return stored.includes(permissionSlug(action, resource));
}
