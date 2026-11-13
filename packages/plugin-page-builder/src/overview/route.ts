/**
 * The read behind the Page Builder overview: the four libraries the caller
 * may read, each with how many entries they may read and whether they may
 * create one, and the collections and Singles that have a Page Builder field,
 * as far as the caller may read them.
 *
 * ## Why the server answers
 *
 * The libraries are the plugin's collections under the slugs the site
 * registered them as, which a host's rename decides and only the server knows
 * (`ctx.self.collections`); and which collections and Singles have a Page
 * Builder field is read from the live registry, so one the Schema Builder
 * adds later is found too. The browser holds neither.
 *
 * ## Who decides what the caller may see
 *
 * Core, and nothing here. A library is listed when `ctx.caller.can` lets the
 * caller read it, and offers New when it lets them create in it. Each count is
 * core's own count made as the caller (`overrideAccess: false`), with the
 * filters the dashboard's count query sends, so the overview and the panel
 * beside it show one number. A collection with a Page Builder field is listed
 * when the caller may read it; a Single when the caller's own read of it
 * answers.
 *
 * @module overview/route
 */
import type {
  PluginRouteIdentity,
  PluginRoutePermissionScope,
} from "@nextlyhq/plugin-sdk";
import { requireNextly } from "nextly/runtime";

import { labelOf, pluralLabelOf } from "../collection-labels";
import { COMPONENTS_SLUG } from "../collections/components";
import { LAYOUTS_SLUG } from "../collections/layouts";
import { PAGES_SLUG } from "../collections/pages";
import { PATTERNS_SLUG } from "../collections/patterns";
import { TEMPLATES_SLUG } from "../collections/templates";
import { declaredSingleSlugs, isOrphanedSingle } from "../declared-singles";
import { singleReadableByCaller } from "../entry-reads";
import { readingAsUser, type ComponentStore } from "../library-route";
import { builderBlocksFields } from "../nested-blocks-fields";
import {
  registryRecords,
  schemaIsLive,
  slugOf,
  type PageCollectionsContext,
} from "../pages-search-route";

import {
  LIBRARY_KINDS,
  OVERVIEW_ROUTE_PATH,
  type LibraryKind,
  type OverviewLibrary,
  type OverviewUse,
  type PageBuilderOverview,
} from "./contract";

/** Each library's collection, by the slug the plugin declares it under. */
const LIBRARY_SLUGS: Readonly<Record<LibraryKind, string>> = {
  patterns: PATTERNS_SLUG,
  components: COMPONENTS_SLUG,
  layouts: LAYOUTS_SLUG,
  templates: TEMPLATES_SLUG,
};

/** How many Singles one page of the registry listing asks for. */
const SINGLES_PAGE_SIZE = 100;

/** The most pages of Singles one answer reads, so a listing that never ends cannot hold it. */
const SINGLES_PAGES_MAX = 10;

/** How many counts are asked at once. */
const COUNTS_AT_ONCE = 4;

/** What the route reads of its context: the caller, its own slugs and the registries. */
export interface OverviewContext extends PageCollectionsContext {
  readonly caller: {
    can(action: string, resource: string): Promise<boolean>;
    identity(): Promise<PluginRouteIdentity>;
  } | null;
  readonly services: PageCollectionsContext["services"] & {
    readonly singles: {
      list(options: { offset: number; limit: number }): Promise<unknown>;
    };
  };
  readonly config?: { readonly singles?: unknown };
}

/**
 * The reads made as the caller, apart from the decisions above, so a test can
 * answer them without a database.
 */
export interface OverviewReads {
  /** How many entries of `collection` the caller may read; `null` when unknown. */
  count(ctx: OverviewContext, collection: string): Promise<number | null>;
  /** Whether the caller's own read of the Single `slug` answers. */
  singleReadable(ctx: OverviewContext, slug: string): Promise<boolean>;
}

