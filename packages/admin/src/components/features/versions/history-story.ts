/**
 * The history list as a story: what happened to a document, newest first,
 * derived from its versions and its record of events.
 *
 * - "Current draft" and "Currently published" are pinned above it, for each
 *   part (a language, or the fields every language shares), only for the
 *   states that exist, and only for a document with the Draft/Published
 *   lifecycle: without one there is no draft and nothing to publish.
 * - Each save folds under the next publish that included its part. A named
 *   version, a restore and an event never fold away.
 * - Events that are not themselves a version sit between the versions: a
 *   withdrawal, a discarded draft, older versions removed.
 * - It shows the language being edited with the shared fields, or every part.
 *
 * Pure, so each rule is tested without rendering anything.
 *
 * @module components/features/versions/history-story
 */

import type { DocumentEvent, VersionMeta } from "@admin/services/versionApi";

/** The part that holds the fields every language shares. */
export const SHARED_PART = "~shared";

/**
 * Events that record the writing of a version. The version itself tells what
 * happened, so none of these is a row of its own, except a publish whose
 * version is not in the list.
 */
const VERSION_EVENTS = new Set(["created", "saved", "restored", "published"]);

/** A naming is shown on the version it names, never as a row of its own. */
const NAMING_EVENT = "named";

/** The event that marks older versions removed by retention. */
export const REMOVAL_EVENT = "versions-removed";

export type HistoryFilter = "everything" | "published" | "named" | "events";

/** Which parts the list shows: one language with the shared fields, or all. */
export type HistoryView =
  | { kind: "all" }
  | { kind: "language"; locale: string };

export interface StoryInput {
  /** The document's versions, newest first. */
  versions: readonly VersionMeta[];
  /** The document's events, newest first. */
  events: readonly DocumentEvent[];
  /** Whether the document has the Draft/Published lifecycle. */
  lifecycle: boolean;
  /** Whether the document is translated, and so has parts to tell apart. */
  localized: boolean;
  view: HistoryView;
  filter: HistoryFilter;
}

/** A version in the story, with what it published and the saves it shipped. */
export interface StoryVersion {
  kind: "version";
  at: string;
  version: VersionMeta;
  /** The parts it applied to: a publish names every part it published. */
  parts: string[];
  /** Whether it is a publish. */
  publish: boolean;
  /** The event that published it, when one was recorded. */
  publishedBy: DocumentEvent | null;
  /** The saves this publish shipped, newest first; empty for any other row. */
  folded: VersionMeta[];
}

/** An event that is not itself a version. */
export interface StoryEvent {
  kind: "event";
  at: string;
  event: DocumentEvent;
}

/** Where retention removed older versions. */
export interface StoryRemoval {
  kind: "removed";
  at: string;
  event: DocumentEvent;
}

export type StoryEntry = StoryVersion | StoryEvent | StoryRemoval;

/** The entries of one day, newest first, keyed by the local calendar day. */
export interface StoryDay {
  day: string;
  entries: StoryEntry[];
}

/** A part's working draft, newer than whatever of it is published. */
export interface PinnedDraft {
  part: string;
  version: VersionMeta;
  /** Whether any of this part was ever published. */
  published: boolean;
}

/** What is published now, one row per publish, naming its parts. */
export interface PinnedPublished {
  parts: string[];
  version: VersionMeta;
  /** The publish event, or null for one made before events were recorded. */
  publishedBy: DocumentEvent | null;
}

export interface Story {
  drafts: PinnedDraft[];
  published: PinnedPublished[];
  days: StoryDay[];
}

/** The part a version holds: its language, or the shared fields. */
export function partOf(version: Pick<VersionMeta, "locale">): string {
  return version.locale ?? SHARED_PART;
}

/** Whether something applying to these parts belongs in the view. */
function inView(parts: readonly string[], view: HistoryView): boolean {
  if (view.kind === "all" || parts.length === 0) return true;
  return parts.includes(view.locale) || parts.includes(SHARED_PART);
}

/** The local calendar day of a time, as `yyyy-mm-dd`. */
export function dayOf(at: string): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Whether two times fall in the same second: history stores whole seconds. */
function sameSecond(a: string, b: string): boolean {
  return Math.floor(Date.parse(a) / 1000) === Math.floor(Date.parse(b) / 1000);
}

/**
 * The event that published a version: the one naming its number.
 *
 * A publish recorded before edits named the version they produced carries no
 * number. For those rows alone, an unnumbered publish in the version's own
 * second is taken as its publisher: both were written in one transaction.
 */
function publisherOf(
  version: VersionMeta,
  events: readonly DocumentEvent[]
): DocumentEvent | null {
  return (
    events.find(
      e => e.kind === "published" && e.versionNo === version.versionNo
    ) ??
    events.find(
      e =>
        e.kind === "published" &&
        e.versionNo === null &&
        sameSecond(e.occurredAt, version.createdAt)
    ) ??
    null
  );
}

