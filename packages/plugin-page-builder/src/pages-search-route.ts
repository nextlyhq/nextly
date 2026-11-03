/**
 * The read behind the editor's page search: the site's pages, searched by
 * title, as `{ id, collection, collectionLabel, field, title, status? }`.
 *
 * ## Which collections it reads
 *
 * Only a collection that declares a Page Builder field the editor can open
 * (`blocksFieldsOf`, the plugin's one reading of which blocks fields a
 * collection holds at an addressable path), read from the LIVE registry so a
 * collection the Schema Builder adds later is found too. Never any other
 * collection, and never the plugin's own composition stores — patterns and
 * components hold a blocks field too, but they are what pages are built FROM,
 * not pages. A site with no such collection answers an empty list.
 *
 * ## Who decides what the caller may read
 *
 * Core, and nothing here. Every read runs through the Direct API AS THE CALLER
 * (`findAsCaller`): `overrideAccess: false` with the identity the dispatcher
 * resolved, so each collection's read rule, row filters and field-level read
 * rules apply exactly as they do to the caller's own reads. A collection core
 * refuses this caller contributes nothing, rather than refusing the whole
 * search: the search spans collections, and the caller asked about none of
 * them by name. The registry listing that picks the collections is
 * configuration, not content, and nothing of a collection travels unless the
 * caller's own read of it returned a row.
 *
 * ## What travels
 *
 * The id, the title (core's title rule, as the entries route names an entry),
 * the collection and its label, the Page Builder field's name so the client can
 * build the editor's address, and the status where the collection has the
 * Draft/Published lifecycle. Only those columns are selected, the search and
 * the limit are applied in the database, and each collection is read once.
 *
 * ## Paging, and where each page stands
 *
 * A cursor carries each collection's position in its own read, so the next
 * page resumes every read where the merge stopped taking from it (see
 * `PagesSearchResponse`). Each returned page of a Draft/Published collection
 * also says where it stands in publishing (`PageState`), from core's own
 * workflow filters read as the caller: two reads per collection, over the ids
 * on the page.
 *
 * The same reading of which collections hold pages serves the Pages panel's
 * writes (`pages-write-route`), so a collection is a page collection for both
 * or for neither.
 *
 * @module pages-search-route
 */
import type { DocumentKind } from "@nextlyhq/blocks-engine";
import {
  NextlyError,
  resolvedCollectionView,
  type PluginRouteContext,
} from "@nextlyhq/plugin-sdk";
import { respondList, type PaginationMeta, type WhereFilter } from "nextly";
import {
  IN_RELEASE_KEY,
  PENDING_CHANGE_KEY,
} from "nextly/reserved-filter-keys";
import { z } from "nextly/zod";

import { COMPONENTS_SLUG } from "./collections/components";
import { PATTERNS_SLUG } from "./collections/patterns";
import {
  NO_MATCH,
  searchOn,
  titleFieldIn,
  type TitleField,
} from "./entries-route";
import {
  entryOf,
  findAsCaller,
  type AsCallerFindArgs,
  type AsCallerPage,
} from "./entry-reads";
import { acceptedKinds, acceptsKind } from "./fields/blocks-options";
import { DEFAULT_COMPONENT_STORE, type ComponentStore } from "./library-route";
import { editorBlocksFields } from "./nested-blocks-fields";
import {
  PAGES_SEARCH_CURSOR_MAX,
  PAGES_SEARCH_EXCLUDE_SEPARATOR,
  PAGES_SEARCH_LIMIT_DEFAULT,
  PAGES_SEARCH_LIMIT_MAX,
  PAGES_SEARCH_MAX,
  PAGES_SEARCH_PARAMS,
  PAGES_SEARCH_ROUTE_PATH,
  type PageItem,
  type PageReference,
  type PageState,
  type PageStatus,
  type PagesSearchResponse,
} from "./pages-search-contract";
import { cappedLimit, optionalText, parseRouteQuery } from "./route-query";

/**
 * The longest collection slug or id `exclude` accepts. Ids are uuids or short
 * integers and slugs are short names; a bound keeps one oversized value from
 * travelling into a where clause.
 */
const EXCLUDE_PART_MAX = 200;

/**
 * The column core keeps a Draft/Published collection's state in, which a
 * collection with `status: true` has and every other collection lacks.
 */
