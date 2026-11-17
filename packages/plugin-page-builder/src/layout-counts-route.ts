/**
 * How many pages use each header & footer set, for the numbers the Pages
 * panel and a set's own view show beside it.
 *
 * Which sets are answered is read AS THE CALLER: a set they may not read is
 * absent, since its id is not theirs to learn. The pages are counted AS THE
 * SYSTEM, so a page the caller may not read still counts, as a number only:
 * the answer carries a count and a floor flag per set, never a page's id,
 * title or slug. An author changing a set used site-wide is told its true
 * reach, as the component "changes show on N pages" bar is.
 *
 * The rule is `countSetPages`; the page reader and its bound are the ones
 * component reach uses (`component-page-reach.ts`).
 *
 * ## NOT a security boundary
 *
 * The route is gated by `read` on the sets' collection; what it answers
 * beyond the caller's own read is a number.
 *
 * @module layout-counts-route
 */
import type {
  PluginRouteContext,
  PluginRoutePermissionScope,
} from "@nextlyhq/plugin-sdk";

import { LAYOUTS_SLUG } from "./collections/layouts";
import { PAGES_SLUG } from "./collections/pages";
import {
  boundedRows,
  readPageLayoutRows,
  type ReadBound,
} from "./component-page-reach";
import { PAGE_BUILDER_SETTINGS_SLUG } from "./default-layout/settings-single";
import {
  readLayoutSettings,
  relationId,
  type DefaultLayoutDirectApi,
} from "./default-layout/store";
import {
  LAYOUT_COUNTS_ROUTE_PATH,
  type LayoutPageCountsResponse,
} from "./layout-counts-contract";
import { countSetPages } from "./layout-page-counts";
import { readingAsUser } from "./library-route";

/** The Direct API surface the read uses, picked from the real type. */
export type LayoutCountsDirectApi = Pick<
  DefaultLayoutDirectApi,
  "find" | "findSingle"
>;

/** The route context the read uses. */
export type LayoutCountsContext = Pick<PluginRouteContext, "caller" | "self">;

/** The bounds of the reads, each the site's own unless a test lowers it. */
export interface LayoutCountsBounds {
  /** The stored pages' choices. */
  readonly pages?: ReadBound;
  /** The caller's list of the sets. */
  readonly sets?: ReadBound;
  /** The published sets. */
  readonly published?: ReadBound;
}

/** A list read's ids, as the rows answer them. */
function idsOf(rows: readonly unknown[]): string[] {
  return rows.flatMap(row => {
    const id = relationId(row);
    return id === null ? [] : [id];
  });
}

/**
 * Read the counts for the caller: the sets they may read, then, only if there
 * is one, the default, the published sets (only where a default can be fallen
 * back to) and every stored page's choice. A fixed number of bounded reads,
 * whatever the number of pages.
 */
export async function readLayoutPageCounts(
  ctx: LayoutCountsContext,
  nextly: LayoutCountsDirectApi,
  bounds: LayoutCountsBounds = {}
): Promise<LayoutPageCountsResponse> {
  const layouts = ctx.self.collections[LAYOUTS_SLUG] ?? LAYOUTS_SLUG;
  const settings =
    ctx.self.singles[PAGE_BUILDER_SETTINGS_SLUG] ?? PAGE_BUILDER_SETTINGS_SLUG;
  const asUser = await readingAsUser(ctx);

  const listed = await boundedRows(
    (page, limit) =>
      nextly.find({
        collection: layouts,
        ...asUser,
        // Every lifecycle state the caller may read: an unpublished set is
        // one the panel lists, with its pages.
        status: "all",
        sort: "id",
        depth: 0,
        select: { id: true },
        limit,
        page,
      }),
    bounds.sets
  );
  const sets = idsOf(listed.rows);
  if (sets.length === 0) return {};

  const { defaultLayout } = await readLayoutSettings(nextly, {
    layouts,
    settings,
  });
  const published =
    defaultLayout === null
      ? // Nothing falls back where there is no default, so whether a named
        // set is published decides nothing.
        { ids: new Set<string>(), complete: true }
      : await publishedSets(nextly, layouts, bounds.published);
  const pages = await readPageLayoutRows(
    nextly,
    ctx.self.collections[PAGES_SLUG] ?? PAGES_SLUG,
    { naming: null, bound: bounds.pages }
  );
  return countSetPages(sets, pages, { defaultLayout, published });
}

/**
 * The ids of the sets whose main row is published now, as the system: a page
 * falls back from any set that is not, the caller's or not.
 */
async function publishedSets(
  nextly: LayoutCountsDirectApi,
  layouts: string,
  bound: ReadBound | undefined
): Promise<{ ids: ReadonlySet<string>; complete: boolean }> {
  const read = await boundedRows(
    (page, limit) =>
      nextly.find({
        collection: layouts,
        status: "published",
        sort: "id",
        depth: 0,
        select: { id: true },
        limit,
        page,
        overrideAccess: true,
      }),
    bound
  );
  return { ids: new Set(idsOf(read.rows)), complete: read.complete };
}

/**
 * The route declaration: `read` on the sets' collection, as resolved, so a
 * host that renamed it still has a route its authors can call.
 */
export function layoutCountsRoute(): {
  method: "GET";
  path: string;
  requiredPermission: (scope: PluginRoutePermissionScope) => string;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
} {
  return {
    method: "GET",
    path: LAYOUT_COUNTS_ROUTE_PATH,
    requiredPermission: ({ collection }) => collection(LAYOUTS_SLUG, "read"),
    handler: async (_req, ctx) => {
      // The Direct API through the plugin SDK, resolved per request, as the
      // set choices route resolves it.
      const { getCachedNextly } = await import("@nextlyhq/plugin-sdk");
      return Response.json(
        await readLayoutPageCounts(ctx, await getCachedNextly())
      );
    },
  };
}
