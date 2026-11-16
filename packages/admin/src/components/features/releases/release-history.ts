/**
 * What a release's history says: who did what to it, and when.
 *
 * Read from the record of content events, which keeps one shape for every
 * subject, so a release's events name their actor the way a document's
 * history does (`eventActor`). These are the sentences for the kinds
 * Releases records; a kind another feature records is said in its own name,
 * as the document history says one.
 *
 * Pure, so each sentence is one a test can hold.
 *
 * @module components/features/releases/release-history
 */
import {
  eventActor,
  eventSentence,
  type StoryActor,
} from "@admin/components/features/versions/history-story-text";
import type { DocumentEvent } from "@admin/services/versionApi";

import { releaseTimeText } from "./release-time";

/** One row of a release's history. */
export interface ReleaseHistoryLine {
  id: string;
  /** Who did it; `null` for what the release runner did on its own. */
  actor: StoryActor | null;
  /** What happened, said after the actor, or alone when there is none. */
  text: string;
  at: string;
  /**
   * The documents a gathered row stands for, each as its own row would have
   * named it; absent for a row that is one event.
   */
  details?: string[];
}

/** The document a membership event is about, as its payload names it. */
export interface HistoryDocumentRef {
  scopeKind: string;
  scopeSlug: string;
  entryId: string;
}

/** How the history names what its events point at. */
export interface ReleaseHistoryContext {
  /** A document's title, when it is one the reader can see in the release. */
  titleOf: (document: HistoryDocumentRef) => string | null;
  /** A collection's or Single's plural name, from its slug. */
  pluralOf: (scopeSlug: string) => string;
  readerZone: string;
  now: number;
  /** The signed-in reader, named "You" in the history as in About. */
  viewerId: string | null;
}

/**
 * Who did it, as the history names them: the reader as "You", as the
 * release's owner line and the releases list name them, and anyone else as
 * the document history names them.
 */
function actorOf(
  event: DocumentEvent,
  context: ReleaseHistoryContext
): StoryActor {
  const actor = eventActor(event);
  return event.actorKind === "person" &&
    context.viewerId !== null &&
    event.actorId === context.viewerId
    ? { ...actor, name: "You" }
    : actor;
}

/** A payload string, when it is one. */
function text(event: DocumentEvent, key: string): string | undefined {
  const value = event.payload?.[key];
  return typeof value === "string" ? value : undefined;
}

/** The document a membership event names, or `null` without one. */
function documentOf(event: DocumentEvent): HistoryDocumentRef | null {
  const scopeKind = text(event, "scopeKind");
  const scopeSlug = text(event, "scopeSlug");
  const entryId = text(event, "entryId");
  if (!scopeKind || !scopeSlug || !entryId) return null;
  return { scopeKind, scopeSlug, entryId };
}

/**
 * A document as the history names it: by title where the reader can see it
 * in the release, and by its collection otherwise, never by its id.
 */
function documentName(
  event: DocumentEvent,
  context: ReleaseHistoryContext
): string {
  const document = documentOf(event);
  if (!document) return "a document";
  const title = context.titleOf(document);
  if (title) return `“${title}”`;
  return `a document in ${context.pluralOf(document.scopeSlug)}`;
}

/** What a member does when the release runs, as the history says it. */
function actionWords(action: string | undefined): string {
  return action === "unpublish" ? "comes down" : "goes live";
}

/** An instant from a payload, in the reader's zone and its own. */
function when(
  event: DocumentEvent,
  key: string,
  context: ReleaseHistoryContext
): string {
  const reading = releaseTimeText(text(event, key), {
    readerZone: context.readerZone,
    scheduledZone: text(event, "timezone"),
    now: context.now,
  });
  // The reader's time alone: the header says the zone it was scheduled in,
  // and a row repeating both would be the longest line of the history.
  return reading ? reading.local : "a new time";
}

/** Builds what a person did, said after their name, from an event. */
type PersonSentence = (
  event: DocumentEvent,
  context: ReleaseHistoryContext
) => string;

/**
 * What a person did, said after their name, for each kind Releases records.
 * A table rather than a switch, so each sentence reads on its own.
 */