const STATUS_COLUMN = "status";

/** A search the route will make, once its query has been checked. */
export interface PagesSearchRequest {
  /** Trimmed, non-empty, at most {@link PAGES_SEARCH_MAX} characters. */
  readonly search?: string;
  /** Between 1 and {@link PAGES_SEARCH_LIMIT_MAX}. */
  readonly limit: number;
  /** The page left out, ordinarily the one being edited. */
  readonly exclude?: PageReference;
  /** Where an earlier page of the same search stopped; the first page when absent. */
  readonly before?: PagesCursor;
}

/**
 * Where a search stopped: how many pages it has answered, and for each
 * collection how many rows of its read, in that read's own order, are behind
 * it. A collection it names no position for starts at its first row.
 */
export interface PagesCursor {
  /** The page this cursor opens, from 2. */
  readonly page: number;
  readonly at: Readonly<Record<string, number>>;
}

/** The most collections one cursor names, and the furthest row and page it may. */
const CURSOR_COLLECTIONS_MAX = 200;
const CURSOR_ROW_MAX = 1_000_000_000;
const CURSOR_PAGE_MAX = 1_000_000;

/** A cursor's decoded shape; anything else is not a cursor this route wrote. */
const cursorShape = z.strictObject({
  page: z.number().int().min(2).max(CURSOR_PAGE_MAX),
  at: z
    .record(
      z.string().min(1).max(200),
      z.number().int().min(0).max(CURSOR_ROW_MAX)
    )
    .refine(at => Object.keys(at).length <= CURSOR_COLLECTIONS_MAX),
});

/**
 * A cursor as the route writes it: its JSON, base64url-encoded, so it travels
 * in a query string as one opaque value the client hands back unread.
 */
