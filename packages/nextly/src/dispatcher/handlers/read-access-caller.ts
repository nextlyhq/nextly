/**
 * The dispatcher's resolved identity, in the shape the shared read decision
 * takes.
 *
 * `canReadEntity` and `readableEntities` are the one answer to "may this
 * caller read that entity" — the dashboard scope, the version reads and the
 * list endpoints all ask it, so that a collection authorised entirely in code
 * is visible on every one of them or on none. This is the bridge from a
 * dispatcher request to that answer, kept in one place so no handler builds
 * its own caller and quietly asks a different question.
 *
 * An API key's own scoped grants arrive on the params; a session caller has
 * none there, and `canReadEntity` resolves theirs from the database.
 *
 * @module dispatcher/handlers/read-access-caller
 */

import type { ReadAccessCaller } from "../../auth/entity-read-access";
import type { UserContext } from "../../domains/singles/types";
import type { Params } from "../types";

export function readAccessCallerFromParams(
  p: Params,
  user: UserContext
): ReadAccessCaller {
  const isApiKey = p._authenticatedActorType === "apiKey";

  let permissions: string[] = [];
  if (isApiKey && p._authenticatedPermissions) {
    try {
      const parsed: unknown = JSON.parse(String(p._authenticatedPermissions));
      if (Array.isArray(parsed)) permissions = parsed as string[];
    } catch {
      // A corrupt value must not read as a broader grant than the key holds;
      // an empty list denies, which is the safe direction.
      permissions = [];
    }
  }

  return {
    userId: user.id,
    authMethod: isApiKey ? "api-key" : "session",
    permissions,
    roles: user.roles ?? [],
  };
}
