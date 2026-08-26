/**
 * The translation worklist — one language's outstanding work, across every
 * collection that has one.
 *
 * Everything below this already existed. A collection's list query accepts a
 * reserved `_translated` filter and turns it into a companion `EXISTS` /
 * `NOT EXISTS` condition (see `buildTranslationStatusCondition`), and the admin
 * already offers that filter on a single collection's table. What nobody could
 * ask is the question a translator actually has — *what needs me, anywhere?* —
 * because every surface answers for one collection at a time.
 *
 * So this adds the fan-out and nothing else. The filter, the SQL, the state
 * vocabulary and the access rules are the ones already in use; a second
 * implementation of any of them would answer the same question differently
 * depending on which screen asked it, which is the failure the whole R-11 lane
 * exists to undo.
 *
 * ## Why the fan-out is here and not in the browser
 *
 * Each localized collection has its own table and its own companion table, so
 * "one SQL query" is not available without a union over tables that are created
 * at runtime. The fan-out is real either way; putting it on the server buys the
 * three things that matter: one round-trip, a merge that happens before the
 * slice (so the list can be ordered globally rather than per collection), and
 * one place where access is decided.
 *
 * `getRecentEntries` on the dashboard established this shape, including the cap.
 * This differs from it in one respect deliberately — see below.
 *
 * ## Access
 *
 * Rows come from `listEntries` with the caller's `user`, so the collection's
 * stored read rules run per row. The dashboard filters at COLLECTION level
 * instead, which is coarser than it looks: a role that may read a collection but
 * only its own entries would have every other author's titles listed back to it.
 * A worklist is a list of titles, so that distinction is the whole of its
 * safety.
 *
 * @module domains/i18n/services/translation-worklist-service
 */

import type { TranslationFilterState } from "../companion-join";

/**
 * How many collections the fan-out will query.
 *
 * Matches the dashboard's cap, for the same reason: a site with a hundred
 * collections would otherwise issue a hundred queries to draw one screen.
 */
export const MAX_WORKLIST_COLLECTIONS = 20;

/** One document's outstanding work in one language. */
export interface TranslationWorkRow {
  /** The collection's slug, which is also how the row is opened. */
  collection: string;
  /** Its plural label, because the row is read by a person, not a route. */
  collectionLabel: string;
  id: string;
  /** The document's title in the DEFAULT language — the thing being translated. */
  title: string;
  /** ISO 8601. The merge orders on this, so it is required rather than optional. */
  updatedAt: string;
}

export interface TranslationWorklistResult {
  rows: TranslationWorkRow[];
  /**
   * Collections the cap kept out of this answer, named rather than dropped.
   *
   * A worklist that silently omits a collection reads as "nothing to do there",
   * which is the most reassuring possible way to be wrong — and indistinguishable
   * from the truth at a glance. The caller is expected to say so on screen.
   */
  skippedCollections: string[];
}

/** What the fan-out needs to know about one collection to query it. */
export interface LocalizedCollectionRef {
  slug: string;
  label: string;
  /** Whether it has the draft/published lifecycle at all. */
  hasStatus: boolean;
}

/**
 * A row's id as a string, or `""` when it is neither a string nor a number.
 *
 * Narrowed rather than `String(row.id)`: an id that arrived as an object would
 * stringify to "[object Object]", which is a plausible-looking URL segment that
 * addresses nothing. Empty is the honest answer, and the caller can see it.
 */
export function worklistId(row: Record<string, unknown>): string {
  const id = row.id;
  if (typeof id === "string") return id;
  if (typeof id === "number") return String(id);
  return "";
}

/**
 * Read one document's title without inventing a rule for it.
 *
 * `useAsTitle` is the collection's own answer and is preferred wherever it is
 * declared. The rest is the fallback the dashboard already uses, kept identical
 * so one document cannot be called two different things on two screens. The id
 * is the last resort and is never blank, so a row is always addressable even
 * when nothing names it.
 */
export function worklistTitle(
  row: Record<string, unknown>,
  useAsTitle: string | undefined
): string {
  const candidates = [
    useAsTitle === undefined ? undefined : row[useAsTitle],
    row.title,
    row.name,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim() !== "") return value;
    if (typeof value === "number") return String(value);
  }
  return worklistId(row);
}

/** Normalise whatever the adapter returned for a timestamp into ISO 8601. */
export function worklistUpdatedAt(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value.trim() !== "") return value;
  return "";
}

/**
 * Order the merged rows: most recently touched first.
 *
 * Sorted AFTER the merge rather than relying on each collection's own order,
 * which is the point of doing the fan-out server-side. A row with no usable
 * timestamp sorts last rather than first — an unknown date is not a fresh one,
 * and putting it at the top would let a collection with broken timestamps
 * dominate every page of the list.
 */
export function byMostRecentlyUpdated(
  a: TranslationWorkRow,
  b: TranslationWorkRow
): number {
  const at = Date.parse(a.updatedAt);
  const bt = Date.parse(b.updatedAt);
  const aOk = Number.isFinite(at);
  const bOk = Number.isFinite(bt);
  if (!aOk && !bOk) return 0;
  if (!aOk) return 1;
  if (!bOk) return -1;
  return bt - at;
}

/**
 * Which collections can honestly answer this question, before the cap sees them.
 *
 * Two exclusions, and both must happen BEFORE `planWorklistFanOut` rather than
 * after.
 *
 * A collection the caller cannot read must not consume one of the capped slots.
 * If it does, a readable collection further down the alphabet is pushed into
 * `skippedCollections` — where its outstanding work is never queried, and where
 * its slug is reported back to someone with no right to know it exists.
 *
 * And a lifecycle state is a question a statusless collection cannot answer:
 * the companion condition is deliberately absent there, so the query returns
 * EVERY document and the worklist presents all of them as being in the state
 * that was asked for. Contributing nothing is the truthful answer; contributing
 * everything is the worst available one.
 */
export function eligibleCollections<T extends LocalizedCollectionRef>(
  localized: readonly T[],
  state: TranslationFilterState,
  readable: ReadonlySet<string> | undefined
): T[] {
  const wantsLifecycle = state === "draft" || state === "published";
  return localized.filter(
    c =>
      (readable === undefined || readable.has(c.slug)) &&
      (!wantsLifecycle || c.hasStatus)
  );
}

/**
 * Which collections the fan-out will touch, and which the cap excluded.
 *
 * Ordered by slug before the cap applies, so the same site always yields the
 * same answer. Taking whatever order the registry happened to return would make
 * "which collections were skipped" vary between two identical requests.
 */
export function planWorklistFanOut(
  localized: readonly LocalizedCollectionRef[],
  max: number = MAX_WORKLIST_COLLECTIONS
): { queried: LocalizedCollectionRef[]; skippedCollections: string[] } {
  const ordered = [...localized].sort((a, b) => a.slug.localeCompare(b.slug));
  return {
    queried: ordered.slice(0, max),
    skippedCollections: ordered.slice(max).map(c => c.slug),
  };
}

/**
 * The reserved filter the collection list already understands.
 *
 * Built here so the worklist and the entry table cannot come to disagree about
 * its shape: the extractor reads `_translated` at the TOP level only, never
 * nested inside `and`, and a filter written the other way is silently ignored
 * — it would return every entry and read as "nothing outstanding".
 */
export function translatedFilter(
  locale: string,
  state: TranslationFilterState
): Record<string, unknown> {
  return { _translated: { locale, state } };
}
