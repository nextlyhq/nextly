/**
 * Who or what made a change, as the record of content events keeps it.
 *
 * Kept with a display name taken when the event is written, so the event still
 * reads correctly after the person or key is gone.
 *
 * @module domains/content-events/actor
 */

import type { RequestActor } from "../../auth/request-actor";
import { NextlyError } from "../../errors";
import { storedAttribution } from "../audit/attribution";

/**
 * The actor of one event.
 *
 * A `principal` is a plugin-defined signed-in person, named by its own kind
 * and id so the id is never read as a staff user's. A `plugin` is a plugin
 * acting on its own behalf, its id the name it booted under. `agent` is
 * reserved for an AI-agent identity; nothing maps to it yet.
 *
 * An agent acting for a person is not that kind: the person stays the actor,
 * by kind, id and name, and `agentName` names the agent beside them ("Claude
 * Code"). Erasing the person blanks their name and keeps the agent's, which
 * names software rather than anyone.
 */
export type ContentEventActor =
  | {
      kind: "person" | "apiKey" | "plugin" | "release" | "agent";
      id: string;
      name: string | null;
      /** The agent that acted for this actor, by its own name; see below. */
      agentName?: string | null;
    }
  | {
      kind: "principal";
      principalKind: string;
      id: string;
      name: string | null;
      agentName?: string | null;
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
  const event = actorOf(actor, name);
  if (event.kind === "system") return event;
  const agentName = agentNameOf(actor);
  return agentName === null ? event : { ...event, agentName };
}

/**
 * The agent behind `actor`, by name, as the trails store it: the one mapping
 * every trail uses, so a name the activity log refuses is refused here too.
 * Only the name: the event keeps no door, credential or session.
 */
function agentNameOf(actor: RequestActor): string | null {
  const agent = actor.attribution?.agent;
  if (!agent) return null;
  return storedAttribution({ agent: { name: agent.name } }, "content-event")
    .agentName;
}

/** The actor for an event, without the agent behind them. */
function actorOf(actor: RequestActor, name: string | null): ContentEventActor {
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
