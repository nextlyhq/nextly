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
 * @module runtime/routing/content-route
 */
import { createRequire } from "node:module";

import type { Metadata } from "next";

import { getNextly } from "../../direct-api/nextly";
import type { Nextly } from "../../direct-api/nextly";

import { isReservedPath } from "./reserved-paths";
import { resolveContent, type ContentEntry } from "./resolve-content";

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
export interface ContentRouteConfig<TNode> {
  /**
   * Collections to resolve a path against, in order — the first collection with
   * a published entry whose slug matches the path wins.
   */
  collections: string[];
  /** Render the resolved entry (your server component body). */
  render: (entry: ContentEntry, context: ResolvedContext) => TNode;
  /** Optional per-entry metadata (e.g. via `buildMetadata`). */
  buildMetadata?: (
    entry: ContentEntry,
    context: ResolvedContext
  ) => Metadata | Promise<Metadata>;
  /** Field holding the slug (default `"slug"`). */
  slugField?: string;
  /** Relation depth for the resolved read (default `1`). */
  depth?: number;
  /** A booted Nextly instance (defaults to `getNextly()`). */
  nextly?: Nextly;
  /** Time-based revalidation seconds for the resolved read. */
  revalidate?: number | false;
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
    throw new Error(
      "createContentRoute requires next/navigation (use it inside a Next.js app)"
    );
  }
  return cachedNotFound;
}

/** Trigger the App Router's not-found boundary; never returns (narrows callers). */
function triggerNotFound(): never {
  return loadNotFound()();
}

const MAX_STATIC_PARAMS_PER_PAGE = 500;

export function createContentRoute<TNode>(
  config: ContentRouteConfig<TNode>
): ContentRoute<TNode> {
  const collections = [...new Set(config.collections)];
  const slugField = config.slugField ?? "slug";
  const depth = config.depth ?? 1;
  const staticParamsLimit = config.staticParamsLimit ?? 1000;

  const getInstance = (): Nextly => config.nextly ?? getNextly();

  /** Resolve the joined slug across the configured collections (first match wins). */
  async function resolve(
    slug: string
  ): Promise<{ entry: ContentEntry; context: ResolvedContext } | null> {
    for (const collection of collections) {
      const entry = await resolveContent(collection, slug, {
        nextly: config.nextly,
        slugField,
        depth,
        revalidate: config.revalidate,
      });
      if (entry) return { entry, context: { collection, slug } };
    }
    return null;
  }

  async function generateStaticParams(): Promise<Array<{ slug: string[] }>> {
    const nextly = getInstance();
    const params: Array<{ slug: string[] }> = [];
    for (const collection of collections) {
      let page = 1;
      let collected = 0;
      for (;;) {
        const result = await nextly.find({
          collection,
          where: { status: { equals: "published" } },
          select: { [slugField]: true },
          sort: "createdAt",
          limit: MAX_STATIC_PARAMS_PER_PAGE,
          page,
        });
        for (const item of result.items) {
          const value = item[slugField];
          if (typeof value !== "string" || value.trim() === "") continue;
          params.push({ slug: value.split("/") });
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
