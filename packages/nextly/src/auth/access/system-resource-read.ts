/**
 * Whether an actor may read a system resource (`media`, `users`), asked of the
 * one decision and answered as the system-resource readers answer today.
 *
 * A system resource is not an entry and declares no code rule, so the
 * decision about it is `decidePermission`'s: the permission alone, a
 * super-admin past it, and a key only by its own grant, never its maker's
 * authority. That is what these readers have answered, but for the deviations
 * kept below.
 *
 * @module auth/access/system-resource-read
 */
import { holdsPermission, isSuperAdmin, type Actor } from "./actor";
import { decidePermission } from "./decide";
import { deviate } from "./deviations";

export interface SystemResourceRead {
  /** The resource as a permission names it: `media`, `users`. */
  readonly resource: string;
  /**
   * Whether the access-control service is registered. A boot may omit it,
   * and the readers have answered differently without it.
   */
  readonly serviceRegistered: boolean;
}

/**
 * The reader's answer for `actor`: the decision's, except where today's
 * reader answers otherwise.
 */
export async function readsSystemResource(
  actor: Actor,
  { resource, serviceRegistered }: SystemResourceRead
): Promise<boolean> {
  const decided = decidePermission(actor, "read", resource).allowed;
  // Without the service a signed-in user's grant is never asked, so the read
  // is refused, super-admin included. A key is judged by its own scope, and a
  // visitor by the Public role's grants, neither of which needs the service.
  if (!serviceRegistered && actor.kind === "user") {
    return deviate("no-service", false, () => decided);
  }
  // The decision counts a `manage-` permission on the resource as its read;
  // these readers never have, and admit only the read grant itself.
  if (
    decided &&
    actor.kind !== "system" &&
    !isSuperAdmin(actor) &&
    !holdsPermission(actor, "read", resource)
  ) {
    return deviate("manage-not-counted", false, () => decided);
  }
  return decided;
}
