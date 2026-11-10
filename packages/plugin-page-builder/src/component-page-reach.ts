/**
 * How many PAGES a change to a component reaches: the number the banner over
 * the component's own view says.
 *
 * A component reaches a page three ways, and the count is of the distinct
 * pages (and Singles) across all three:
 *
 * - placed on it directly, which the component usage index records;
 * - placed inside another component that reaches it, followed up through the
 *   same index, since a component's own document is indexed like any other;
 * - named by a Layout that wraps it, the site's default Layout included,
 *   which no index records: Layouts name their components in a relationship,
 *   not in a blocks tree, so they are read live, as the delete guard reads
 *   them.
 *
 * The direct count beside it (documents placing the component, which the
 * removal dialog says) is not derived from this, nor this from it: they
 * answer different questions, one about where placement values are stored,
 * one about what a visitor sees change.
 *
 * ## Why the answer may be a floor
 *
 * Every read here is bounded: the index read stops at its cap and reports it,
 * the walk up through components stops at a number of components, and the
 * Layout and page reads stop at a number of rows. Any bound reached, or an
 * index that is not whole, makes the count a floor, which the editor says as
 * "at least". The count is never larger than the truth. The walk also stops
 * at the renderer's composition depth, which is not a bound but the rule: a
 * page holding the component deeper than that is not drawn with it.
 *
 * ## NOT a security boundary
 *
 * Read as the system and answered as a number only: pages the author may not
 * read are counted without being named, as the spec asks.
 *
 * @module component-page-reach
 */
import { MAX_COMPOSED_DEPTH, resolvePageLayout } from "@nextlyhq/blocks-engine";

import {
  readLayoutSettings,
  relationId,
  type DefaultLayoutDirectApi,
  type DefaultLayoutSlugs,
} from "./default-layout/store";
import { componentsNamedBy } from "./layout-component-usage";
import type { DocumentsUsing, UsageCount } from "./usage-count";

/**
 * The most components the walk up through placements will visit before
 * calling the count a floor. A runaway guard, not a sizing claim: a component
 * nested in this many others is a site worth an index of its own.
 */
const MAX_REACH_COMPONENTS = 500;

/** One stored page's Layout choice, as the rule reads it. */
export interface PageLayoutRow {
  readonly id: string;
  /** The Layout it names, by id, or `null` for the site default. */
  readonly layout: string | null;
  readonly noHeaderFooter: boolean | null;
}

/** What answering needs, injected so a test can supply each part. */
export interface PageReachSources {
  /**
   * The documents placing each of these components, by collection, from the
   * usage index; each listing says whether it is the whole answer.
   */
  readonly documentsUsingEach: (
    componentIds: readonly string[]
  ) => Promise<ReadonlyMap<string, DocumentsUsing>>;
  /** The collection component definitions live in: a document there is a component. */
  readonly componentsCollection: string;
  /**
   * Collections whose documents are not pages and reach none: patterns, which
   * are copied rather than placed, and Layouts.
   */
  readonly notPages: ReadonlySet<string>;
  /**
   * Every PUBLISHED Layout, with the components its areas name, and whether
   * every one was read. Only a published Layout wraps a page.
   */
  readonly publishedLayouts: () => Promise<{
    readonly layouts: readonly {
      readonly id: string;
      readonly components: readonly string[];
    }[];
    readonly complete: boolean;
  }>;
  /** The Layout the site's default names, or `null` where none is set. */
  readonly defaultLayout: () => Promise<string | null>;
  /** The collection the plugin's pages, the ones a Layout wraps, live in. */
  readonly pagesCollection: string;
  /**
   * The stored pages whose Layout choice could put them inside one of
   * `layoutIds`, with that choice; `includeDefault` asks for the pages that
   * fall back to the default as well. Bounded, and says when it stopped.
   */
  readonly pagesChoosing: (
    layoutIds: readonly string[],
    includeDefault: boolean
  ) => Promise<{
    readonly pages: readonly PageLayoutRow[];
    readonly complete: boolean;
  }>;
}

/** The pages reached so far, as distinct documents, and whether that is all. */
interface Reached {
  /** `collection` NUL `id`, so one id in two collections is two pages. */
  readonly pages: Set<string>;
  /** Index rows naming no document: counted, since each is a reference. */
  anonymous: number;
  complete: boolean;
}

/**
 * How many distinct pages a change to `componentId` reaches, directly,
 * through other components and through Layouts, and whether that is all.
 */
