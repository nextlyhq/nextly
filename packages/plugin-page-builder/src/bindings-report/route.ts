/**
 * `GET /bindings-to-fix`: the documents whose bindings no longer fit what
 * they read, for the people who edit pages.
 *
 * Read from the stored report (`bindings-report/store`), never computed per
 * request, so its count is cheap wherever the admin shows it. A document is
 * listed only when the caller may read it, and only the rows of the blocks
 * fields they may read (`bindings-report/readable`), named as they know it.
 * A request also starts the check of every document when the schema changed
 * since the last complete one, and is answered at once with what is stored
 * and that a check is under way.
 *
 * `?document=<key>` narrows the answer to one document, for the editor;
 * `?place=<place>` to one place (pages, components, patterns, layouts,
 * entries, singles); `?page=<n>` pages it, a hundred documents a page.
 *
 * @module bindings-report/route
 */
import { getBlock } from "@nextlyhq/blocks-engine";
import {
  NextlyError,
  respondList,
  type PluginRouteContext,
  type PluginRoutePermissionScope,
} from "@nextlyhq/plugin-sdk";
import { z } from "nextly/zod";

import { PAGES_SLUG } from "../collections/pages";
import { optionalText, parseRouteQuery } from "../route-query";

import {
  BINDINGS_TO_FIX_PAGE_SIZE,
  BINDINGS_TO_FIX_ROUTE_PATH,
  type BindingsToFixItem,
  type BindingsToFixMeta,
  type BindingsToFixRow,
} from "./contract";
import { topFieldOf, type ReadableDocument } from "./readable";
import type { BindingReportRow } from "./rows";
import type { BindingReportStore, StoredDocumentReport } from "./store";

/** What the route needs of the installed plugin. */
export interface BindingsToFixDeps {
  readonly store: () => BindingReportStore | null;
  /** What the caller may read of each reported document. */
  readonly readable: (
    ctx: PluginRouteContext,
    entries: readonly StoredDocumentReport[]
  ) => Promise<ReadonlyMap<string, ReadableDocument>>;
  /**
   * Start the check of every document if the schema changed, through the
   * caller's request; never waits for it.
   */
  readonly refresh: (ctx: PluginRouteContext) => void;
}

/** A capital first letter, for a name read off a key. */
function named(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/**
 * A row with the names the editor gives its block and prop, read from the
 * running registry when the answer is made, so a renamed label shows at once
 * and none is stored. A block no longer registered is named by its type.
 */
function withLabels(row: BindingReportRow): BindingsToFixRow {
  if (row.blockType === "") {
    // The document's own metadata: `seo.title` is the page's Title.
    return { ...row, blockLabel: "", propLabel: named(row.prop.slice(4)) };
  }
  const definition = getBlock(row.blockType) as
    | {
        readonly editor?: { readonly label?: unknown };
        readonly props?: Readonly<Record<string, { readonly label?: unknown }>>;
      }
    | undefined;
  const blockLabel = definition?.editor?.label;
  const propLabel = definition?.props?.[row.prop]?.label;
  return {
    ...row,
    blockLabel: typeof blockLabel === "string" ? blockLabel : row.blockType,
    propLabel: typeof propLabel === "string" ? propLabel : named(row.prop),
  };
}

/** The places a document can be in, as `?place=` names them. */
const PLACES = [
  "pages",
  "components",
  "patterns",
  "layouts",
  "entries",
  "singles",
] as const;

/**
 * The query, parsed at the boundary: a malformed one is refused as the
 * caller's mistake rather than read as something else.
 *
 * - `document`: one document's key, as the report stores it;
 * - `place`: one of the places;
 * - `page`: which hundred documents, from 1.
 */
const reportQuery = z.object({
  document: optionalText(512),
  place: z.enum(PLACES).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

/** The query's filters. */
function filtersOf(req: Request): z.output<typeof reportQuery> {
  return parseRouteQuery(
    req.url,
    ["document", "place", "page"],
    reportQuery,
    "bindings to fix"
  );
}

/**
 * A stored document as the caller may see it: only the rows of the blocks
 * fields they may read; nothing when that leaves none.
 */
function itemFor(
  entry: StoredDocumentReport,
  readable: ReadableDocument | undefined
): BindingsToFixItem | undefined {
  if (readable === undefined) return undefined;
  const rows = entry.rows.filter(row =>
    readable.fields.has(topFieldOf(row.blocksField))
  );
  if (rows.length === 0) return undefined;
  return {
    documentKey: entry.documentKey,
    kind: entry.kind,
    slug: entry.slug,
    ...(entry.documentId === undefined ? {} : { documentId: entry.documentId }),
    place: entry.place,
    title: readable.title,
    collectionLabel: readable.collectionLabel,
    rows: rows.map(withLabels),
    checkedAt: entry.checkedAt.toISOString(),
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
  const [stored, check] = await Promise.all([
    filters.document === undefined
      ? store.list()
      : store
          .get(filters.document)
          .then(entry => (entry === undefined ? [] : [entry])),
    store.fullCheck(),
  ]);
  const readable = await deps.readable(ctx, stored);
  const visible = stored.flatMap(entry => {
    const item = itemFor(entry, readable.get(entry.documentKey));
    return item === undefined ? [] : [item];
  });
  // The counts are of every place, so each tab's count stays whatever tab is
  // open; the place filter and the page come after.
  const byPlace: Record<string, number> = {};
  for (const item of visible) {
    byPlace[item.place] = (byPlace[item.place] ?? 0) + item.rows.length;
  }
  const inPlace = visible.filter(
    item => filters.place === undefined || item.place === filters.place
  );
  const totalPages = Math.max(
    1,
    Math.ceil(inPlace.length / BINDINGS_TO_FIX_PAGE_SIZE)
  );
  const start = (filters.page - 1) * BINDINGS_TO_FIX_PAGE_SIZE;
  const meta: Parameters<typeof respondList>[1] & BindingsToFixMeta = {
    total: inPlace.length,
    page: filters.page,
    limit: BINDINGS_TO_FIX_PAGE_SIZE,
    totalPages,
    hasNext: filters.page < totalPages,
    hasPrev: filters.page > 1,
    byPlace,
    bindings: visible.reduce((sum, item) => sum + item.rows.length, 0),
    checkedAt: check.completedAt?.toISOString() ?? null,
    checking: check.checking !== null,
  };
  return respondList(
    inPlace.slice(start, start + BINDINGS_TO_FIX_PAGE_SIZE),
    meta
  );
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
