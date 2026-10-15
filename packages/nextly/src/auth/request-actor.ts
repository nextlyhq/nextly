/**
 * Who performed a request.
 *
 * The canonical identity a write path records for attribution. Derived at the
 * transport boundary (where authentication is resolved) and threaded down to
 * the mutation services, which would otherwise only see a user id and could not
 * tell a signed-in person from an API key acting on their behalf.
 *
 * Kept transport-neutral and free of webhook types: the webhook envelope is one
 * consumer, and durable audit logging is the next.
 *
 * @module auth/request-actor
 */

import type { PrincipalRef } from "../plugins/principals/types";

import type { AuthContext } from "./middleware";
import { currentPrincipal } from "./principal-scope";

/**
 * What kind of caller performed a write. `principal` is a plugin-defined
 * signed-in person, never a staff user.
 */
export type RequestActorType = "user" | "apiKey" | "system" | "principal";

/**
 * The acting identity for one write.
 *
 * For `apiKey` the id is the API key's own id rather than the key owner's user
 * id: the key is the actor, and its owner is an attribute of the key that stays
 * recoverable from the keys table. `type` already distinguishes the two, so the
 * single id slot carries the most precise identity available.
 *
 * A `principal` actor carries the person in `principal`, by kind and id, and
 * no `id`: the id slot names a staff user or a key, and a person's id there
 * would be read as one. Every trail keyed on `id` (the activity log among
 * them) therefore records no row for a person.
 */
export interface RequestActor {
  type: RequestActorType;
  id?: string;
  /** The person, for a `principal` actor only. */
  principal?: PrincipalRef;
}

/** The actor for a write made as a plugin-defined person. */
export function principalActor(person: PrincipalRef): RequestActor {
  // Kind and id only: the person's attributes are not who acted.
  return { type: "principal", principal: { kind: person.kind, id: person.id } };
}

/**
 * The actor for writes that no external caller initiated — seeds, migrations,
 * and internal maintenance. Frozen because it is shared by every such call site.
 */
export const SYSTEM_ACTOR: RequestActor = Object.freeze({ type: "system" });

/**
 * Map a resolved authentication context to the acting identity.
 *
 * An API-key request attributes to the key itself when its id was resolved;
 * without one it falls back to the key owner's user id, which is still better
 * attribution than dropping the actor entirely.
 */
/**
 * The actor to record for a write.
 *
 * Prefers the transport-resolved actor. A Direct API, plugin, or other
 * server-side caller has no transport actor but often does know the user it is
 * acting for, so fall back to that; only a genuinely uninitiated write records
 * as `system`. Never returns null — durable history that cannot distinguish
 * "nobody" from "we forgot to record it" is not worth keeping.
 */
export function actorForWrite(
  actor: RequestActor | undefined | null,
  user: { id?: string } | undefined | null
): RequestActor {
  if (actor) return actor;
  if (user?.id) return { type: "user", id: user.id };
  // A write made as a person names no user: the person is who acted.
  const person = currentPrincipal();
  if (person) return principalActor(person);
  return SYSTEM_ACTOR;
}

export function actorFromAuthContext(context: AuthContext): RequestActor {
  if (context.authMethod === "api-key") {
    return { type: "apiKey", id: context.apiKeyId ?? context.userId };
  }
  return { type: "user", id: context.userId };
}

/**
 * The actor a webhook envelope carries for `actor`: who acted, without a
 * plugin-defined person. A person's write is delivered as one no staff user
 * or key made, `system`, as it was before people could act: a delivery and
 * its stored event are outside the trail a person's deletion erases, so
 * their kind and id never go in one.
 */
export function webhookActorOf(
  actor: RequestActor | null | undefined
): { type: Exclude<RequestActorType, "principal">; id?: string } | null {
  if (!actor) return null;
  if (actor.type === "principal") return { type: "system" };
  return actor.id === undefined
    ? { type: actor.type }
    : { type: actor.type, id: actor.id };
}