/** A version as a story entry, before any saves are folded under it. */
function storyVersion(
  version: VersionMeta,
  lifecycle: boolean,
  events: readonly DocumentEvent[]
): StoryVersion {
  const publish = lifecycle && version.status === "published";
  const publishedBy = publish ? publisherOf(version, events) : null;
  // A publish of several parts is one event naming them; the version alone
  // holds one part.
  const parts =
    publish && publishedBy !== null && publishedBy.parts.length > 0
      ? [...publishedBy.parts]
      : [partOf(version)];
  return {
    kind: "version",
    at: version.createdAt,
    version,
    parts,
    publish,
    publishedBy,
    folded: [],
  };
}

/** Whether a version is a plain save, the only kind that folds. */
function isPlainSave(entry: StoryVersion): boolean {
  return (
    !entry.publish &&
    !entry.version.label &&
    entry.version.sourceVersionNo === null
  );
}

/**
 * Fold each plain save under the next publish that included its part, and
 * return what stays a row of its own. Entries arrive newest first, so the
 * next publish of a save is the nearest publish above it.
 */
function foldSaves(entries: StoryVersion[]): StoryVersion[] {
  const rows: StoryVersion[] = [];
  const newerPublishes: StoryVersion[] = [];
  for (const entry of entries) {
    if (isPlainSave(entry)) {
      const part = partOf(entry.version);
      // The nearest newer publish of this part is the last one pushed that
      // includes it.
      const into = [...newerPublishes]
        .reverse()
        .find(p => p.parts.includes(part));
      if (into) {
        into.folded.push(entry.version);
        continue;
      }
    }
    if (entry.publish) newerPublishes.push(entry);
    rows.push(entry);
  }
  return rows;
}

/** The events that are rows of their own, and the removal markers. */
function eventEntries(
  events: readonly DocumentEvent[],
  listed: ReadonlySet<number>,
  attached: ReadonlySet<string>
): (StoryEvent | StoryRemoval)[] {
  const entries: (StoryEvent | StoryRemoval)[] = [];
  for (const event of events) {
    // A naming is shown on its version, and a publish on the version it
    // published.
    if (event.kind === NAMING_EVENT || attached.has(event.id)) continue;
    if (event.kind === REMOVAL_EVENT) {
      entries.push({ kind: "removed", at: event.occurredAt, event });
      continue;
    }
    if (VERSION_EVENTS.has(event.kind)) {
      // A publish whose version is not listed (removed, or a publish that
      // produced none) is still something that happened; the other version
      // events add nothing their version does not say.
      const ownVersionListed =
        event.versionNo !== null && listed.has(event.versionNo);
      if (event.kind !== "published" || ownVersionListed) continue;
    }
    entries.push({ kind: "event", at: event.occurredAt, event });
  }
  return entries;
}

/** What each filter keeps. */
const FILTERS: Record<HistoryFilter, (entry: StoryEntry) => boolean> = {
  everything: () => true,
  // Publishes, as versions or as events whose version is not listed.
  published: entry =>
    entry.kind === "version"
      ? entry.publish
      : entry.kind === "event" && entry.event.kind === "published",
  named: entry => entry.kind === "version" && Boolean(entry.version.label),
  // Events, and the versions that are more than a save.
  events: entry => entry.kind !== "version" || !isPlainSave(entry),
};

/** Group entries, newest first, by their local calendar day. */
function byDay(entries: readonly StoryEntry[]): StoryDay[] {
  const days: StoryDay[] = [];
  for (const entry of entries) {
    const day = dayOf(entry.at);
    const last = days.at(-1);
    if (last && last.day === day) last.entries.push(entry);
    else days.push({ day, entries: [entry] });
  }
  return days;
}

/**
 * The parts the pinned rows cover: those of the versions in view. A part with
 * no version has no state to pin.
 */
function pinnedParts(versions: readonly VersionMeta[]): string[] {
  const parts: string[] = [];
  for (const version of versions) {
    const part = partOf(version);
    if (!parts.includes(part)) parts.push(part);
  }
  return parts;
}

/**
 * Whether an event of this kind ended a part's state at or after a moment: an
 * unpublish ends a publish, and a discard ends a draft.
 */
function endedSince(
  kind: string,
  part: string,
  since: string,
  events: readonly DocumentEvent[]
): boolean {
  return events.some(
    event =>
      event.kind === kind &&
      // At or after: history stores whole seconds, so an ending in the
      // state's own second is after it.
      event.occurredAt >= since &&
      (event.parts.length === 0 || event.parts.includes(part))
  );
}

