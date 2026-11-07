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

import { getBlock } from "@nextlyhq/blocks-engine";

import { labelOf, pluralLabelOf } from "../collection-labels";
import { PAGES_SLUG } from "../collections/pages";
import type { HostAddress } from "../host-rewrite/contract";

import {
  BINDINGS_TO_FIX_ROUTE_PATH,
  type BindingsToFixItem,
  type BindingsToFixMeta,
  type BindingsToFixRow,
} from "./contract";
import type { BindingReportRow } from "./rows";
import { MAX_REPORTED_DOCUMENTS, type BindingReportStore } from "./store";





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

/** Each collection's name as the admin shows it, read once per answer. */
function collectionLabels(
  ctx: PluginRouteContext
): (slug: string) => Promise<string> {
  const known = new Map<string, Promise<string>>();
  return slug => {
    let held = known.get(slug);
    if (held === undefined) {
      held = ctx.services.collections
        .getCollection(slug, undefined as never)
        .then(record => {
          const fields = record as unknown as Record<string, unknown>;
          return pluralLabelOf(fields).pluralLabel ?? labelOf(fields, slug);
        })
        .catch(() => slug);
      known.set(slug, held);
    }
    return held;
  };
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
  const labelOfCollection = collectionLabels(ctx);
  // Only documents the caller may read; the place filter after the counts,
  // so each tab's count stays whatever tab is open.
  const labelled = await Promise.all(
    wanted.map(async entry => ({
      entry,
      title: names.get(entry.documentKey),
      collectionLabel:
        entry.kind === "single" ? entry.slug : await labelOfCollection(entry.slug),
    }))
  );
  const readable: BindingsToFixItem[] = labelled.flatMap(
    ({ entry, title, collectionLabel }) => {
    return title === undefined
      ? []
      : [
          {
            collectionLabel,
            documentKey: entry.documentKey,
            kind: entry.kind,
            slug: entry.slug,
            ...(entry.documentId === undefined
              ? {}
              : { documentId: entry.documentId }),
            place: entry.place,
            title,
            rows: entry.rows.map(withLabels),
            checkedAt: entry.checkedAt.toISOString(),
          },
        ];
    }
  );
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
