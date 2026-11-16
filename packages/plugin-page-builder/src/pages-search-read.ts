/**
 * The search itself: each page collection read as the caller, a few at a
 * time, merged by title or by collection, with where each page stands and
 * the cursor for the next page.
 *
 * Part of the pages search. `pages-search-route.ts` is the entry, and its
 * header explains what the search reads, who decides access, and paging.
 *
 * @module pages-search-read
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import type { PaginationMeta, WhereFilter } from "nextly";
import {
  IN_RELEASE_KEY,
  PENDING_CHANGE_KEY,
} from "nextly/reserved-filter-keys";

import { NO_MATCH, searchOn } from "./entries-route";
import {
  idsKeptByWorkflowKey,
  type AsCallerFindArgs,
  type AsCallerPage,
} from "./entry-reads";
import {
  type PageCollection,
  pageCollections,
  recordNamed,
  templateFields,
} from "./pages-search-collections";
import type { PageItem, PagesSearchResponse } from "./pages-search-contract";
import {
  refusesField,
  itemOf,
  topKeyOf,
  pageStateOf,
} from "./pages-search-items";
import {
  STATUS_COLUMN,
  type PagesSearchRequest,
  type PagesCursor,
  encodePagesCursor,
} from "./pages-search-request";

/**
 * Page collections in the order a search by collection lists them: the
 * plugin's own Pages (`primary`) first, then the others by the name their
 * heading shows. A search by title does not depend on it.
 */
function inListingOrder(
  sources: readonly PageCollection[],
  primary: string
): PageCollection[] {
  const shown = (source: PageCollection) => source.pluralLabel ?? source.label;
  return [...sources].sort(
    (a, b) =>
      Number(b.slug === primary) - Number(a.slug === primary) ||
      shown(a).localeCompare(shown(b), "en", { sensitivity: "base" }) ||
      byCodePoint(a.slug, b.slug)
  );
}

/** One as-caller list read, as the search asks the Direct API for it. */
export type PagesFindArgs = AsCallerFindArgs;

/**
 * What the search reads with, injected so the decisions in
 * {@link readPagesSearch} can be tested without a server.
 */
export interface PagesSearchReads {
  /** Every collection the registry holds, as configured. */
  collections(): Promise<readonly unknown[]>;
  /** The plugin's composition stores, which hold blocks and are not pages. */
  stores(): ReadonlySet<string>;
  /** The plugin's own pages collection, resolved: listed first by collection. */
  pagesCollection(): string;
  /** Where the plugin's own pages are served (`pagePreviewPath`), if stated. */
  pagePath?(): string | undefined;
  /** One list read, AS THE CALLER. */
  find(args: PagesFindArgs): Promise<AsCallerPage>;
  /** Say, to the operator, that a collection was left out of a search and why. */
  warn(message: string, context: Record<string, unknown>): void;
}

/** One openable row of a collection's read, and where in that read it sits. */
interface Hit {
  readonly item: PageItem;
  /** Its index in the collection's read order, counting every row read. */
  readonly at: number;
}

/**
 * What one collection contributes, from where the cursor left it: its next
 * openable rows by title, how far its read reached, and its match count.
 */
interface CollectionHits {
  readonly hits: readonly Hit[];
  /** The row index the read reached: every row before it has been judged. */
  readonly reached: number;
  /** Whether rows past `reached` match and were not read. */
  readonly more: boolean;
  /**
   * An upper bound on its matches: the rows behind the cursor, the openable
   * rows read, and every match not read.
   */
  readonly total: number;
}

/** A collection that contributes nothing, its position kept where it was. */
function noHits(start: number): CollectionHits {
  return { hits: [], reached: start, more: false, total: 0 };
}

/**
 * How many collections one search reads at a time. A site may declare many
 * page collections, and a search runs on every keystroke, so their reads take
 * turns rather than all opening at once; two keeps the common one- or
 * two-collection site a single round.
 */
const READS_AT_ONCE = 2;

/**
 * The most pages of `limit` rows one search reads from one collection.
 *
 * A row whose Page Builder field the caller may not read is dropped after it
 * is read, so a collection is read on, page by page, until it yields `limit`
 * openable rows or its matches run out. Bounded, so a collection that
 * withholds nearly everything cannot make one keystroke scan its table: at
 * most this many times `limit` rows.
 */
const PAGES_PER_COLLECTION = 3;