function encodePagesCursor(cursor: PagesCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

/** A cursor's JSON, or `undefined` for a value that is not base64url JSON. */
function decodeCursor(value: string): unknown {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
}

/**
 * `exclude` as written, split at its FIRST separator so an id may hold more.
 * No separator leaves the id empty, which the schema below refuses.
 */
function splitReference(value: string): { collection: string; id: string } {
  const at = value.indexOf(PAGES_SEARCH_EXCLUDE_SEPARATOR);
  if (at === -1) return { collection: value.trim(), id: "" };
  return {
    collection: value.slice(0, at).trim(),
    id: value.slice(at + PAGES_SEARCH_EXCLUDE_SEPARATOR.length).trim(),
  };
}

/**
 * The query, as zod reads it. The limit and the search take the shapes every
 * editor read route shares; `exclude` with either half empty is refused, since
 * it would name no page.
 */
const querySchema = z.object({
  [PAGES_SEARCH_PARAMS.q]: optionalText(PAGES_SEARCH_MAX),
  [PAGES_SEARCH_PARAMS.limit]: cappedLimit(PAGES_SEARCH_LIMIT_MAX).optional(),
  [PAGES_SEARCH_PARAMS.exclude]: z
    .string()
    .transform(splitReference)
    .pipe(
      z.object({
        collection: z.string().min(1).max(EXCLUDE_PART_MAX),
        id: z.string().min(1).max(EXCLUDE_PART_MAX),
      })
    )
    .optional(),
  // Decoded and checked here, so a cursor the route did not write is refused
  // at the boundary like any other parameter, its value never echoed.
  [PAGES_SEARCH_PARAMS.before]: z
    .string()
    .max(PAGES_SEARCH_CURSOR_MAX)
    .transform(decodeCursor)
    .pipe(cursorShape)
    .optional(),
});

/**
 * Read the request's query into a {@link PagesSearchRequest}, or refuse it,
 * through the shared parse-or-refuse step: a refusal names the parameter and
 * never echoes its value.
 */
export function parsePagesSearchQuery(url: string | URL): PagesSearchRequest {
  const query = parseRouteQuery(
    url,
    Object.values(PAGES_SEARCH_PARAMS),
    querySchema,
    "pages search"
  );
  const search = query[PAGES_SEARCH_PARAMS.q];
  const exclude = query[PAGES_SEARCH_PARAMS.exclude];
  const before = query[PAGES_SEARCH_PARAMS.before];
  return {
    ...(search === undefined ? {} : { search }),
    limit: query[PAGES_SEARCH_PARAMS.limit] ?? PAGES_SEARCH_LIMIT_DEFAULT,
    ...(exclude === undefined ? {} : { exclude }),
    ...(before === undefined ? {} : { before }),
  };
}

/**
 * One collection that holds pages, with what each of its items needs and what
 * a new page of it is made with.
 */
export interface PageCollection {
  readonly slug: string;
  readonly label: string;
  /** The plural name the registry holds, when it holds one. */
  readonly pluralLabel?: string;
  /**
   * The Page Builder field the editor opens for, by its form path: the first
   * one the editor reaches that accepts page documents.
   */
  readonly field: string;
  /** The field that names its entries, or `undefined` for none. */
  readonly title?: TitleField;
  /** Whether it has the Draft/Published lifecycle, and so a status column. */
  readonly lifecycle: boolean;
  /**
   * The document kinds that field declares, or `undefined` where it declares
   * none: what the field's own empty document is made from.
   */
  readonly kinds?: readonly DocumentKind[];
  /**
   * The top-level text field named `slug`, where the collection has one, and
   * whether its values must be unique.
   */
  readonly slugField?: { readonly name: string; readonly unique: boolean };
}

/**
 * The collections a search reads, from the registry's records, in slug order,
 * each slug once.
 */
function pageCollections(
  records: readonly unknown[],
  stores: ReadonlySet<string>
): PageCollection[] {
  const found = new Map<string, PageCollection>();
  for (const value of records) {
    const source = pageCollectionOf(value, stores);
    if (source !== undefined && !found.has(source.slug)) {
      found.set(source.slug, source);
    }
  }
  return [...found.values()].sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * One registry record as a page collection, or `undefined` when it is not one.
 *
 * A record counts when its schema is live, it declares a blocks field at an
 * addressable path and it is not one of `stores`, the plugin's composition
 * stores. A record whose slug cannot be read is skipped: there is no
 * collection to address. Where a
 * collection declares several blocks fields, its pages are listed once, under
 * the first: a page is one result however many fields it has.
 */
function pageCollectionOf(
  value: unknown,
  stores: ReadonlySet<string>
): PageCollection | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const slug = slugOf(record);
  if (slug === undefined || stores.has(slug)) return undefined;
  if (!schemaIsLive(record)) return undefined;
  // The editor's own reading of which blocks fields it opens (top level or
  // inside groups, by form path), and the field's own kinds: a field that
  // holds only components or patterns does not make its rows pages.
  const field = editorBlocksFields(record).find(declared =>
    acceptsKind(declared.declaration, "page")
  );
  if (field === undefined) return undefined;
  return {
    slug,
    label: labelOf(record, slug),
    ...pluralLabelOf(record),
    field: field.path,
    // Core's projection of a registry record, which reads the lifecycle
    // switch only when it is a real boolean.
    lifecycle: resolvedCollectionView(record).status === true,
    ...declaredFacts(record, field.declaration),
  };
}

/**
 * What a page collection's record declares that only some collections do:
 * the field naming its pages, the kinds its Page Builder field accepts, and a
 * slug field. Each is left out where the record declares none.
 */
function declaredFacts(
  record: Record<string, unknown>,
  declaration: object
): Pick<PageCollection, "title" | "kinds" | "slugField"> {
  const title = titleFieldIn(record);
  const kinds = acceptedKinds(declaration);
  const slugField = slugFieldOf(record);
  return {
    ...(title === undefined ? {} : { title }),
    ...(kinds === undefined ? {} : { kinds }),
    ...(slugField === undefined ? {} : { slugField }),
  };
}

/** The field name a page's address is conventionally stored under. */
const SLUG_FIELD = "slug";

/**
 * A record's top-level `slug` text field, and whether it is unique, or
 * `undefined` where it has none. Read from the same record the rest of the
 * collection is, so a write derives a slug only where one is stored.
 */
function slugFieldOf(
  record: Record<string, unknown>
): PageCollection["slugField"] {
  const fields = Array.isArray(record.fields) ? record.fields : [];
  for (const value of fields) {
    if (typeof value !== "object" || value === null) continue;
    const field = value as { name?: unknown; type?: unknown; unique?: unknown };
    if (field.name === SLUG_FIELD && field.type === "text") {
      return { name: SLUG_FIELD, unique: field.unique === true };
    }
  }
  return undefined;
}

/**
 * The page collection `slug` names among the registry's records, or
 * `undefined` when it names none: no such collection, a collection without an
 * addressable Page Builder field, one of `stores`, or one whose schema is not
 * live.
 */
function pageCollectionIn(
  records: readonly unknown[],
  stores: ReadonlySet<string>,
  slug: string
): PageCollection | undefined {
  return pageCollections(records, stores).find(source => source.slug === slug);
}

/**
 * The registry's `migrationStatus` values under which a collection's table is
 * known to match its schema: `synced` (a code-first collection, synced at
 * boot) and `applied` (a change whose migration ran and whose table was
 * verified). `pending`, `generated` and `failed` mean the schema may name a
 * column the table lacks yet, so reading it would fail.
 */
const LIVE_SCHEMA_STATES: ReadonlySet<string> = new Set(["synced", "applied"]);

/**
 * Whether a registry record's schema is live, by core's own `migrationStatus`.
 * A record that carries none is read: nothing says it is not live, and a read
 * that fails anyway drops only that collection (see `searchCollection`).
 */
function schemaIsLive(record: Record<string, unknown>): boolean {
  const state = record.migrationStatus;
  return typeof state !== "string" || LIVE_SCHEMA_STATES.has(state);
}

/** A record's slug, when it has a usable one. */
function slugOf(record: Record<string, unknown>): string | undefined {
  return typeof record.slug === "string" && record.slug !== ""
    ? record.slug
    : undefined;
}

/**
 * The label the registry listing already resolved (the singular name, or the
 * slug where there is none), rather than a second rule here.
 */
function labelOf(record: Record<string, unknown>, slug: string): string {
  return typeof record.label === "string" && record.label !== ""
    ? record.label
    : slug;
}

/** The plural name a registry record holds (`labels.plural`), if any. */
function pluralLabelOf(record: Record<string, unknown>): {
  pluralLabel?: string;
} {
  const labels = record.labels;
  if (typeof labels !== "object" || labels === null) return {};
  const plural = (labels as { plural?: unknown }).plural;
  return typeof plural === "string" && plural !== ""
    ? { pluralLabel: plural }
    : {};
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
  const sources = pageCollections(await reads.collections(), reads.stores());
  const hits = await inTurns(sources, READS_AT_ONCE, source =>
    searchCollection(source, request, reads)
  );
  const merged = mergeByTitle(hits, request.limit);
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
      // The Page Builder field itself (its top-level key, for a field inside
      // a group), so core's field-level read decides whether this caller may
      // open what the item links to: a field it withholds comes back absent.
      [topKeyOf(source.field)]: true,
    },
    limit: request.limit,
    // Where the cursor left this collection; the first read of a search
    // starts at the first row and names none.
    ...(start === 0 ? {} : { offset: start }),
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

/** The refusal codes core answers a filter or an order on an unreadable field with. */
const FIELD_REFUSALS: ReadonlySet<string> = new Set([
  "FIELD_NOT_FILTERABLE",
  "FIELD_NOT_SORTABLE",
]);

/**
 * Whether an error is core refusing a filter or an order on `field` because
 * this caller may not read it.
 *
 * Read from the validation error's own entries, which name the position and
 * the field, so an unrelated validation failure is never mistaken for one and
 * swallowed. The top-level code is also accepted, the shape the entries route
 * reads.
 */
function refusesField(error: unknown, field: string): boolean {
  if (!NextlyError.is(error)) return false;
  if (FIELD_REFUSALS.has(error.code)) return true;
  if (!NextlyError.isValidation(error)) return false;
  const data = error.publicData as { errors?: unknown } | undefined;
  if (!Array.isArray(data?.errors)) return false;
  return data.errors.some(entry => namesFieldRefusal(entry, field));
}

/** Whether one validation entry is a filter or order refusal naming `field`. */
function namesFieldRefusal(entry: unknown, field: string): boolean {
  if (typeof entry !== "object" || entry === null) return false;
  const { code, path } = entry as { code?: unknown; path?: unknown };
  return (
    typeof code === "string" &&
    FIELD_REFUSALS.has(code) &&
    (path === `where.${field}` || path === `sort.${field}`)
  );
}

/** One row as a search result, or nothing when it is not one the caller can open. */
function itemOf(row: unknown, source: PageCollection): PageItem | undefined {
  // A page whose Page Builder field this caller may not read is not one it
  // can open, so it is not listed. Core's field-level read decided that, by
  // leaving the field out of the row.
  if (!holdsField(row, source.field)) return undefined;
  return pageItemOf(row, source);
}

/**
 * One row as a page item, or nothing when it carries no usable id. Shared with
 * the writes, which answer the page they wrote in the shape the search lists.
 *
 * The id and title by the rule the entries route names an entry by, so an
 * untitled page carries the same neutral label. The status travels only from
 * a lifecycle collection, and only as one of the two values it holds.
 */
export function pageItemOf(
  row: unknown,
  source: PageCollection
): PageItem | undefined {
  const entry = entryOf(row, source.title?.name);
  if (entry === undefined) return undefined;
  const status = source.lifecycle ? statusOf(row) : undefined;
  return {
    id: entry.id,
    collection: source.slug,
    collectionLabel: source.label,
    ...(source.pluralLabel === undefined
      ? {}
      : { collectionPluralLabel: source.pluralLabel }),
    field: source.field,
    title: entry.title,
    ...(status === undefined ? {} : { status }),
  };
}

/** The top-level key a form path is stored under: `hero` for `hero.body`. */
function topKeyOf(path: string): string {
  return path.split(".")[0] ?? path;
}

/**
 * Whether a row carries the field at `path`, or core withheld it.
 *
 * Core withholds a field by DELETING its key from the row (there is no
 * marker), at the field's own level, inside a group as at the top. Only the
 * top-level key is evidence: it is a column the read selected, so it comes
 * back (as `null` when empty) unless it was withheld. Below it, an absent key
 * is also what a group stored before the field existed holds, so it says
 * nothing, and the page is listed: an editor that opens on a field it then
 * shows empty costs less than a page the author can open never being offered.
 */
function holdsField(row: unknown, path: string): boolean {
  return (
    typeof row === "object" &&
    row !== null &&
    Object.hasOwn(row, topKeyOf(path))
  );
}

/** A row's stored status, when it is one the lifecycle holds. */
function statusOf(row: unknown): PageStatus | undefined {
  const value = (row as Record<string, unknown>)[STATUS_COLUMN];
  return value === "draft" || value === "published" ? value : undefined;
}

/**
 * Where a page stands in publishing, from the facts the admin's status pill
 * is drawn from (`pillStateFromForm(status, false, hasWorkingDraft)`): its
 * stored status and whether a working draft waits on it; and, beside them,
 * whether a scheduled release will publish it, which the author must know
 * first. `undefined` for a plainly published page and for a page without the
 * lifecycle.
 */
export function pageStateOf(
  status: PageStatus | undefined,
  hasWorkingDraft: boolean,
  scheduled: boolean
): PageState | undefined {
  if (status === undefined) return undefined;
  if (scheduled) return "scheduled";
  if (status === "published") return hasWorkingDraft ? "changed" : undefined;
  return "draft";
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
    const state = pageStateOf(
      item.status,
      known?.changed.has(item.id) === true,
      known?.scheduled.has(item.id) === true
    );
    return state === undefined ? item : { ...item, state };
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
    const page = await reads.find({
      collection: source.slug,
      where: workflowWhere(key, ids),
      select: { id: true },
      limit: ids.length,
    });
    return new Set(
      page.items.flatMap(row => {
        const entry = entryOf(row, undefined);
        return entry === undefined ? [] : [entry.id];
      })
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
 * The ids, with one of core's reserved workflow keys at the filter's top
 * level, where core reads them.
 *
 * Asserted rather than typed: the keys take `true` itself, a form the
 * `WhereFilter` type, spelled for field conditions, does not describe. The
 * spelling is core's (`nextly/reserved-filter-keys`), so it is not restated.
 */
function workflowWhere(key: string, ids: readonly string[]): WhereFilter {
  const where: Record<string, unknown> = { id: { in: [...ids] }, [key]: true };
  return where as WhereFilter;
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

/** How many registry records one page of the listing asks for. */
const REGISTRY_PAGE_SIZE = 100;

/**
 * What decides which collections hold pages: the registry, and the plugin's
 * own resolved slugs, whose collections are composition stores.
 */
export interface PageCollectionsContext {
  readonly self: {
    readonly collections: Readonly<Record<string, string | undefined>>;
  };
  readonly services: {
    readonly collections: {
      listCollections(
        options: {
          page: number;
          limit: number;
          sortBy: "slug";
          sortOrder: "asc";
        },
        context: Record<string, never>
      ): Promise<unknown>;
    };
  };
}

/** The route context this reads: who is asking, its own slugs, and the registry. */
interface PagesSearchRouteContext extends PageCollectionsContext {
  readonly caller: PluginRouteContext["caller"];
  readonly logger: Pick<PluginRouteContext["logger"], "warn">;
}

/**
 * Every collection record the registry holds, paged until it says there are
 * no more.
 *
 * The listing carries each collection's fields, label and lifecycle switch, so
 * one read per hundred collections finds every page collection, with no read
 * per collection. Ordered by slug so the pages partition the rows. It stops on
 * an empty page as well as on `hasMore: false`, so a listing that never says
 * it is done cannot hold the search open.
 */
async function registryRecords(
  ctx: PageCollectionsContext
): Promise<unknown[]> {
  const records: unknown[] = [];
  for (let page = 1; ; page += 1) {
    const listed = await ctx.services.collections.listCollections(
      { page, limit: REGISTRY_PAGE_SIZE, sortBy: "slug", sortOrder: "asc" },
      // Listing which collections exist is configuration, read as nobody in
      // particular; the ROWS are read as the caller.
      {}
    );
    const { data, pagination } = listed as {
      data?: unknown;
      pagination?: { hasMore?: unknown };
    };
    if (!Array.isArray(data) || data.length === 0) return records;
    records.push(...data);
    if (pagination?.hasMore !== true) return records;
  }
}

/**
 * The composition stores' slugs: RESOLVED, since a host may rename the
 * plugin's collections, plus a component store the host pointed the plugin at.
 */
function compositionStores(
  ctx: PageCollectionsContext,
  store: ComponentStore
): ReadonlySet<string> {
  return new Set(
    [
      ctx.self.collections[PATTERNS_SLUG] ?? PATTERNS_SLUG,
      ctx.self.collections[COMPONENTS_SLUG] ?? COMPONENTS_SLUG,
      store.collection,
    ].filter((slug): slug is string => slug !== undefined)
  );
}

/**
 * The page collection `slug` names, by the reading the search lists pages by
 * (the live registry, the composition stores left out), or `undefined` when it
 * names none. The Pages panel's writes ask this, so a collection the search
 * would never list is one they never write.
 */
export async function findPageCollection(
  ctx: PageCollectionsContext,
  store: ComponentStore,
  slug: string
): Promise<PageCollection | undefined> {
  return pageCollectionIn(
    await registryRecords(ctx),
    compositionStores(ctx, store),
    slug
  );
}

/**
 * The reads the route binds: the registry listing, the composition stores'
 * resolved slugs, and the shared as-caller read.
 */
function directPagesSearchReads(
  ctx: PagesSearchRouteContext,
  store: ComponentStore
): PagesSearchReads {
  return {
    collections: () => registryRecords(ctx),
    stores: () => compositionStores(ctx, store),
    find: args => findAsCaller(ctx, args),
    warn: (message, context) => ctx.logger.warn(message, context),
  };
}

/**
 * The route declaration, thin on purpose: the method, the path, and that it is
 * authenticated. Everything it decides lives in {@link readPagesSearch} and
 * {@link parsePagesSearchQuery}.
 *
 * `store` is where component definitions live, so a store the host pointed the
 * plugin at is left out of the search as the plugin's own is.
 */
export function pagesSearchRoute(
  store: ComponentStore = DEFAULT_COMPONENT_STORE
): {
  method: "GET";
  path: string;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
} {
  return {
    method: "GET",
    path: PAGES_SEARCH_ROUTE_PATH,
    // No `public: true`, which is what makes this authenticated, and no
    // `requiredPermission`: the search spans collections a permission names
    // one at a time. Each read's own access is core's.
    handler: async (req, ctx) => {
      const answer = await readPagesSearch(
        parsePagesSearchQuery(req.url),
        directPagesSearchReads(ctx, store)
      );
      return respondList([...answer.items], answer.meta);
    },
  };
}