export async function componentPageReach(
  componentId: string,
  sources: PageReachSources
): Promise<UsageCount> {
  const reached: Reached = { pages: new Set(), anonymous: 0, complete: true };
  const components = await walkPlacements(componentId, sources, reached);
  await addLayoutPages(components, sources, reached);
  return {
    documents: reached.pages.size + reached.anonymous,
    complete: reached.complete,
  };
}

/**
 * Up through the index, a level at a time: the pages placing any component
 * on the frontier, and the components placing one, which form the next
 * frontier. Answers every component visited, the first included, for the
 * Layout step: a Layout naming any of them reaches its pages too.
 */
async function walkPlacements(
  componentId: string,
  sources: PageReachSources,
  reached: Reached
): Promise<ReadonlySet<string>> {
  const seen = new Set<string>([componentId]);
  let frontier: string[] = [componentId];
  // One level per composed depth, by the renderer's own rule: the frontier at
  // `depth` holds the edited component `depth` deep, and a page or a Layout
  // draws it there only while `depth` is below the cap the renderer refuses
  // at (`scope.depth >= maxComposedDepth`, defaulting to this constant).
  // Past it the page is not reached at all, so the count stays exact, and the
  // components found at the cap are dropped before the Layout step asks
  // which Layouts name them.
  for (let depth = 0; frontier.length > 0; depth += 1) {
    if (depth >= MAX_COMPOSED_DEPTH) {
      for (const tooDeep of frontier) seen.delete(tooDeep);
      break;
    }
    const listings = await sources.documentsUsingEach(frontier);
    frontier = nextLevel(frontier, listings, sources, reached, seen);
  }
  return seen;
}

/**
 * One level of the walk: the pages placing the frontier are counted, and the
 * components placing it not seen yet are answered, up to the bound.
 */
function nextLevel(
  frontier: readonly string[],
  listings: ReadonlyMap<string, DocumentsUsing>,
  sources: PageReachSources,
  reached: Reached,
  seen: Set<string>
): string[] {
  const next: string[] = [];
  const placers = frontier.flatMap(id => {
    const listing = listings.get(id);
    if (listing === undefined) return [];
    if (!listing.complete) reached.complete = false;
    return listing.collections.flatMap(entry =>
      foldListing(entry, sources, reached)
    );
  });
  for (const placer of placers) {
    if (seen.has(placer)) continue;
    if (seen.size >= MAX_REACH_COMPONENTS) {
      reached.complete = false;
      continue;
    }
    seen.add(placer);
    next.push(placer);
  }
  return next;
}

/**
 * One collection's documents placing a component: pages are added to the
 * count, and the components among them are answered to be walked.
 */
function foldListing(
  entry: DocumentsUsing["collections"][number],
  sources: PageReachSources,
  reached: Reached
): readonly string[] {
  // A Single is a page whatever its slug: only collections hold components,
  // patterns and Layouts.
  if (entry.single === true) {
    reached.pages.add(pageKey(`single:${entry.collection}`, ""));
    return [];
  }
  if (entry.collection === sources.componentsCollection) {
    return entry.documents.filter((id): id is string => id !== null);
  }
  if (sources.notPages.has(entry.collection)) return [];
  for (const document of entry.documents) {
    if (document === null) reached.anonymous += 1;
    else reached.pages.add(pageKey(entry.collection, document));
  }
  return [];
}

/**
 * The pages wrapped by a published Layout naming any of `components`, by the
 * engine's own rule for which Layout a page is drawn inside.
 */
async function addLayoutPages(
  components: ReadonlySet<string>,
  sources: PageReachSources,
  reached: Reached
): Promise<void> {
  const published = await sources.publishedLayouts();
  if (!published.complete) reached.complete = false;
  const naming = published.layouts
    .filter(layout => layout.components.some(id => components.has(id)))
    .map(layout => layout.id);
  if (naming.length === 0) return;

  const defaultLayout = await sources.defaultLayout();
  const publishedIds = new Set(published.layouts.map(layout => layout.id));
  // A page falls back to the default when it names none, or names a Layout
  // that is not published now; both are asked for only when the default is
  // one of the Layouts reaching the component.
  const includeDefault =
    defaultLayout !== null && naming.includes(defaultLayout);
  const read = await sources.pagesChoosing(naming, includeDefault);
  if (!read.complete) reached.complete = false;
  const wrapping = new Set(naming);
  for (const page of read.pages) {
    const resolved = resolvePageLayout(
      { layout: page.layout, noHeaderFooter: page.noHeaderFooter },
      { defaultLayout, isPublished: id => publishedIds.has(id) }
    );
    if (resolved.kind === "layout" && wrapping.has(resolved.id)) {
      reached.pages.add(pageKey(sources.pagesCollection, page.id));
    }
  }
}

