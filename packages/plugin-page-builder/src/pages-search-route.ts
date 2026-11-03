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
 * @module pages-search-route
 */
import {
  NextlyError,
  resolvedCollectionView,
  type PluginRouteContext,
} from "@nextlyhq/plugin-sdk";
import { respondList, type PaginationMeta, type WhereFilter } from "nextly";
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
import { acceptsKind } from "./fields/blocks-options";
import { DEFAULT_COMPONENT_STORE, type ComponentStore } from "./library-route";
import { editorBlocksFields } from "./nested-blocks-fields";
import {
  PAGES_SEARCH_EXCLUDE_SEPARATOR,
  PAGES_SEARCH_LIMIT_DEFAULT,
  PAGES_SEARCH_LIMIT_MAX,
  PAGES_SEARCH_MAX,
  PAGES_SEARCH_PARAMS,
  PAGES_SEARCH_ROUTE_PATH,
  type PageItem,
  type PageReference,
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
  return {
    ...(search === undefined ? {} : { search }),
    limit: query[PAGES_SEARCH_PARAMS.limit] ?? PAGES_SEARCH_LIMIT_DEFAULT,
    ...(exclude === undefined ? {} : { exclude }),
  };
}

/** One collection the search reads, with what each of its items needs. */
interface PageCollection {
  readonly slug: string;
  readonly label: string;
  /**
   * The Page Builder field the editor opens for, by its form path: the first
   * one the editor reaches that accepts page documents.
   */
  readonly field: string;
  /** The field that names its entries, or `undefined` for none. */
  readonly title?: TitleField;
  /** Whether it has the Draft/Published lifecycle, and so a status column. */
  readonly lifecycle: boolean;
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
  const title = titleFieldIn(record);
  return {
    slug,
    label: labelOf(record, slug),
    field: field.path,
    ...(title === undefined ? {} : { title }),
    // Core's projection of a registry record, which reads the lifecycle
    // switch only when it is a real boolean.
    lifecycle: resolvedCollectionView(record).status === true,
  };
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

/** What one collection contributes: its first rows by title, and its match count. */
interface CollectionHits {
  readonly items: readonly PageItem[];
  readonly total: number;
}

const NO_HITS: CollectionHits = { items: [], total: 0 };

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
 * Answer one search: read each page collection as the caller, then merge.
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
  const items = mergeByTitle(
    hits.map(hit => hit.items),
    request.limit
  );
  const total = hits.reduce((sum, hit) => sum + hit.total, 0);
  return { items, meta: mergedMeta(total, items.length, request.limit) };
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
 */
function mergeByTitle(
  lists: readonly (readonly PageItem[])[],
  limit: number
): PageItem[] {
  const cursors = lists.map(() => 0);
  const merged: PageItem[] = [];
  while (merged.length < limit) {
    const next = lowestHead(lists, cursors);
    if (next === undefined) break;
    merged.push(next.item);
    cursors[next.list] = (cursors[next.list] ?? 0) + 1;
  }
  return merged;
}

/** The lowest unconsumed head across `lists`, and which list it heads. */
function lowestHead(
  lists: readonly (readonly PageItem[])[],
  cursors: readonly number[]
): { item: PageItem; list: number } | undefined {
  let lowest: { item: PageItem; list: number } | undefined;
  lists.forEach((list, index) => {
    const head = list[cursors[index] ?? 0];
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
  // One collection that cannot be read — a table out of step with its
  // schema, a hook that throws — must not hide every healthy one, so its
  // failure leaves just it out, and is told to the operator rather than the
  // caller, whose answer names nothing it could not see.
  try {
    return await readCollection(source, request, reads);
  } catch (error) {
    reads.warn("[page-builder] A collection was left out of a pages search.", {
      collection: source.slug,
      code: NextlyError.is(error) ? error.code : undefined,
      error: error instanceof Error ? error.message : String(error),
    });
    return NO_HITS;
  }
}

/** One collection's part of the search, any failure left to the caller. */
async function readCollection(
  source: PageCollection,
  request: PagesSearchRequest,
  reads: PagesSearchReads
): Promise<CollectionHits> {
  const where = whereFor(source, request);
  if (where === NO_MATCH) return NO_HITS;
  const first = await readRows(source, request, reads, where);
  if (first === undefined) return NO_HITS;
  return readOn(source, request.limit, reads, first);
}

/**
 * The openable rows of one collection, read page by page from the first.
 *
 * Pages are read in the same order the first was, so the rows kept are a
 * prefix of the collection's openable rows in the database's order. Reading
 * stops at `limit` openable rows, at the end of the matches, or at
 * {@link PAGES_PER_COLLECTION} pages.
 *
 * The total is the openable rows among those read plus every match not read,
 * whose rows were never judged: an upper bound, exact once the read reached
 * the end (see `PagesSearchResponse`).
 */
async function readOn(
  source: PageCollection,
  limit: number,
  reads: PagesSearchReads,
  first: FirstRead
): Promise<CollectionHits> {
  const items: PageItem[] = [];
  let scanned = 0;
  let page = first.page;
  for (let number = 1; ; number += 1) {
    items.push(...openableItems(page.items, source));
    scanned += page.items.length;
    if (!readsOnPast(page, number, items.length, limit)) break;
    page = await reads.find({ ...first.args, page: number + 1 });
  }
  const unread = Math.max(0, page.meta.total - scanned);
  return { items: items.slice(0, limit), total: items.length + unread };
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

/** The rows of one page that are search results, in the order read. */
function openableItems(
  rows: readonly unknown[],
  source: PageCollection
): PageItem[] {
  return rows.flatMap(row => {
    const item = itemOf(row, source);
    return item === undefined ? [] : [item];
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
 * The read for one collection, unordered. The columns each item needs and no
 * others; `id` is named so a collection with no title field still selects
 * something, since an empty selection selects every field.
 */
function unorderedRead(
  source: PageCollection,
  request: PagesSearchRequest,
  where: WhereFilter | undefined
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
  };
}

/** A collection's first page, with the read that answered it, for the next pages. */
interface FirstRead {
  readonly args: PagesFindArgs;
  readonly page: AsCallerPage;
}

/**
 * Read one collection's first page as the caller, ordered by title and then
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
  where: WhereFilter | undefined
): Promise<FirstRead | undefined> {
  const unordered = unorderedRead(source, request, where);
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

/**
 * One row as a search result, or nothing when it carries no usable id.
 *
 * The id and title by the rule the entries route names an entry by, so an
 * untitled page carries the same neutral label. The status travels only from
 * a lifecycle collection, and only as one of the two values it holds.
 */
function itemOf(row: unknown, source: PageCollection): PageItem | undefined {
  // A page whose Page Builder field this caller may not read is not one it
  // can open, so it is not listed. Core's field-level read decided that, by
  // leaving the field out of the row.
  if (!holdsField(row, source.field)) return undefined;
  const entry = entryOf(row, source.title?.name);
  if (entry === undefined) return undefined;
  const status = source.lifecycle ? statusOf(row) : undefined;
  return {
    id: entry.id,
    collection: source.slug,
    collectionLabel: source.label,
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
 * The merged answer's pagination, in the canonical list meta.
 *
 * One page: the search has no paging of its own, so `page` is 1 and `hasNext`
 * says only that more pages matched than were returned.
 */
function mergedMeta(
  total: number,
  returned: number,
  limit: number
): PaginationMeta {
  return {
    total,
    page: 1,
    limit,
    totalPages: Math.ceil(total / limit),
    hasNext: total > returned,
    hasPrev: false,
  };
}

/** How many registry records one page of the listing asks for. */
const REGISTRY_PAGE_SIZE = 100;

/** The route context this reads: who is asking, its own slugs, and the registry. */
interface PagesSearchRouteContext {
  readonly caller: PluginRouteContext["caller"];
  readonly logger: Pick<PluginRouteContext["logger"], "warn">;
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
  ctx: PagesSearchRouteContext
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
 * The reads the route binds: the registry listing, the composition stores'
 * resolved slugs, and the shared as-caller read.
 */
function directPagesSearchReads(
  ctx: PagesSearchRouteContext,
  store: ComponentStore
): PagesSearchReads {
  return {
    collections: () => registryRecords(ctx),
    // RESOLVED slugs, since a host may rename the plugin's collections, plus a
    // component store the host pointed the plugin at.
    stores: () =>
      new Set(
        [
          ctx.self.collections[PATTERNS_SLUG] ?? PATTERNS_SLUG,
          ctx.self.collections[COMPONENTS_SLUG] ?? COMPONENTS_SLUG,
          store.collection,
        ].filter((slug): slug is string => slug !== undefined)
      ),
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
