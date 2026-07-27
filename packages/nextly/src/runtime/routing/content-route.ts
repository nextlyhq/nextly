/**
 * `createContentRoute` — a thin factory for a single `app/[[...slug]]/page.tsx`
 * optional catch-all that resolves ANY path to a published content entry (the
 * pages-collection model: add an `/about` entry and it just works).
 *
 * You keep the route file; this fills the body. It returns `generateStaticParams`
 * (pre-render published paths, with `dynamicParams` handling the rest),
 * `generateMetadata`, and the page component — which resolves the path across the
 * configured collections, calls `notFound()` on a genuine miss or a reserved
 * path, and otherwise renders your component with the resolved entry.
 *
 * `next`/`react` imports are TYPE-ONLY and `next/navigation` is resolved lazily,
 * so importing this never forces those onto a non-Next consumer at load.
 *
 * `generateStaticParams` returns `[]` when there is nothing to pre-render (a
 * `staticParamsLimit` of `0`, or no published slugs yet), which is valid for
 * standard App Router builds. Next 16 Cache Components is stricter: an EXPORTED
 * `generateStaticParams` must return at least one entry. Under that mode, do not
 * wire `generateStaticParams` into the route file for a no-prerender/empty-site
 * setup — export only `ContentPage` and `generateMetadata` and let paths render
 * on demand.
 *
 * @module runtime/routing/content-route
 */
import { createRequire } from "node:module";

import type { Metadata } from "next";

import { getNextly } from "../../direct-api/nextly";
import { NextlyError } from "../../errors/nextly-error";

import { isReservedPath } from "./reserved-paths";
import {
  resolveContent,
  type ContentEntry,
  type NextlyContentReader,
} from "./resolve-content";

/** Where a resolved entry was found — passed to `render`/`buildMetadata`. */
export interface ResolvedContext {
  /** The collection the entry was resolved from. */
  collection: string;
  /** The joined slug path (no leading slash), e.g. `"about/team"`. */
  slug: string;
}

/**
 * Config for {@link createContentRoute}. `TNode` is the render output (your
 * server component's return, e.g. `ReactNode`) — inferred from `render`, so
 * `nextly` needs no `react` dependency of its own.
 */
/**
 * A collection to resolve paths against: a bare slug (uses the route's default
 * `statusField`), or an object that overrides the status field for THAT
 * collection — so one catch-all can mix a lifecycle collection (filter by
 * `status: "published"`) with a status-less one (`statusField: false`).
 */
export type ContentRouteCollection =
  | string
  | { slug: string; statusField?: string | false };

export interface ContentRouteConfig<TNode> {
  /**
   * Collections to resolve a path against, in order — the first collection with
   * a published entry whose slug matches the path wins. Each entry may be a bare
   * slug or `{ slug, statusField }` to set its status filter independently.
   */
  collections: ContentRouteCollection[];
  /** Render the resolved entry (your server component body). May be async. */
  render: (
    entry: ContentEntry,
    context: ResolvedContext
  ) => TNode | Promise<TNode>;
  /** Optional per-entry metadata (e.g. via `buildMetadata`). */
  buildMetadata?: (
    entry: ContentEntry,
    context: ResolvedContext
  ) => Metadata | Promise<Metadata>;
  /** Field holding the slug (default `"slug"`). */
  slugField?: string;
  /**
   * Field holding the publish status (default `"status"`), matched against
   * `"published"`. Pass `false` to skip status filtering for status-less
   * collections (no built-in draft/published lifecycle).
   */
  statusField?: string | false;
  /** Relation depth for the resolved read (default `1`). */
  depth?: number;
  /** A booted Nextly instance (defaults to `getNextly()`). */
  nextly?: NextlyContentReader;
  /**
   * Extra cache tags attached to every resolved read, so a write to a related
   * collection (a populated author, category, media) can bust the page. The
   * primary collection is always tagged; add the related collections' tags
   * (e.g. `nextlyTags("authors")`) here when you render populated relations.
   */
  tags?: string[];
  /** Time-based revalidation seconds for the resolved read. */
  revalidate?: number | false;
  /**
   * A stable discriminator folded into the resolved read's cache key — supply
   * one when distinct `nextly` readers (per-tenant/per-database) can resolve the
   * same collection + slug, so their cached reads never alias.
   */
  cacheScope?: string;
  /**
   * Max published paths to pre-render per collection in `generateStaticParams`
   * (default `1000`). The rest render on demand via `dynamicParams`.
   */
  staticParamsLimit?: number;
}

/** The optional-catch-all route arg: `{ params: Promise<{ slug?: string[] }> }`. */
export interface ContentRouteArgs {
  params: Promise<{ slug?: string[] }> | { slug?: string[] };
}

/** What {@link createContentRoute} returns — wire these into the route file. */
export interface ContentRoute<TNode> {
  generateStaticParams: () => Promise<Array<{ slug: string[] }>>;
  generateMetadata: (args: ContentRouteArgs) => Promise<Metadata>;
  ContentPage: (args: ContentRouteArgs) => Promise<TNode>;
}