/**
 * Answer one search: read each page collection as the caller from where the
 * cursor left it, merge, and say where each returned page stands.
 *
 * Each collection is read in the database's title order until it yields
 * `limit` openable rows, and the merge only ever takes a prefix of each, so a
 * row a collection's read left out is never one the merge would have chosen.
 */
export async function readPagesSearch(
  request: PagesSearchRequest,
  reads: PagesSearchReads
): Promise<PagesSearchResponse> {
  const primary = reads.pagesCollection();
  const template = reads.pagePath?.();
  const records = await reads.collections();
  const sources = inListingOrder(
    pageCollections(records, reads.stores()),
    primary
  ).map(source =>
    template !== undefined && source.slug === primary
      ? {
          ...source,
          pathTemplate: template,
          pathFields: templateFields(template, recordNamed(records, primary)),
        }
      : source
  );
  const hits = await inTurns(sources, READS_AT_ONCE, source =>
    searchCollection(source, request, reads)
  );
  const merged =
    request.order === "collection"
      ? mergeByCollection(hits, request.limit)
      : mergeByTitle(hits, request.limit);
  const items = await withStates(merged.items, sources, reads);
  return { items, meta: mergedMeta(request, sources, hits, merged.taken) };
}

/** `work` over `items`, at most `size` at a time, answers in `items` order. */
async function inTurns<T, R>(
  items: readonly T[],
  size: number,
  work: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  for (let at = 0; at < items.length; at += size) {
    results.push(...(await Promise.all(items.slice(at, at + size).map(work))));
  }
  return results;
}

/** The merge's answer: the items, and how many it took from each collection. */
interface Merged {
  readonly items: PageItem[];
  readonly taken: number[];
}

/**
 * The first `limit` items of several lists, each already in its database's
 * title order, merged by taking the lowest head each time.
 *
 * Each list is consumed as a prefix and never re-sorted. A database orders
 * titles by its own collation, which differs by dialect (byte order on
 * SQLite, a locale's rules on PostgreSQL and MySQL) and which no comparator
 * here could reproduce for all three; re-sorting the rows by another order
 * could rank a row the database cut first. Heads are compared by code point,
 * which is SQLite's order exactly, so there the answer is the true first
 * `limit` by title across every collection.
 *
 * The merge stops early when a list runs out while its collection has rows
 * it did not read (its read reached its bound): one of those could come next,
 * so taking another collection's head instead could put a row before one that
 * sorts ahead of it. The next page reads that collection on from where it
 * stopped, so what is left out here is answered there.
 */
function mergeByTitle(lists: readonly CollectionHits[], limit: number): Merged {
  const taken = lists.map(() => 0);
  const items: PageItem[] = [];
  while (items.length < limit) {
    if (
      lists.some((list, index) => list.more && exhausted(list, taken, index))
    ) {
      break;
    }
    const next = lowestHead(lists, taken);
    if (next === undefined) break;
    items.push(next.item);
    taken[next.list] = (taken[next.list] ?? 0) + 1;
  }
  return { items, taken };
}

/**
 * The first `limit` items of several lists, in list order: each collection's
 * pages together, in its database's title order, and the lists already in the
 * order {@link pageCollections} gives them.
 *
 * It stops at a list that ran out while its collection has rows it did not
 * read: those come before any later collection's, and the next page reads
 * them on from where this one stopped.
 */
function mergeByCollection(
  lists: readonly CollectionHits[],
  limit: number
): Merged {
  const taken = lists.map(() => 0);
  const items: PageItem[] = [];
  for (const [index, list] of lists.entries()) {
    for (const hit of list.hits) {
      if (items.length >= limit) return { items, taken };
      items.push(hit.item);
      taken[index] = (taken[index] ?? 0) + 1;
    }
    if (list.more) break;
  }
  return { items, taken };
}

/** Whether the merge has taken every row list `index` read. */
function exhausted(
  list: CollectionHits,
  taken: readonly number[],
  index: number
): boolean {
  return (taken[index] ?? 0) >= list.hits.length;
}

/** The lowest untaken head across `lists`, and which list it heads. */
function lowestHead(
  lists: readonly CollectionHits[],
  taken: readonly number[]
): { item: PageItem; list: number } | undefined {
  let lowest: { item: PageItem; list: number } | undefined;
  lists.forEach((list, index) => {
    const head = list.hits[taken[index] ?? 0]?.item;
    if (head === undefined) return;
    if (lowest === undefined || byTitle(head, lowest.item) < 0) {
      lowest = { item: head, list: index };
    }
  });
  return lowest;
}