const PERSON_SENTENCE: Record<string, PersonSentence> = {
  "release-created": () => "created the release",
  "release-document-added": (event, context) =>
    `added ${documentName(event, context)} · ${actionWords(text(event, "action"))}`,
  "release-document-removed": (event, context) =>
    `removed ${documentName(event, context)}`,
  "release-document-action-changed": (event, context) =>
    `set ${documentName(event, context)} to ${text(event, "action") === "unpublish" ? "come down" : "go live"}`,
  "release-scheduled": (event, context) =>
    `scheduled it for ${when(event, "at", context)}`,
  "release-rescheduled": (event, context) =>
    `moved it to ${when(event, "at", context)}`,
  "release-publish-now": () => "chose Publish now",
  "release-cancelled": () => "cancelled it",
  "release-renamed": event => {
    const to = text(event, "to");
    return to ? `renamed it “${to}”` : "renamed it";
  },
  "release-description-changed": () => "changed the description",
  "release-deleted": () => "deleted it",
};

/** What the release runner did on its own, as a sentence. */
const RUNNER_SENTENCE: Record<string, string> = {
  "release-started": "Publishing started",
  "release-published": "Published",
  "release-stopped": "Stopped: a document had a problem that would stop it",
};

/** One event of a release's history, as the page lists it. */
export function releaseHistoryLine(
  event: DocumentEvent,
  context: ReleaseHistoryContext
): ReleaseHistoryLine {
  const runner = RUNNER_SENTENCE[event.kind];
  // The runner's own acts are recorded as the system's, and read as what
  // happened to the release rather than as something "System" chose to do.
  if (runner !== undefined && event.actorKind === "system") {
    return { id: event.id, actor: null, text: runner, at: event.occurredAt };
  }
  const sentence = PERSON_SENTENCE[event.kind]?.(event, context) ?? null;
  if (sentence !== null) {
    return {
      id: event.id,
      actor: actorOf(event, context),
      text: sentence,
      at: event.occurredAt,
    };
  }
  // Publishing, stopping and kinds another feature records, by whoever did
  // them, said as the document history says a kind it has no verb for.
  return {
    id: event.id,
    actor: actorOf(event, context),
    text: runner ?? eventSentence(event, () => ""),
    at: event.occurredAt,
  };
}

/**
 * Who owns a release, from its history: the person who created it, by the
 * name recorded when they did. `null` when the history has no creation, as
 * for a release made before releases recorded their history.
 */
export function ownerFromHistory(
  created: DocumentEvent | undefined
): { id: string; name: string | null } | null {
  // A person only: a release created through an API key is owned by no one
  // the owner line can name, and the system creates none.
  if (
    !created ||
    created.kind !== "release-created" ||
    created.actorKind !== "person" ||
    !created.actorId
  ) {
    return null;
  }
  return { id: created.actorId, name: created.actorName };
}

/** Who did it, as a key two events can be compared by. */
function actorKey(event: DocumentEvent): string {
  return `${event.actorKind}:${event.actorId ?? ""}:${event.actorName ?? ""}`;
}

/**
 * A page of history as its rows: each event its own row, except that
 * documents one person added one after another are gathered into one row
 * ("added 9 documents"), which names each of them when opened. A release is
 * usually filled in one sitting, and nine rows saying the same thing push
 * everything else out of sight.
 */
export function releaseHistoryRows(
  events: readonly DocumentEvent[],
  context: ReleaseHistoryContext
): ReleaseHistoryLine[] {
  const rows: ReleaseHistoryLine[] = [];
  let run: { key: string; events: DocumentEvent[] } | null = null;
  const flush = () => {
    if (run === null) return;
    const [first] = run.events;
    if (run.events.length === 1) {
      rows.push(releaseHistoryLine(first, context));
    } else {
      rows.push({
        id: first.id,
        actor: actorOf(first, context),
        text: `added ${run.events.length} documents`,
        // Newest first, as the rows are; the oldest of the run is when it began.
        at: first.occurredAt,
        details: run.events.map(
          event =>
            `${documentName(event, context)} · ${actionWords(text(event, "action"))}`
        ),
      });
    }
    run = null;
  };
  for (const event of events) {
    if (event.kind === "release-document-added") {
      const key = actorKey(event);
      if (run !== null && run.key === key) {
        run.events.push(event);
        continue;
      }
      flush();
      run = { key, events: [event] };
      continue;
    }
    flush();
    rows.push(releaseHistoryLine(event, context));
  }
  flush();
  return rows;
}