function pageKey(collection: string, id: string): string {
  return `${collection}\u0000${id}`;
}

/**
 * How many rows one page of a Layout or page read takes: the Direct API's
 * clamp, so each page is the whole page.
 */
const ROWS_PER_READ = 500;

/**
 * How many pages of rows a Layout or page read takes before calling its
 * answer a floor. Bounded, so a very large site costs a fixed number of
 * reads, and says so.
 */
const MOST_READS = 10;

/** What the site-backed sources read through and where. */
export interface SitePageReachArgs {
  readonly nextly: Pick<DefaultLayoutDirectApi, "find" | "findSingle">;
  /** The RESOLVED slugs of the Layouts collection and the settings Single. */
  readonly slugs: DefaultLayoutSlugs;
  /** The pages collection's RESOLVED slug. */
  readonly pagesCollection: string;
  readonly componentsCollection: string;
  readonly notPages: ReadonlySet<string>;
  readonly documentsUsingEach: PageReachSources["documentsUsingEach"];
}

/**
 * The sources, backed by the Direct API as the system: the published Layouts
 * a page can be drawn inside, the default the settings Single names, and the
 * pages' own Layout choices, each read a page at a time under a bound.
 */
export function sitePageReachSources(
  args: SitePageReachArgs
): PageReachSources {
  const { nextly, slugs } = args;
  return {
    documentsUsingEach: args.documentsUsingEach,
    componentsCollection: args.componentsCollection,
    notPages: args.notPages,
    pagesCollection: args.pagesCollection,
    publishedLayouts: async () => {
      const read = await pagedRows(page =>
        nextly.find({
          collection: slugs.layouts,
          // The form a visitor gets: a published Layout's pending edit wraps
          // no page until it is published.
          status: "published",
          // A deterministic order, so paging neither skips nor repeats a row.
          sort: "id",
          depth: 0,
          select: { id: true, areas: true },
          limit: ROWS_PER_READ,
          page,
          overrideAccess: true,
        })
      );
      const layouts = read.rows.flatMap(row => {
        const id = relationId(row);
        return id === null ? [] : [{ id, components: componentsNamedBy(row) }];
      });
      return { layouts, complete: read.complete };
    },
    defaultLayout: async () =>
      (await readLayoutSettings(nextly, slugs)).defaultLayout,
    pagesChoosing: async (layoutIds, includeDefault) => {
      const read = await pagedRows(page =>
        nextly.find({
          collection: args.pagesCollection,
          // A page that falls back to the default may name no Layout or one
          // that is not published, so only without the default can the
          // database narrow the read to the Layouts asked about.
          ...(includeDefault
            ? {}
            : { where: { layout: { in: [...layoutIds] } } }),
          // Every stored page, drafts too: a change reaches a page that is
          // published later, as the direct count counts it.
          status: "all",
          sort: "id",
          depth: 0,
          select: { id: true, layout: true, noHeaderFooter: true },
          limit: ROWS_PER_READ,
          page,
          overrideAccess: true,
        })
      );
      const pages = read.rows.flatMap((row): PageLayoutRow[] => {
        const id = relationId(row);
        if (id === null) return [];
        const stored = row as { layout?: unknown; noHeaderFooter?: unknown };
        return [
          {
            id,
            layout: relationId(stored.layout),
            noHeaderFooter:
              typeof stored.noHeaderFooter === "boolean"
                ? stored.noHeaderFooter
                : null,
          },
        ];
      });
      return { pages, complete: read.complete };
    },
  };
}

/** Rows read a page at a time, up to {@link MOST_READS} pages. */
async function pagedRows(
  read: (
    page: number
  ) => Promise<{ items?: unknown[]; meta?: { hasNext?: boolean } }>
): Promise<{ rows: unknown[]; complete: boolean }> {
  const rows: unknown[] = [];
  for (let page = 1; page <= MOST_READS; page += 1) {
    const answered = await read(page);
    rows.push(...(answered.items ?? []));
    if (answered.meta?.hasNext !== true) return { rows, complete: true };
  }
  return { rows, complete: false };
}