/** The pinned rows: each part's working draft, and what is published now. */
function pins(
  entries: readonly StoryVersion[],
  versions: readonly VersionMeta[],
  events: readonly DocumentEvent[]
): Pick<Story, "drafts" | "published"> {
  const drafts: PinnedDraft[] = [];
  const published: PinnedPublished[] = [];
  for (const part of pinnedParts(versions)) {
    const latestPublish = entries.find(
      e => e.publish && e.parts.includes(part)
    );
    // The newest entry holding this part, a publish that shipped it among
    // others included: a save older than that publish is no longer the draft.
    const newest = entries.find(e => e.parts.includes(part));
    // A draft discarded since its version was saved is no longer the
    // document's draft, though its version stays in the history.
    if (
      newest &&
      newest.version.status === "draft" &&
      newest !== latestPublish &&
      !endedSince("draft-discarded", part, newest.at, events)
    ) {
      drafts.push({
        part,
        version: newest.version,
        published: latestPublish !== undefined,
      });
    }
    if (
      latestPublish &&
      !endedSince("unpublished", part, latestPublish.at, events)
    ) {
      const row = published.find(r => r.version === latestPublish.version);
      if (row) row.parts.push(part);
      else {
        published.push({
          parts: [part],
          version: latestPublish.version,
          publishedBy: latestPublish.publishedBy,
        });
      }
    }
  }
  return { drafts, published };
}

/**
 * The versions and events as the document's parts. A document without
 * languages is one part however its versions are tagged: some writes record
 * the default language and others none, and both are the same document.
 */
function asParts(input: StoryInput): {
  versions: readonly VersionMeta[];
  events: readonly DocumentEvent[];
} {
  if (input.localized) return input;
  return {
    versions: input.versions.map(v => ({ ...v, locale: null })),
    events: input.events.map(e => ({ ...e, parts: [] })),
  };
}

/** The story the History panel tells about a document. */
export function buildStory(input: StoryInput): Story {
  const { lifecycle, view, filter } = input;
  const { versions: own, events: ownEvents } = asParts(input);
  // A view keeps a version by the parts it holds once its publish is
  // attached: a publish that shipped several languages belongs to each of
  // them, though its version records one.
  const versionEntries = own
    .filter(v => v.versionNo !== null)
    .map(v => storyVersion(v, lifecycle, ownEvents))
    .filter(entry => inView(entry.parts, view));
  const versions = versionEntries.map(entry => entry.version);
  const attached = new Set(
    versionEntries.flatMap(e => (e.publishedBy ? [e.publishedBy.id] : []))
  );
  const listed = new Set(
    versions.flatMap(v => (v.versionNo === null ? [] : [v.versionNo]))
  );
  const events = ownEvents.filter(e => inView(e.parts, view));
  const rows: StoryEntry[] = [
    ...foldSaves(versionEntries),
    ...eventEntries(events, listed, attached),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  // Pinned for the parts in view only: a Spanish version kept in the English
  // view for the English it published says nothing of Spanish here.
  const pinned = lifecycle
    ? pins(
        versionEntries,
        versions.filter(v => inView([partOf(v)], view)),
        events
      )
    : { drafts: [], published: [] };
  return {
    ...pinned,
    days: byDay(rows.filter(FILTERS[filter])),
  };
}

/**
 * Whether a story shows a version: pinned, as a row, or folded under one.
 */
export function storyShows(story: Story, versionNo: number): boolean {
  const pinned = [...story.drafts, ...story.published].some(
    pin => pin.version.versionNo === versionNo
  );
  return (
    pinned ||
    story.days.some(day =>
      day.entries.some(
        entry =>
          entry.kind === "version" &&
          (entry.version.versionNo === versionNo ||
            entry.folded.some(v => v.versionNo === versionNo))
      )
    )
  );
}

/**
 * The versions and events within the window both lists have loaded.
 *
 * The two are read page by page, separately. A list with more pages to read
 * is complete only down to its oldest loaded entry, so anything older than
 * that, from the other list, could be missing its neighbours: a save shown
 * without the publish that shipped it. Both are cut to the newer of the two
 * floors; loading more of either moves it down.
 */
export function loadedWindow(input: {
  versions: readonly VersionMeta[];
  versionsComplete: boolean;
  events: readonly DocumentEvent[];
  eventsComplete: boolean;
}): { versions: VersionMeta[]; events: DocumentEvent[] } {
  const floors = [
    input.versionsComplete ? undefined : input.versions.at(-1)?.createdAt,
    input.eventsComplete ? undefined : input.events.at(-1)?.occurredAt,
  ].filter((at): at is string => at !== undefined);
  const floor = floors.sort().at(-1);
  if (floor === undefined) {
    return { versions: [...input.versions], events: [...input.events] };
  }
  return {
    versions: input.versions.filter(v => v.createdAt >= floor),
    events: input.events.filter(e => e.occurredAt >= floor),
  };
}