/** Core's count of a collection made as the caller, as the dashboard asks it. */
async function countAsCaller(
  ctx: OverviewContext,
  collection: string
): Promise<number | null> {
  try {
    const { total } = await requireNextly().count({
      collection,
      ...(await readingAsUser(ctx)),
      // Every entry the caller may open, drafts included, as the collection's
      // list shows them: a read defaults to published entries otherwise.
      status: "all",
    });
    return total;
  } catch {
    // A count is a figure beside a name: one that cannot be read is left out
    // rather than failing the page.
    return null;
  }
}

/** The reads as the server makes them. */
const CALLER_READS: OverviewReads = {
  count: countAsCaller,
  singleReadable: (ctx, slug) => singleReadableByCaller(ctx, slug),
};

/** A library's collection under the slug the site registered it as. */
function librarySlug(ctx: OverviewContext, kind: LibraryKind): string {
  const declared = LIBRARY_SLUGS[kind];
  return ctx.self.collections[declared] ?? declared;
}

/** One library as the caller may see it, or nothing when they may not read it. */
async function libraryFor(
  ctx: OverviewContext,
  caller: NonNullable<OverviewContext["caller"]>,
  kind: LibraryKind,
  reads: OverviewReads
): Promise<OverviewLibrary[]> {
  const collection = librarySlug(ctx, kind);
  if (!(await caller.can("read", collection))) return [];
  const [count, mayCreate] = await Promise.all([
    reads.count(ctx, collection),
    caller.can("create", collection),
  ]);
  return [{ kind, collection, count, mayCreate }];
}

/** Whether a registry record says the admin hides it. */
function hiddenIn(record: Record<string, unknown>): boolean {
  const admin = record.admin;
  return (
    typeof admin === "object" &&
    admin !== null &&
    (admin as { hidden?: unknown }).hidden === true
  );
}

/** The label a blocks field declares, or its path where it declares none. */
function fieldLabelOf(field: { path: string; declaration: object }): string {
  const label = (field.declaration as { label?: unknown }).label;
  return typeof label === "string" && label !== "" ? label : field.path;
}

/** A candidate use: a record's slug, its name, and its first Page Builder field. */
type Candidate = Omit<OverviewUse, "entries">;

/**
 * A registry record as a use of the Page Builder, or nothing: a record with a
 * usable slug, a live schema, not hidden, not one of `excluded`, and holding a
 * blocks field the Page Builder opens.
 */
function candidateOf(
  value: unknown,
  kind: OverviewUse["kind"],
  excluded: ReadonlySet<string>
): Candidate[] {
  if (typeof value !== "object" || value === null) return [];
  const record = value as Record<string, unknown>;
  const slug = slugOf(record);
  if (slug === undefined || excluded.has(slug)) return [];
  if (hiddenIn(record) || !schemaIsLive(record)) return [];
  const [field] = builderBlocksFields(record);
  if (field === undefined) return [];
  const label =
    kind === "collection"
      ? (pluralLabelOf(record).pluralLabel ?? labelOf(record, slug))
      : labelOf(record, slug);
  return [{ kind, slug, label, field: fieldLabelOf(field) }];
}

/** Names in the order the admin's own lists sort them. */
function byLabel(a: Candidate, b: Candidate): number {
  return a.label.localeCompare(b.label, "en", { sensitivity: "base" });
}

/**
 * The collections and Singles that have a Page Builder field, collections
 * first, each group by name: derived from the registries' records, never
 * from a list of slugs. The plugin's libraries and a host's component store
 * are what pages are built from, not where the builder is used, so they are
 * left out with `excluded`; so are records the admin hides, and Singles the
 * configuration no longer declares (`declaredSingles`).
 */
export function pageBuilderUses(
  collections: readonly unknown[],
  singles: readonly unknown[],
  excluded: ReadonlySet<string>,
  declaredSingles?: ReadonlySet<string>
): Candidate[] {
  const ofCollections = collections
    .flatMap(record => candidateOf(record, "collection", excluded))
    .sort(byLabel);
  const ofSingles = singles
    .filter(record => !isOrphanedSingle(record, declaredSingles))
    .flatMap(record => candidateOf(record, "single", excluded))
    .sort(byLabel);
  return [...ofCollections, ...ofSingles];
}

