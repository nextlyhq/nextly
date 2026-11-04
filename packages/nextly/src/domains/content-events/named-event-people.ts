/**
 * The people an event keeps by id, named when history is read.
 *
 * A takeover keeps the holder it displaced by user id, and an overwrite the
 * person whose changes it replaced. A name copied into the event would
 * outlive a deleted account (erasure clears an event's own actor name, not
 * its payload), and a lock holder's label may be an email address, which
 * nothing on a history surface shows. So both are named from the users table
 * each time history is read, by one lookup: a person's name, never their
 * email, and nothing for a person with no name or no account any more.
 *
 * @module domains/content-events/named-event-people
 * @experimental
 */

import { peopleById } from "../versions/author-hydration";

import { CORE_CONTENT_EVENT_KINDS } from "./core-kinds";
import { TAKEOVER_CONTENT_EVENT_KIND } from "./named-takeovers";

interface NamedEvent {
  kind: string;
  payload: Record<string, unknown> | null;
}

/** A non-empty string, or null. */
function idOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** An overwrite's replaced person's id: only a person, never a key or a member. */
function replacedPersonId(payload: NamedEvent["payload"]): string | null {
  const replaced = payload?.replaced as
    | { kind?: unknown; id?: unknown }
    | null
    | undefined;
  return replaced?.kind === "person" ? idOrNull(replaced.id) : null;
}

/**
 * The person `event` keeps by id, and the payload key their name goes under:
 * a takeover's displaced holder, or the person an overwrite replaced. Null
 * for any other event, and for an overwrite that replaced no person (a key,
 * a member, or nobody it can name).
 */
function keptPerson(event: NamedEvent): { id: string; nameKey: string } | null {
  const [id, nameKey] =
    event.kind === TAKEOVER_CONTENT_EVENT_KIND.name
      ? [idOrNull(event.payload?.fromId), "fromName"]
      : event.kind === CORE_CONTENT_EVENT_KINDS.overwritten.name
        ? [replacedPersonId(event.payload), "replacedName"]
        : [null, ""];
  return id === null ? null : { id, nameKey };
}

/**
 * Each event in `events` that keeps a person by id, with that person's name
 * added to its payload (`fromName` for a takeover, `replacedName` for an
 * overwrite): their name, or null when they have none, their account is gone
 * or the lookup failed. Every other event is returned as it was. One lookup
 * for the page; a failed one names nobody rather than failing the read, since
 * the name decorates a history the caller may already read.
 *
 * @experimental
 */
export async function nameEventPeople<T extends NamedEvent>(
  events: T[]
): Promise<T[]> {
  const ids = events.flatMap(event => keptPerson(event)?.id ?? []);
  if (ids.length === 0) return events;
  // The one lookup that names a person on a read already granted, so these
  // rows and the version list never name someone differently. It reads the
  // name and nothing else, and leaves out whoever it cannot name.
  const people = await peopleById(ids);
  return events.map(event => {
    const kept = keptPerson(event);
    if (kept === null) return event;
    return {
      ...event,
      payload: {
        ...event.payload,
        [kept.nameKey]: people.get(kept.id)?.name || null,
      },
    };
  });
}