/**
 * Two items by title in code-point order, then collection, then id, so the
 * order never depends on which read answered first.
 */
function byTitle(a: PageItem, b: PageItem): number {
  return (
    byCodePoint(a.title, b.title) ||
    byCodePoint(a.collection, b.collection) ||
    byCodePoint(a.id, b.id)
  );
}

/**
 * Two strings by Unicode code point, the order SQLite's default collation
 * gives UTF-8 text. Not `<`, which compares UTF-16 code units and puts a
 * character above U+FFFF before one in U+E000 to U+FFFF.
 */
function byCodePoint(a: string, b: string): number {
  const left = [...a];
  const right = [...b];
  const shared = Math.min(left.length, right.length);
  for (let at = 0; at < shared; at += 1) {
    const step =
      (left[at]?.codePointAt(0) ?? 0) - (right[at]?.codePointAt(0) ?? 0);
    if (step !== 0) return step;
  }
  return left.length - right.length;
}

/**
 * Where a cursor left `slug`'s read: the rows behind it, or 0 for a collection
 * it does not name. An own property only, so a slug such as `constructor` is
 * never answered from the object's prototype.
 */
function positionIn(cursor: PagesCursor | undefined, slug: string): number {
  if (cursor === undefined || !Object.hasOwn(cursor.at, slug)) return 0;
  return cursor.at[slug] ?? 0;
}

/**
 * One collection's part of the search.
 *
 * A search that cannot match its title field (none, or one of a kind `contains`
 * does not apply to) reads nothing: whether core would let this caller read
 * the collection changes nothing about an answer that is empty either way.
 */
async function searchCollection(
  source: PageCollection,
  request: PagesSearchRequest,
  reads: PagesSearchReads
): Promise<CollectionHits> {
  const start = positionIn(request.before, source.slug);
  // One collection that cannot be read — a table out of step with its
  // schema, a hook that throws — must not hide every healthy one, so its
  // failure leaves just it out, and is told to the operator rather than the
  // caller, whose answer names nothing it could not see.
  try {
    return await readCollection(source, request, reads, start);
  } catch (error) {
    reads.warn("[page-builder] A collection was left out of a pages search.", {
      collection: source.slug,
      code: NextlyError.is(error) ? error.code : undefined,
      error: error instanceof Error ? error.message : String(error),
    });
    return noHits(start);
  }
}

/** One collection's part of the search, any failure left to the caller. */
async function readCollection(
  source: PageCollection,
  request: PagesSearchRequest,
  reads: PagesSearchReads,
  start: number
): Promise<CollectionHits> {
  const where = whereFor(source, request);
  if (where === NO_MATCH) return noHits(start);
  const first = await readRows(source, request, reads, where, start);
  if (first === undefined) return noHits(start);
  return readOn(source, request.limit, reads, first, start);
}

/**
 * The openable rows of one collection, read page by page from `start`.
 *
 * Each further read repeats the first, order included, from the row after the
 * last one read, so the rows kept are a prefix of the collection's openable
 * rows from `start` in the database's order. Reading stops at `limit` openable
 * rows, at the end of the matches, or at {@link PAGES_PER_COLLECTION} reads.
 *
 * The total is the rows behind `start`, the openable rows read, and every match
 * not read, whose rows were never judged: an upper bound, exact once the read
 * reached the end (see `PagesSearchResponse`).
 */
async function readOn(
  source: PageCollection,
  limit: number,
  reads: PagesSearchReads,
  first: FirstRead,
  start: number
): Promise<CollectionHits> {
  const hits: Hit[] = [];
  let scanned = 0;
  let page = first.page;
  for (let number = 1; ; number += 1) {
    hits.push(...openableHits(page.items, source, start + scanned));
    scanned += page.items.length;
    if (!readsOnPast(page, number, hits.length, limit)) break;
    page = await reads.find({ ...first.args, offset: start + scanned });
  }
  const reached = start + scanned;
  const unread = Math.max(0, page.meta.total - reached);
  return {
    hits,
    reached,
    more: unread > 0,
    total: start + hits.length + unread,
  };
}

