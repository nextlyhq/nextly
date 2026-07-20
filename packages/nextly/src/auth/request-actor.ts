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

import type { AuthContext } from "./middleware";

/** What kind of caller performed a write. */
export type RequestActorType = "user" | "apiKey" | "system";

/**
 * The acting identity for one write.
 *
 * For `apiKey` the id is the API key's own id rather than the key owner's user
 * id: the key is the actor, and its owner is an attribute of the key that stays
 * recoverable from the keys table. `type` already distinguishes the two, so the
 * single id slot carries the most precise identity available.
 */
export interface RequestActor {
  type: RequestActorType;
  id?: string;
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
export function actorFromAuthContext(context: AuthContext): RequestActor {
  if (context.authMethod === "api-key") {
    return { type: "apiKey", id: context.apiKeyId ?? context.userId };
  }
  return { type: "user", id: context.userId };
}
