/**
 * Who or what made a change, as the record of content events keeps it.
 *
 * Kept with a display name taken when the event is written, so the event still
 * reads correctly after the person or key is gone.
 *
 * @module domains/content-events/actor
 * @experimental
 */

import type { RequestActor } from "../../auth/request-actor";
import { NextlyError } from "../../errors";

/**
 * The actor of one event.
 *
 * A `principal` is a plugin-defined signed-in person, named by its own kind
 * and id so the id is never read as a staff user's. `agent` is reserved for an
 * AI-agent identity; nothing maps to it yet.
 *
 * @experimental
 */
export type ContentEventActor =
  | {
      kind: "person" | "apiKey" | "release" | "agent";
      id: string;
      name: string | null;
    }
  | {
      kind: "principal";
      principalKind: string;
      id: string;
      name: string | null;
    }
  | { kind: "system"; name?: string | null };

/**
 * The actor for an event, from the request's acting identity and the name
 * the caller read for it.
 *
 * Refuses an actor without the id its kind needs: recording it as someone
 * else, or as nobody, would misattribute the change.
 */
export function contentEventActor(
  actor: RequestActor,
  name: string | null
): ContentEventActor {
  switch (actor.type) {
    case "system":
      return { kind: "system", name };
    case "principal":
      if (actor.principal) {
        return {
          kind: "principal",
          principalKind: actor.principal.kind,
          id: actor.principal.id,
          name,
        };
      }
      break;
    case "user":
      if (actor.id) return { kind: "person", id: actor.id, name };
      break;
    case "apiKey":
      if (actor.id) return { kind: "apiKey", id: actor.id, name };
      break;
  }
  throw NextlyError.invalidInput({
    message: "A content event's actor must name who acted.",
    logContext: { actorType: actor.type },
  });
}