/** Whether a collection's read goes on past page `number`. */
function readsOnPast(
  page: AsCallerPage,
  number: number,
  kept: number,
  limit: number
): boolean {
  return (
    kept < limit &&
    page.meta.hasNext &&
    page.items.length > 0 &&
    number < PAGES_PER_COLLECTION
  );
}

/**
 * The rows of one read that are search results, in the order read, each with
 * its index in the collection's read (`from` is the first row's).
 */
function openableHits(
  rows: readonly unknown[],
  source: PageCollection,
  from: number
): Hit[] {
  return rows.flatMap((row, index) => {
    const item = itemOf(row, source);
    return item === undefined ? [] : [{ item, at: from + index }];
  });
}

/**
 * The where clause for one collection's read: the search on its title field,
 * the excluded page, both, or neither; {@link NO_MATCH} when the search cannot
 * match this collection's title field at all.
 */
function whereFor(
  source: PageCollection,
  request: PagesSearchRequest
): WhereFilter | typeof NO_MATCH | undefined {
  const conditions: WhereFilter[] = [];
  if (request.search !== undefined) {
    const searched = searchOn(request.search, source.title);
    if (searched === NO_MATCH) return NO_MATCH;
    conditions.push(searched);
  }
  // Dropped in the database, so the limit and the total count the pages the
  // author can go to, not the one already open.
  if (request.exclude?.collection === source.slug) {
    conditions.push({ id: { not_equals: request.exclude.id } });
  }
  if (conditions.length === 0) return undefined;
  return conditions.length === 1 ? conditions[0] : { and: conditions };
}

/**
 * The read for one collection, unordered, from row `start` of it. The columns
 * each item needs and no others; `id` is named so a collection with no title
 * field still selects something, since an empty selection selects every field.
 */
function unorderedRead(
  source: PageCollection,
  request: PagesSearchRequest,
  where: WhereFilter | undefined,
  start: number
): PagesFindArgs {
  const titleName = source.title?.name;
  return {
    collection: source.slug,
    ...(where === undefined ? {} : { where }),
    select: {
      id: true,
      ...(titleName === undefined ? {} : { [titleName]: true }),
      ...(source.lifecycle ? { [STATUS_COLUMN]: true } : {}),
      // Every field the item's path is resolved from.
      ...Object.fromEntries(
        (source.pathFields ?? []).map(name => [name, true] as const)
      ),
      // The Page Builder field itself (its top-level key, for a field inside
      // a group), so core's field-level read decides whether this caller may
      // open what the item links to: a field it withholds comes back absent.
      [topKeyOf(source.field)]: true,
    },
    limit: request.limit,
    // Where the cursor left this collection; the first read of a search
    // starts at the first row and names none.
    ...(start === 0 ? {} : { offset: start }),
    // In the language being edited, so a localized title is matched, ordered
    // and named as the author sees it. Every later page of the search repeats
    // this read, so it keeps the language too.
    ...(request.locale === undefined ? {} : { locale: request.locale }),
  };
}

/** A collection's first page, with the read that answered it, for the next pages. */
interface FirstRead {
  readonly args: PagesFindArgs;
  readonly page: AsCallerPage;
}

/**
 * Read one collection's first page from `start` as the caller, ordered by title and then
 * id so the rows a limit keeps are a stable prefix of the database's title
 * order; `undefined` when core leaves this caller nothing of it.
 *
 * Core refusing the collection leaves its pages out, and the rest of the
 * search still answers: the refusal is core's, applied. A caller who may read
 * the pages but not their title field is refused a filter or an order on it:
 * a search on the title then matches nothing for them, and a plain listing is
 * read again ordered by id alone, each page labelled untitled as its row
 * carries none.
 */
async function readRows(
  source: PageCollection,
  request: PagesSearchRequest,
  reads: PagesSearchReads,
  where: WhereFilter | undefined,
  start: number
): Promise<FirstRead | undefined> {
  const unordered = unorderedRead(source, request, where, start);
  const titleName = source.title?.name;
  const ordered: PagesFindArgs = {
    ...unordered,
    sort: titleName === undefined ? ["id"] : [titleName, "id"],
  };
  try {
    return { args: ordered, page: await reads.find(ordered) };
  } catch (error) {
    if (NextlyError.isForbidden(error)) return undefined;
    if (titleName === undefined || !refusesField(error, titleName)) throw error;
    if (request.search !== undefined) return undefined;
    // The read that answers is the one the next pages repeat, so they keep
    // its order.
    const byId: PagesFindArgs = { ...unordered, sort: ["id"] };
    return { args: byId, page: await reads.find(byId) };
  }
}

