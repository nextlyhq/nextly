/**
 * The kinds of content event core's own write paths record: what happens to a
 * document in its history.
 *
 * Registered by core rather than by each writer, so every path names an event
 * the same way and history reads them all through one registry. Releases and
 * Workflows register their own kinds beside these.
 *
 * @module domains/content-events/core-kinds
 * @experimental
 */

import { z } from "zod";

import {
  contentEventKind,
  registerContentEventKind,
  type ContentEventKind,
} from "./kinds";

/**
 * Each core kind, by the name a writer uses for it.
 *
 * @experimental
 */
export const CORE_CONTENT_EVENT_KINDS = {
  created: { name: "created", label: "Created by {actor}" },
  saved: { name: "saved", label: "Saved by {actor}" },
  published: { name: "published", label: "Published by {actor}" },
  unpublished: { name: "unpublished", label: "Unpublished by {actor}" },
  restored: {
    name: "restored",
    label: "Restored from version {from} by {actor}",
    // The version restored from; the event's own version is the one the
    // restore produced.
    payload: z.object({ from: z.number().int().positive() }).strict(),
  },
  named: {
    name: "named",
    label: "Named {label} by {actor}",
    payload: z.object({ label: z.string().min(1) }).strict(),
  },
  draftDiscarded: {
    name: "draft-discarded",
    label: "Draft discarded by {actor}",
  },
  deleted: { name: "deleted", label: "Deleted by {actor}", endsSubject: true },
  versionsRemoved: {
    name: "versions-removed",
    label: "{count} older versions removed",
    payload: z.object({ count: z.number().int().positive() }).strict(),
  },
} as const satisfies Record<string, ContentEventKind>;

/**
 * A core kind's key in {@link CORE_CONTENT_EVENT_KINDS}.
 *
 * @experimental
 */
export type CoreContentEventKind = keyof typeof CORE_CONTENT_EVENT_KINDS;

/**
 * Register every core kind, when it is not registered already. Safe to call
 * on every write: a registered kind is left as it is.
 */
export function ensureCoreContentEventKinds(): void {
  for (const kind of Object.values(CORE_CONTENT_EVENT_KINDS)) {
    if (!contentEventKind(kind.name)) registerContentEventKind(kind);
  }
}
