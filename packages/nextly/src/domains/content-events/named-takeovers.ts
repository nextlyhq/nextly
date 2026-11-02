/**
 * A takeover's displaced holder, named when history is read.
 *
 * A takeover event keeps the displaced holder by user id alone. A name copied
 * into the event would outlive a deleted account (erasure clears an event's
 * own actor name, not its payload), and the lock's label for a holder may be
 * an email address, which nothing on a history surface shows. So the name is
 * read from the users table each time history is read: a person's name, never
 * their email, and nothing for a person with no name or no account any more.
 *
 * @module domains/content-events/named-takeovers
 * @experimental
 */

import { z } from "zod";

import { getService } from "../../di";

import type { ContentEventKind } from "./kinds";

/**
 * The takeover kind: who took a document over is the event's actor, and who
 * they took it from is `fromId`. The document lock registers and writes it;
 * it is defined here, beside its naming, so the two read one shape.
 *
 * @experimental
 */
export const TAKEOVER_CONTENT_EVENT_KIND = {
  name: "taken-over",
  label: "Taken over by {actor}",
  payload: z.object({ fromId: z.string().min(1) }).strict(),
} as const satisfies ContentEventKind;

/** A person's display name by id, as the users table keeps it. */
export type PeopleNamesById = (
  ids: string[]
) => Promise<{ id: string; name: string | null }[]>;

/** Names from the user service: its projection carries no email. */
const userNames: PeopleNamesById = ids =>
  getService("userService").listUsersByIds(ids);

/** The displaced holder's id, when this event is a takeover that names one. */
function fromIdOf(event: {
  kind: string;
  payload: Record<string, unknown> | null;
}): string | null {
  if (event.kind !== TAKEOVER_CONTENT_EVENT_KIND.name) return null;
  const fromId = event.payload?.fromId;
  return typeof fromId === "string" && fromId.length > 0 ? fromId : null;
}

/**
 * Each takeover in `events` with its displaced holder's name added to its
 * payload as `fromName`: their name, or null when they have none, their
 * account is gone or the lookup failed. Every other event is returned as it
 * was. One lookup for the page.
 *
 * A failed lookup names nobody rather than failing the read: the name
 * decorates a history the caller may already read.
 *
 * @experimental
 */
export async function nameTakeoverHolders<
  T extends { kind: string; payload: Record<string, unknown> | null },
>(events: T[], names: PeopleNamesById = userNames): Promise<T[]> {
  const ids = [
    ...new Set(events.flatMap(event => fromIdOf(event) ?? [])),
  ];
  if (ids.length === 0) return events;
  const byId = new Map<string, string>();
  try {
    for (const person of await names(ids)) {
      if (person.name) byId.set(person.id, person.name);
    }
  } catch {
    // Named by nobody: the row says the previous editor is unavailable.
  }
  return events.map(event => {
    const fromId = fromIdOf(event);
    if (fromId === null) return event;
    return {
      ...event,
      payload: { ...event.payload, fromName: byId.get(fromId) ?? null },
    };
  });
}