/**
 * `items` with where each stands in publishing, read once per Draft/Published
 * collection on the page.
 */
async function withStates(
  items: readonly PageItem[],
  sources: readonly PageCollection[],
  reads: PagesSearchReads
): Promise<PageItem[]> {
  const asked = sources.filter(
    source =>
      source.lifecycle && items.some(item => item.collection === source.slug)
  );
  const facts = new Map(
    await inTurns(asked, READS_AT_ONCE, async source => {
      const ids = items
        .filter(item => item.collection === source.slug)
        .map(item => item.id);
      // One after the other, so a page's reads take the turn its collection
      // was given rather than opening two at once.
      const changed = await idsMatching(source, ids, PENDING_CHANGE_KEY, reads);
      const scheduled = await idsMatching(source, ids, IN_RELEASE_KEY, reads);
      return [source.slug, { changed, scheduled }] as const;
    })
  );
  return items.map(item => {
    const known = facts.get(item.collection);
    const pending = known?.changed.has(item.id) === true;
    const state = pageStateOf(
      item.status,
      pending,
      known?.scheduled.has(item.id) === true
    );
    return {
      ...item,
      ...(state === undefined ? {} : { state }),
      // Said apart from the state: a scheduled page shows "Scheduled" even
      // when it also holds changes, and what a copy would read depends on it.
      ...(pending ? { pendingChange: true as const } : {}),
    };
  });
}

/**
 * Which of `ids` core's workflow filter `key` keeps, read AS THE CALLER.
 *
 * Core's own reading, not one here: `_pendingChange` keeps an entry whose
 * working draft holds changes not yet published, by the versions domain's one
 * statement of what a working draft is (the fact behind the admin's
 * `hasWorkingDraft`), and `_inRelease` keeps one a scheduled release will
 * publish after now. Only ids are selected, and the ids already bound the read.
 *
 * Nothing is kept when the read fails: the state is a label, never worth the
 * list. Core refuses `_inRelease` to a caller who may not read releases, and
 * that refusal is an answer, not a fault: such a caller is told nothing about
 * a release. Any other failure is told to the operator.
 */
async function idsMatching(
  source: PageCollection,
  ids: readonly string[],
  key: typeof PENDING_CHANGE_KEY | typeof IN_RELEASE_KEY,
  reads: PagesSearchReads
): Promise<ReadonlySet<string>> {
  try {
    // The shared read, which the template preview's list asks too.
    return await idsKeptByWorkflowKey(
      async args => await reads.find(args),
      source.slug,
      ids,
      key
    );
  } catch (error) {
    const refused =
      key === IN_RELEASE_KEY &&
      (NextlyError.isValidation(error) || NextlyError.isForbidden(error));
    if (!refused) {
      reads.warn("[page-builder] A pages search left out where pages stand.", {
        collection: source.slug,
        filter: key,
        code: NextlyError.is(error) ? error.code : undefined,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return new Set();
  }
}

/**
 * The merged answer's pagination, in the canonical list meta, with the cursor
 * for the next page in `nextBefore`.
 *
 * Each collection's next position is the row after the last one the merge
 * took from it; where the merge took every row its read kept, the rows read
 * past them were all withheld, so it is where the read reached. `hasNext` says
 * a collection holds a row the merge left, or matches its read did not reach.
 */
function mergedMeta(
  request: PagesSearchRequest,
  sources: readonly PageCollection[],
  hits: readonly CollectionHits[],
  taken: readonly number[]
): PaginationMeta {
  const at: Record<string, number> = {};
  let hasNext = false;
  sources.forEach((source, index) => {
    const read = hits[index];
    if (read === undefined) return;
    const next = read.hits[taken[index] ?? 0];
    const position = next === undefined ? read.reached : next.at;
    if (position > 0) at[source.slug] = position;
    hasNext ||= next !== undefined || read.more;
  });
  const total = hits.reduce((sum, read) => sum + read.total, 0);
  const page = request.before?.page ?? 1;
  return {
    total,
    page,
    limit: request.limit,
    totalPages: Math.ceil(total / request.limit),
    hasNext,
    hasPrev: page > 1,
    ...(hasNext
      ? { nextBefore: encodePagesCursor({ page: page + 1, at }) }
      : {}),
  };
}