// `next/navigation` is resolved lazily (opaque to bundlers), so importing this
// module never forces `next` at load; `notFound()` throws the special error the
// App Router catches to render the not-found page.
let cachedNotFound: (() => never) | null | undefined;
function loadNotFound(): () => never {
  if (cachedNotFound === undefined) {
    try {
      const require = createRequire(import.meta.url);
      const mod = require("next/navigation") as { notFound?: () => never };
      cachedNotFound = typeof mod.notFound === "function" ? mod.notFound : null;
    } catch {
      cachedNotFound = null;
    }
  }
  if (!cachedNotFound) {
    // Outside a Next runtime there is no not-found boundary to trigger.
    throw NextlyError.internal({
      logContext: {
        reason:
          "createContentRoute requires next/navigation (use it inside a Next.js app)",
      },
    });
  }
  return cachedNotFound;
}

/** Trigger the App Router's not-found boundary; never returns (narrows callers). */
function triggerNotFound(): never {
  return loadNotFound()();
}

const MAX_STATIC_PARAMS_PER_PAGE = 500;

/**
 * Map a stored slug value to a static param, or `null` to skip it. An empty
 * slug is the site root (`/`) — emitted as the no-segment param so the homepage
 * pre-renders — while whitespace-only, non-string, and reserved values are
 * dropped (the page would only `notFound()` them).
 */
export function slugToStaticParam(value: unknown): { slug: string[] } | null {
  if (typeof value !== "string") return null;
  if (value === "") return isReservedPath("/") ? null : { slug: [] };
  if (value.trim() === "") return null;
  if (isReservedPath(`/${value}`)) return null;
  return { slug: value.split("/") };
}

export function createContentRoute<TNode>(
  config: ContentRouteConfig<TNode>
): ContentRoute<TNode> {
  const slugField = config.slugField ?? "slug";
  const defaultStatusField = config.statusField ?? "status";
  const depth = config.depth ?? 1;
  const staticParamsLimit = config.staticParamsLimit ?? 1000;

  // Normalize each collection to `{ slug, statusField }` so a bare slug inherits
  // the route default while an object can set its own filter — deduped by slug.
  const collections = dedupeBySlug(
    config.collections.map(entry =>
      typeof entry === "string"
        ? { slug: entry, statusField: defaultStatusField }
        : {
            slug: entry.slug,
            statusField: entry.statusField ?? defaultStatusField,
          }
    )
  );

  const getInstance = (): NextlyContentReader => config.nextly ?? getNextly();

  /** Resolve the joined slug across the configured collections (first match wins). */
  async function resolve(
    slug: string
  ): Promise<{ entry: ContentEntry; context: ResolvedContext } | null> {
    for (const { slug: collection, statusField } of collections) {
      const entry = await resolveContent(collection, slug, {
        nextly: config.nextly,
        slugField,
        statusField,
        depth,
        tags: config.tags,
        revalidate: config.revalidate,
        cacheScope: config.cacheScope,
      });
      if (entry) return { entry, context: { collection, slug } };
    }
    return null;
  }

  async function generateStaticParams(): Promise<Array<{ slug: string[] }>> {
    // A non-positive limit disables pre-rendering entirely — every path then
    // renders on demand via `dynamicParams`. Return before querying so a `0`
    // limit yields zero params instead of one-per-collection.
    if (staticParamsLimit <= 0) return [];
    const nextly = getInstance();
    const params: Array<{ slug: string[] }> = [];
    for (const { slug: collection, statusField } of collections) {
      let page = 1;
      let collected = 0;
      for (;;) {
        const result = await nextly.find({
          collection,
          // Filter by `published` unless this collection opted out
          // (`statusField: false`), which has no such column.
          ...(statusField === false
            ? {}
            : { where: { [statusField]: { equals: "published" } } }),
          select: { [slugField]: true },
          // `id` is unique and present on every collection; `createdAt` may be
          // absent (timestamps off) or non-unique, letting rows shift between
          // pages and duplicate or vanish across the paginated scan.
          sort: "id",
          limit: MAX_STATIC_PARAMS_PER_PAGE,
          page,
        });
        for (const item of result.items) {
          const param = slugToStaticParam(item[slugField]);
          if (!param) continue;
          params.push(param);
          collected += 1;
          if (collected >= staticParamsLimit) break;
        }
        if (collected >= staticParamsLimit || !result.meta.hasNext) break;
        page += 1;
      }
    }
    return params;
  }

  async function generateMetadata(args: ContentRouteArgs): Promise<Metadata> {
    if (!config.buildMetadata) return {};
    const slug = joinSlug(await args.params);
    if (isReservedPath(`/${slug}`)) return {};
    const resolved = await resolve(slug);
    if (!resolved) return {};
    return config.buildMetadata(resolved.entry, resolved.context);
  }

  async function ContentPage(args: ContentRouteArgs): Promise<TNode> {
    const slug = joinSlug(await args.params);
    // Never serve content at a framework/metadata path.
    if (isReservedPath(`/${slug}`)) triggerNotFound();
    const resolved = await resolve(slug);
    if (!resolved) triggerNotFound();
    return config.render(resolved.entry, resolved.context);
  }

  return { generateStaticParams, generateMetadata, ContentPage };
}

/** Join the optional-catch-all segments into a slug path (no leading slash). */
function joinSlug(params: { slug?: string[] }): string {
  return (params.slug ?? []).join("/");
}

/** Dedupe normalized collections by slug, keeping the first (its status filter). */
function dedupeBySlug(
  entries: Array<{ slug: string; statusField: string | false }>
): Array<{ slug: string; statusField: string | false }> {
  const seen = new Set<string>();
  const out: Array<{ slug: string; statusField: string | false }> = [];
  for (const entry of entries) {
    if (seen.has(entry.slug)) continue;
    seen.add(entry.slug);
    out.push(entry);
  }
  return out;
}
