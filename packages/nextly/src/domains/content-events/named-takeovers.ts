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

import { peopleById } from "../versions/author-hydration";

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
 * was. One lookup for the page; a failed one names nobody rather than
 * failing the read, since the name decorates a history the caller may
 * already read.
 *
 * @experimental
 */
export async function nameTakeoverHolders<
  T extends { kind: string; payload: Record<string, unknown> | null },
>(events: T[]): Promise<T[]> {
  const ids = events.flatMap(event => fromIdOf(event) ?? []);
  if (ids.length === 0) return events;
  // The one lookup that names a person on a read already granted, so the
  // takeover row and the version list never name someone differently. It
  // reads the name and nothing else, and leaves out whoever it cannot name.
  const people = await peopleById(ids);
  return events.map(event => {
    const fromId = fromIdOf(event);
    if (fromId === null) return event;
    return {
      ...event,
      payload: {
        ...event.payload,
        fromName: people.get(fromId)?.name || null,
      },
    };
  });
}
