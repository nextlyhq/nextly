/**
 * The pages search route, and the live-registry reads it shares with the
 * page address route: the registry's records, the composition stores, one
 * page collection by slug, and the Direct API reads made as the caller.
 *
 * Part of the pages search. `pages-search-route.ts` is the entry, and its
 * header explains what the search reads, who decides access, and paging.
 *
 * @module pages-search-handler
 */
import type { PluginRouteContext } from "@nextlyhq/plugin-sdk";
import { respondList } from "nextly";

import { COMPONENTS_SLUG } from "./collections/components";
import { PAGES_SLUG } from "./collections/pages";
import { PATTERNS_SLUG } from "./collections/patterns";
import { findAsCaller } from "./entry-reads";
import { DEFAULT_COMPONENT_STORE, type ComponentStore } from "./library-route";
import {
  type PageCollection,
  pageCollectionIn,
} from "./pages-search-collections";
import { PAGES_SEARCH_ROUTE_PATH } from "./pages-search-contract";
import { type PagesSearchReads, readPagesSearch } from "./pages-search-read";
import { parsePagesSearchQuery } from "./pages-search-request";

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
export async function registryRecords(
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
export function directPagesSearchReads(
  ctx: PagesSearchRouteContext,
  store: ComponentStore,
  pagePath: string | undefined
): PagesSearchReads {
  return {
    collections: () => registryRecords(ctx),
    stores: () => compositionStores(ctx, store),
    pagesCollection: () => ctx.self.collections[PAGES_SLUG] ?? PAGES_SLUG,
    pagePath: () => pagePath,
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
  store: ComponentStore = DEFAULT_COMPONENT_STORE,
  /** Where the plugin's own pages are served (`pagePreviewPath`), if stated. */
  pagePath?: string
): {
  method: "GET";
  checksAccess: true;
  path: string;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
} {
  return {
    method: "GET",
    path: PAGES_SEARCH_ROUTE_PATH,
    checksAccess: true, // The handler judges each caller.
    // No `public: true`, which is what makes this authenticated, and no
    // `requiredPermission`: the search spans collections a permission names
    // one at a time. Each read's own access is core's.
    handler: async (req, ctx) => {
      const answer = await readPagesSearch(
        parsePagesSearchQuery(req.url),
        directPagesSearchReads(ctx, store, pagePath)
      );
      return respondList([...answer.items], answer.meta);
    },
  };
}
