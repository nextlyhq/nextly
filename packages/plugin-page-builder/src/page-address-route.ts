/**
 * The page address route: the path one page is served at, read as the
 * caller from the page as it is saved, its working draft included.
 *
 * Part of the pages search. `pages-search-route.ts` is the entry, and its
 * header explains what the search reads, who decides access, and paging.
 *
 * @module page-address-route
 */
import type { PluginRouteContext } from "@nextlyhq/plugin-sdk";
import { z } from "nextly/zod";

import { readSavedAsCaller } from "./entry-reads";
import { DEFAULT_COMPONENT_STORE, type ComponentStore } from "./library-route";
import {
  recordNamed,
  templateFields,
  pageCollectionIn,
} from "./pages-search-collections";
import {
  PAGE_ADDRESS_PARAMS,
  PAGE_ADDRESS_ROUTE_PATH,
  PAGES_SEARCH_LOCALE_MAX,
  type PageAddressResponse,
  type PageReference,
} from "./pages-search-contract";
import { directPagesSearchReads } from "./pages-search-handler";
import { pathOf } from "./pages-search-items";
import type { PagesSearchReads } from "./pages-search-read";
import { EXCLUDE_PART_MAX } from "./pages-search-request";
import { optionalText, parseRouteQuery } from "./route-query";

/**
 * The search's reads, and one more the address needs: a page read as it is
 * SAVED, its working draft included, since a Save that does not publish
 * stores one.
 */
export interface PageAddressReads extends PagesSearchReads {
  readSaved(args: {
    readonly collection: string;
    readonly id: string;
    readonly select: Record<string, boolean>;
    readonly locale?: string;
  }): Promise<Record<string, unknown> | null>;
}

/** One page's address, as the route will read it once its query is checked. */
export interface PageAddressRequest {
  readonly page: PageReference;
  /** The language the page's fields are read in, when the request names one. */
  readonly locale?: string;
}

/** The address query, as zod reads it: a collection and an id, each bounded. */
const addressQuerySchema = z.object({
  [PAGE_ADDRESS_PARAMS.collection]: z.string().min(1).max(EXCLUDE_PART_MAX),
  [PAGE_ADDRESS_PARAMS.id]: z.string().min(1).max(EXCLUDE_PART_MAX),
  [PAGE_ADDRESS_PARAMS.locale]: optionalText(PAGES_SEARCH_LOCALE_MAX),
});

/** Read the address route's query, or refuse it, naming the parameter. */
export function parsePageAddressQuery(url: string | URL): PageAddressRequest {
  const query = parseRouteQuery(
    url,
    Object.values(PAGE_ADDRESS_PARAMS),
    addressQuerySchema,
    "page address"
  );
  const locale = query[PAGE_ADDRESS_PARAMS.locale];
  return {
    page: {
      collection: query[PAGE_ADDRESS_PARAMS.collection],
      id: query[PAGE_ADDRESS_PARAMS.id],
    },
    ...(locale === undefined ? {} : { locale }),
  };
}

/**
 * Where one page is served, as it is saved: the pages search's own resolution
 * (the host's `pagePreviewPath`, the fields it names read as the caller, and
 * {@link pathOf}), asked of a single row, so Settings and the search can never
 * name a page's address two ways.
 *
 * Read as the caller, so a page they may not read has no address here, as it
 * has no row in the search. Only the plugin's own Pages have one: another
 * collection's address is the host's own code.
 */
export async function readPageAddress(
  request: PageAddressRequest,
  reads: PageAddressReads
): Promise<PageAddressResponse> {
  const primary = reads.pagesCollection();
  const template = reads.pagePath?.();
  if (template === undefined || request.page.collection !== primary) {
    return { path: null };
  }
  const records = await reads.collections();
  const source = pageCollectionIn(records, reads.stores(), primary);
  if (source === undefined) return { path: null };
  const pathFields = templateFields(template, recordNamed(records, primary));
  const row = await reads.readSaved({
    collection: primary,
    id: request.page.id,
    select: {
      id: true,
      ...Object.fromEntries(pathFields.map(name => [name, true] as const)),
    },
    ...(request.locale === undefined ? {} : { locale: request.locale }),
  });
  if (row === null) return { path: null };
  return {
    path: pathOf(row, { ...source, pathTemplate: template }).path ?? null,
  };
}

/**
 * The address route's declaration: authenticated, like the search, with each
 * read's access core's.
 */
export function pageAddressRoute(
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
    path: PAGE_ADDRESS_ROUTE_PATH,
    checksAccess: true, // The handler judges each caller.
    handler: async (req, ctx) =>
      Response.json(
        await readPageAddress(parsePageAddressQuery(req.url), {
          ...directPagesSearchReads(ctx, store, pagePath),
          readSaved: args => readSavedAsCaller(ctx, args),
        })
      ),
  };
}