/** The Singles registry's rows, page by page, bounded. */
async function singleRecords(ctx: OverviewContext): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (let page = 0; page < SINGLES_PAGES_MAX; page += 1) {
    const listed = (await ctx.services.singles.list({
      offset: page * SINGLES_PAGE_SIZE,
      limit: SINGLES_PAGE_SIZE,
    })) as { data?: unknown; total?: unknown };
    if (!Array.isArray(listed.data) || listed.data.length === 0) break;
    rows.push(...(listed.data as unknown[]));
    if (typeof listed.total !== "number" || rows.length >= listed.total) break;
  }
  return rows;
}

/** One candidate as the caller may see it, with its entries for a collection. */
async function useFor(
  ctx: OverviewContext,
  caller: NonNullable<OverviewContext["caller"]>,
  candidate: Candidate,
  reads: OverviewReads
): Promise<OverviewUse[]> {
  if (candidate.kind === "single") {
    return (await reads.singleReadable(ctx, candidate.slug)) ? [candidate] : [];
  }
  if (!(await caller.can("read", candidate.slug))) return [];
  const entries = await reads.count(ctx, candidate.slug);
  return [entries === null ? candidate : { ...candidate, entries }];
}

/** `work` over `items`, a few at a time, answers flattened in `items` order. */
async function inTurns<T, R>(
  items: readonly T[],
  work: (item: T) => Promise<R[]>
): Promise<R[]> {
  const results: R[] = [];
  for (let at = 0; at < items.length; at += COUNTS_AT_ONCE) {
    const turn = await Promise.all(
      items.slice(at, at + COUNTS_AT_ONCE).map(work)
    );
    results.push(...turn.flat());
  }
  return results;
}

/**
 * Answer the overview for the caller. A `null` caller sees nothing: the
 * route is authenticated, so that branch is not reached, and reading it as
 * anyone would show a stranger the site's libraries.
 */
export async function readOverview(
  ctx: OverviewContext,
  store: Pick<ComponentStore, "collection">,
  reads: OverviewReads = CALLER_READS
): Promise<PageBuilderOverview> {
  const caller = ctx.caller;
  if (caller === null) return { libraries: [], usedIn: [] };
  const libraries = await inTurns(LIBRARY_KINDS, kind =>
    libraryFor(ctx, caller, kind, reads)
  );
  const excluded = new Set([
    ...LIBRARY_KINDS.map(kind => librarySlug(ctx, kind)),
    ...(store.collection === undefined ? [] : [store.collection]),
  ]);
  const [collections, singles] = await Promise.all([
    registryRecords(ctx),
    singleRecords(ctx),
  ]);
  const candidates = pageBuilderUses(
    collections,
    singles,
    excluded,
    declaredSingleSlugs(ctx)
  );
  const usedIn = await inTurns(candidates, candidate =>
    useFor(ctx, caller, candidate, reads)
  );
  return { libraries, usedIn };
}

/**
 * The route declaration: authenticated, for those who edit pages, as the
 * overview page and the "Bindings to fix" route ask. `noStore`, because its
 * answer is one person's.
 */
export function overviewRoute(store: Pick<ComponentStore, "collection">): {
  method: "GET";
  path: string;
  noStore: true;
  requiredPermission: (scope: PluginRoutePermissionScope) => string;
  handler: (req: Request, ctx: OverviewContext) => Promise<Response>;
} {
  return {
    method: "GET",
    path: OVERVIEW_ROUTE_PATH,
    noStore: true,
    requiredPermission: ({ collection }) => collection(PAGES_SLUG, "update"),
    handler: async (_req, ctx) =>
      Response.json(
        (await readOverview(ctx, store)) satisfies PageBuilderOverview
      ),
  };
}
