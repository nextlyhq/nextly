/**
 * Whether an actor may read a system resource (`media`, `users`), asked of the
 * one decision and answered as the system-resource readers answer today.
 *
 * The decision about a system resource is the permission alone: a system
 * resource declares no code rule. A super-admin passes it, and a key never
 * does by its maker's authority, only by its own grant. That is exactly what
 * these readers have answered, but for the one deviation kept below.
 *
 * @module auth/access/system-resource-read
 */
import type { Actor } from "./actor";
import { decide } from "./decide";
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

/** The decision about reading `resource` as `actor`. */
async function decided(actor: Actor, resource: string): Promise<boolean> {
  const decision = await decide(actor, "read", {
    kind: "system",
    slug: resource,
  });
  return decision.allowed;
}

/**
 * The reader's answer for `actor`: the decision's, except where today's
 * reader answers otherwise.
 */
export async function readsSystemResource(
  actor: Actor,
  { resource, serviceRegistered }: SystemResourceRead
): Promise<boolean> {
  // Without the service a signed-in user's grant is never asked, so the read
  // is refused, super-admin included. A key is judged by its own scope, which
  // needs no service, and a visitor holds no grant either way.
  if (!serviceRegistered && actor.kind === "user") {
    return deviate("no-service", false, () => decided(actor, resource));
  }
  return decided(actor, resource);
}
