/**
 * The takeover kind: what the document lock records when a person takes a
 * document over.
 *
 * It keeps the displaced holder by user id alone, named when history is read
 * (`named-event-people.ts`), so a deleted account is never named from the
 * record and a lock label that is an email address is never shown.
 *
 * @module domains/content-events/named-takeovers
 * @experimental
 */

import { z } from "zod";

import type { ContentEventKind } from "./kinds";

/**
 * The takeover kind: who took a document over is the event's actor, and who
 * they took it from is `fromId`. The document lock registers and writes it;
 * it is defined here, beside the record of content events that names it, so
 * the two read one shape.
 *
 * @experimental
 */
export const TAKEOVER_CONTENT_EVENT_KIND = {
  name: "taken-over",
  label: "Taken over by {actor}",
  payload: z.object({ fromId: z.string().min(1) }).strict(),
} as const satisfies ContentEventKind;
