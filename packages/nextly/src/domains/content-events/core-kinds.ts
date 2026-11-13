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
  overwritten: {
    name: "overwritten",
    label: "Overwritten by {actor}",
    // How the overwrite stood against the document: no version given, the
    // current one, or one out of date. Out of date, `replaced` is who made
    // the latest change it replaced, by id alone, named when history is read
    // so an erased account is never named from the record; null when the
    // row records no maker. The event's actor is who overwrote.
    payload: z
      .object({
        given: z.enum(["none", "current", "stale"]),
        replaced: z
          .object({
            kind: z.string().min(1),
            id: z.string().min(1).nullable(),
            principalKind: z.string().min(1).nullable(),
          })
          .strict()
          .nullable(),
      })
      .strict(),
  },
  fieldRewritten: {
    name: "field-rewritten",
    label: "{field} rewritten by {actor}",
    // One field changed on the live copy and the pending drafts that held it,
    // without a save of either: which field, and which copies changed
    // (`live`, and `draft` or `draft:<language>` for each draft). `plugin`
    // names the plugin that made it for a person, when one did; made on the
    // plugin's own behalf, the plugin is the event's actor instead. The
    // reason the caller gave is the event's note.
    payload: z
      .object({
        field: z.string().min(1).max(255),
        copies: z.array(z.string().min(1).max(64)).min(1).max(64),
        plugin: z.string().min(1).max(255).optional(),
      })
      .strict(),
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
