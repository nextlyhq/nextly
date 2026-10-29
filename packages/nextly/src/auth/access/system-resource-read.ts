/**
 * Whether an actor may read a system resource (`media`, `users`), asked of the
 * one decision and answered as the system-resource readers answer today.
 *
 * A system resource is not an entry and declares no code rule, so the
 * decision about it is `decidePermission`'s: the permission alone, or the
 * resource's `manage-` permission where that still counts, a super-admin past
 * it, and a key only by its own grant, never its maker's authority. That is
 * what these readers answer, but for the deviations kept below.
 *
 * @module auth/access/system-resource-read
 */
import type { Actor } from "./actor";
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
  // Media is the one system resource a visitor reads, by the Public role's
  // `read-media`: a user row carries a person's address, so it is refused to
  // a visitor whatever Public was granted, as relationship population
  // refuses it.
  if (actor.kind === "visitor" && resource !== "media") {
    return deviate("visitor-keeps-media", false, () => decided);
  }
  // A `manage-` permission on the resource counts as its read, as the
  // decision counts it.
  return decided;
}
