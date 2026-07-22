import type { AuthenticatedScope } from "../../auth/authenticated-scope";
import type { RequestActor, RequestActorType } from "../../auth/request-actor";
import type { Params } from "../types";

/** The actor kinds a route can forward, used to validate the raw param. */
const ACTOR_TYPES: readonly RequestActorType[] = ["user", "apiKey", "system"];

function isActorType(value: string): value is RequestActorType {
  return (ACTOR_TYPES as readonly string[]).includes(value);
}

/**
 * Decode the acting identity forwarded by the route handler.
 *
 * Route params are strings, so the actor arrives split across two of them.
 * Validate the type against the known set: an unrecognized value degrades to
 * "no actor" (the write records as `system`) rather than persisting a bogus
 * actor type into durable event history.
 */
export function readAuthenticatedActor(p: Params): RequestActor | undefined {
  const type = p._authenticatedActorType;
  if (!type || !isActorType(type)) return undefined;
  const id = p._authenticatedActorId;
  return id ? { type, id } : { type };
}

/**
 * Decode the caller's authenticated scope for a service-side access re-check.
 *
 * For an API key the route stamps its OWN scoped grants on the params; a service
 * check (e.g. the publish/unpublish transition gate) must judge the key on those
 * rather than the owner's RBAC. A corrupt permissions value reads as an empty
 * list, which denies — the safe direction. Returns `undefined` for a non-API-key
 * caller so the check falls back to normal RBAC resolution.
 */
export function readAuthenticatedScope(
  p: Params
): AuthenticatedScope | undefined {
  const type = p._authenticatedActorType;
  if (!type || !isActorType(type)) return undefined;

  let permissions: string[] = [];
  if (type === "apiKey" && p._authenticatedPermissions) {
    try {
      const parsed: unknown = JSON.parse(String(p._authenticatedPermissions));
      if (Array.isArray(parsed)) permissions = parsed as string[];
    } catch {
      permissions = [];
    }
  }

  return { actorType: type, permissions };
}
