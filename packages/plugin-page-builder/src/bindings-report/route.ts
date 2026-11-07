/**
 * `GET /bindings-to-fix`: the documents whose bindings no longer fit what
 * they read, for the people who edit pages.
 *
 * Read from the stored report (`bindings-report/store`), never computed per
 * request, so its count is cheap wherever the admin shows it. Each document is
 * listed only when the caller may read it, named as they know it, by one read
 * as the caller per collection (the dry run's own naming). A request also
 * starts the check of every document when the schema changed since the last
 * complete one, and is answered at once with what is stored and that a check
 * is under way.
 *
 * `?document=<key>` narrows the answer to one document, for the editor;
 * `?place=<place>` to one place (pages, components, patterns, layouts,
 * entries, singles).
 *
 * @module bindings-report/route
 */
import {
  NextlyError,
  type PluginRouteContext,
  type PluginRoutePermissionScope,
} from "@nextlyhq/plugin-sdk";
import { respondList } from "nextly";

import { PAGES_SLUG } from "../collections/pages";
import type { HostAddress } from "../host-rewrite/contract";

import type { BindingReportRow } from "./rows";
import { MAX_REPORTED_DOCUMENTS, type BindingReportStore } from "./store";

/** Where the route is mounted under the plugin. */
const BINDINGS_TO_FIX_ROUTE_PATH = "/bindings-to-fix";

/** One document in the answer. */
interface BindingsToFixItem {
  readonly documentKey: string;
  readonly kind: "collection" | "single";
  readonly slug: string;
  readonly documentId?: string;
  readonly place: string;
  /** The document as the caller knows it: an entry's title, a Single's slug. */
  readonly title: string;
  readonly rows: readonly BindingReportRow[];
  readonly checkedAt: string;
}

/** What the answer's `meta` says besides the page. */
interface BindingsToFixMeta {
  /** How many broken bindings each place holds, of the documents listed. */
  readonly byPlace: Readonly<Record<string, number>>;
  /** How many broken bindings the listed documents hold in all. */
  readonly bindings: number;
  /** When every document was last checked completely, if ever. */
  readonly checkedAt: string | null;
  /** Whether a check of every document is under way. */
  readonly checking: boolean;
}

/** What the route needs of the installed plugin. */
export interface BindingsToFixDeps {
  readonly store: () => BindingReportStore | null;
  /** What the caller knows each document by, for the ones they may read. */
  readonly names: (
    ctx: PluginRouteContext,
    hosts: readonly HostAddress[]
  ) => Promise<ReadonlyMap<string, string>>;
  /**
   * Start the check of every document if the schema changed, through the
   * caller's request; never waits for it.
   */
  readonly refresh: (ctx: PluginRouteContext) => void;
}

/** The query, read as given; anything else is ignored. */
function filtersOf(req: Request): { document?: string; place?: string } {
  const params = new URL(req.url).searchParams;
  const document = params.get("document");
  const place = params.get("place");
  return {
    ...(document === null || document === "" ? {} : { document }),
    ...(place === null || place === "" ? {} : { place }),
  };
}

/** Answer one read of the report, as the caller may see it. */
async function readBindingsToFix(
  req: Request,
  ctx: PluginRouteContext,
  deps: BindingsToFixDeps
): Promise<Response> {
  const store = deps.store();
  if (store === null) {
    throw NextlyError.internal({
      logContext: { reason: "bindings-report-not-installed" },
    });
  }
  deps.refresh(ctx);
  const filters = filtersOf(req);
  const [stored, check] = await Promise.all([store.list(), store.fullCheck()]);
  const wanted = stored.filter(
    entry =>
      filters.document === undefined || entry.documentKey === filters.document
  );
  const names = await deps.names(
    ctx,
    wanted.map(entry => ({
      kind: entry.kind,
      slug: entry.slug,
      ...(entry.documentId === undefined ? {} : { id: entry.documentId }),
      path: [],
    }))
  );
  // Only documents the caller may read; the place filter after the counts,
  // so each tab's count stays whatever tab is open.
  const readable: BindingsToFixItem[] = wanted.flatMap(entry => {
    const title = names.get(entry.documentKey);
    return title === undefined
      ? []
      : [
          {
            documentKey: entry.documentKey,
            kind: entry.kind,
            slug: entry.slug,
            ...(entry.documentId === undefined
              ? {}
              : { documentId: entry.documentId }),
            place: entry.place,
            title,
            rows: entry.rows,
            checkedAt: entry.checkedAt.toISOString(),
          },
        ];
  });
  const byPlace: Record<string, number> = {};
  for (const item of readable) {
    byPlace[item.place] = (byPlace[item.place] ?? 0) + item.rows.length;
  }
  const items = readable.filter(
    item => filters.place === undefined || item.place === filters.place
  );
  const meta: Parameters<typeof respondList>[1] & BindingsToFixMeta = {
    total: items.length,
    page: 1,
    limit: MAX_REPORTED_DOCUMENTS,
    totalPages: 1,
    // The store keeps at most the cap; more would be read on a next page.
    hasNext: stored.length >= MAX_REPORTED_DOCUMENTS,
    hasPrev: false,
    byPlace,
    bindings: readable.reduce((sum, item) => sum + item.rows.length, 0),
    checkedAt:
      check.checked !== null && check.at !== null
        ? check.at.toISOString()
        : null,
    checking: check.checking !== null,
  };
  return respondList(items, meta);
}

/**
 * The route. For the people who edit pages: the report names pages, and what
 * they bind, which is theirs to fix. `noStore` because the answer is one
 * person's.
 */
export function bindingsToFixRoute(deps: BindingsToFixDeps): {
  method: "GET";
  path: string;
  noStore: true;
  requiredPermission: (scope: PluginRoutePermissionScope) => string;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
} {
  return {
    method: "GET",
    path: BINDINGS_TO_FIX_ROUTE_PATH,
    noStore: true,
    requiredPermission: ({ collection }) => collection(PAGES_SLUG, "update"),
    handler: (req, ctx) => readBindingsToFix(req, ctx, deps),
  };
}
