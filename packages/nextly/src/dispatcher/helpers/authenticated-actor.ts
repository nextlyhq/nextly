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
