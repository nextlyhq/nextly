/**
 * Value types shared by the content-event tables on every dialect.
 *
 * @module schemas/content-events/types
 */

/** What an event is about: a collection's document, a Single, or a release. */
export type ContentEventSubjectKind = "collection" | "single" | "release";

/**
 * Who or what made the change. `principal` is a plugin-defined signed-in
 * person, named by kind and id so its id is never read as a staff user's;
 * `agent` is reserved for an AI-agent identity and nothing writes it yet.
 */
export type ContentEventActorKind =
  | "person"
  | "apiKey"
  | "principal"
  | "release"
  | "system"
  | "agent";

/**
 * The part value that stands for a document's shared (untranslated) fields.
 * Not a locale code, which never starts with `~`.
 */
export const SHARED_PART = "~shared";

/** The tables' names, the same on every dialect. */
export const CONTENT_EVENTS_TABLE = "nextly_content_events";
export const CONTENT_EVENT_PARTS_TABLE = "nextly_content_event_parts";
