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

import { blocksFieldsOf } from "./class-usage-blocks-fields";
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
import { DEFAULT_COMPONENT_STORE, type ComponentStore } from "./library-route";
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
    "This parameter is not one the pages search accepts."
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
  /** The Page Builder field the editor opens for: the first one declared. */
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
 * A record counts when it declares a blocks field at an addressable path and
 * is not one of `stores`, the plugin's composition stores. A record whose slug
 * cannot be read is skipped: there is no collection to address. Where a
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
  const [first] = blocksFieldsOf({
    fields: record.fields,
    localized: record.localized,
  });
  if (first === undefined) return undefined;
  const title = titleFieldIn(record);
  return {
    slug,
    label: labelOf(record, slug),
    field: first.name,
    ...(title === undefined ? {} : { title }),
    // Core's projection of a registry record, which reads the lifecycle
    // switch only when it is a real boolean.
    lifecycle: resolvedCollectionView(record).status === true,
  };
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
}

/** What one collection contributes: its first rows by title, and its match count. */
interface CollectionHits {
  readonly items: readonly PageItem[];
  readonly total: number;
}

const NO_HITS: CollectionHits = { items: [], total: 0 };

/**
 * Answer one search: read each page collection as the caller, then merge.
 *
 * Each collection is read once, for at most `limit` rows already sorted by
 * title, so the merged first `limit` by title are among them. The reads run
 * together: how many there are is the site's configuration, and each is
 * bounded by the limit.
 */
export async function readPagesSearch(
  request: PagesSearchRequest,
  reads: PagesSearchReads
): Promise<PagesSearchResponse> {
  const sources = pageCollections(await reads.collections(), reads.stores());
  const hits = await Promise.all(
    sources.map(source => searchCollection(source, request, reads))
  );
  const items = hits
    .flatMap(hit => hit.items)
    .sort(byTitle)
    .slice(0, request.limit);
  const total = hits.reduce((sum, hit) => sum + hit.total, 0);
  return { items, meta: mergedMeta(total, items.length, request.limit) };
}

/**
 * Titles in reading order, ignoring case and accents, with numbers compared
 * as numbers ("Page 2" before "Page 10"); ties by collection, then id, so the
 * order never depends on which read answered first.
 */
const titleOrder = new Intl.Collator(undefined, {
  sensitivity: "base",
  numeric: true,
});

function byTitle(a: PageItem, b: PageItem): number {
  return (
    titleOrder.compare(a.title, b.title) ||
    a.collection.localeCompare(b.collection) ||
    a.id.localeCompare(b.id)
  );
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
  const where = whereFor(source, request);
  if (where === NO_MATCH) return NO_HITS;
  const page = await readRows(source, request, reads, where);
  if (page === undefined) return NO_HITS;
  return {
    items: page.items.flatMap(row => {
      const item = itemOf(row, source);
      return item === undefined ? [] : [item];
    }),
    total: page.meta.total,
  };
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
    },
    limit: request.limit,
  };
}

/**
 * Read one collection's rows as the caller, ordered by title so the rows a
 * limit keeps are the first by title; `undefined` when core leaves this caller
 * nothing of it.
 *
 * Core refusing the collection leaves its pages out, and the rest of the
 * search still answers: the refusal is core's, applied. A caller who may read
 * the pages but not their title field is refused a filter or an order on it:
 * a search on the title then matches nothing for them, and a plain listing is
 * read again unordered, each page labelled untitled as its row carries none.
 */
async function readRows(
  source: PageCollection,
  request: PagesSearchRequest,
  reads: PagesSearchReads,
  where: WhereFilter | undefined
): Promise<AsCallerPage | undefined> {
  const unordered = unorderedRead(source, request, where);
  const titleName = source.title?.name;
  try {
    return await reads.find(
      titleName === undefined ? unordered : { ...unordered, sort: titleName }
    );
  } catch (error) {
    if (NextlyError.isForbidden(error)) return undefined;
    if (titleName === undefined || !refusesField(error, titleName)) throw error;
    if (request.search !== undefined) return undefined;
    return reads.find(unordered);
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
