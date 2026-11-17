/**
 * The public route factories: a Single page, a blocks page and the site's
 * content page, each over access-enforced or public content, and the Suspense
 * boundary an access-enforced page renders inside under Cache Components.
 *
 * @module next-page-factories
 */
import {
  createContentRoute,
  createPublicContentRoute,
  createPublicSingleRoute,
  createSingleRoute,
} from "nextly/runtime";
import type {
  ContentRoute,
  StaticContentRoute,
  RenderContext,
  SingleContext,
  SingleDocument,
  SingleRoute,
  SingleRouteArgs,
  SingleRouteConfig,
} from "nextly/runtime";
import type { ReactElement } from "react";
import { createElement, Suspense } from "react";

import {
  blocksRouteConfig,
  underCacheComponents,
  perRequestNotFound,
} from "./next-blocks-route";
import { buildContentRoute } from "./next-content-route";
import type {
  BlocksPageConfig,
  BlocksSinglePageConfig,
  ContentPageConfig,
} from "./next-page-config";

/**
 * The options a Single route takes verbatim from a blocks config.
 *
 * Split out because they are pure passthrough — every one is "state it only if
 * the caller did" — while the function below assembles the parts that are
 * DERIVED from the page route. Keeping the two apart means adding a passthrough
 * costs a line here rather than another branch in the assembly.
 *
 * Spread rather than assigned: an explicit `undefined` is not the same as an
 * absent key, because the route's own defaults are what an absent key selects.
 */
function singlePassthrough(
  config: BlocksSinglePageConfig,
  isPublic: boolean
): Partial<SingleRouteConfig<ReactElement>> {
  const {
    locale,
    depth,
    nextly,
    revalidate,
    draft,
    trustedCollections,
    notFound,
  } = config;
  return {
    ...(locale === undefined ? {} : { locale }),
    ...(depth === undefined ? {} : { depth }),
    ...(nextly === undefined ? {} : { nextly }),
    ...(revalidate === undefined ? {} : { revalidate }),
    // Passed straight to the Single route, which is where the refusal lives:
    // `createPublicSingleRoute` rejects a draft hook at construction, so
    // `createPublicSinglePage` inherits that rather than restating it.
    ...(draft === undefined ? {} : { draft }),
    ...(trustedCollections === undefined ? {} : { trustedCollections }),
    ...(perRequestNotFound(notFound, isPublic) === undefined
      ? {}
      : { notFound }),
  };
}

/**
 * Turn a Single config into the route config, reusing the PAGE route's render.
 *
 * The render is borrowed rather than rebuilt. It carries the query budget, the
 * media and entry-path resolvers, the style compilation and the SEO derivation,
 * and a second copy of that for Singles would agree on the day it was written
 * and drift afterwards — silently, because both would still draw a page.
 *
 * The borrowed callbacks expect a resolved-path context. A Single has no
 * resolved path, so one is synthesised from its slug: it reaches `readDocument`,
 * whose error names where a missing field was looked for, and the SEO
 * derivation, which uses it as the page's own identity.
 */
function blocksSingleConfig(
  config: BlocksSinglePageConfig,
  isPublic: boolean
): SingleRouteConfig<ReactElement> {
  // `draft` and `trustedCollections` are pulled out rather than left in the
  // rest, because what follows hands `blocksOptions` to the PAGE route's config
  // builder, whose `draft` hook has the collection shape — resolving an entry id
  // this route has nothing to compare against.
  const {
    slug,
    tags,
    revalidate: _revalidate,
    draft: _draft,
    trustedCollections: _trustedCollections,
    // Withheld even from a JavaScript caller who passes it anyway, which the
    // type above refuses: a Single route draws no regions.
    layouts: _layouts,
    ...blocksOptions
  } = config as BlocksSinglePageConfig & { layouts?: unknown };

  const routeConfig = blocksRouteConfig(
    {
      ...blocksOptions,
      collections: [slug],
      // The LITERAL intent, carried; the hook, still not. `draft: true` is a
      // statement about what this route serves, and the reads it governs here —
      // the components a page embeds and the media they reference — are the
      // page's own, not the Single's. Dropped along with the hook, a Single
      // serving its working draft still drew every embedded component from the
      // published read, and referenced a never-published image as no picture at
      // all. A FUNCTION is still withheld: it resolves an entry id this route
      // has nothing to compare against.
      ...(config.draft === true ? { draft: true } : {}),
    },
    isPublic,
    config.revalidate,
    "single"
  );

  // One page context per Single context, so the head's two callbacks for one
  // request share the page route's derivation, which is kept by its context's
  // identity: a fresh object each time would walk the blocks twice.
  const converted = new WeakMap<SingleContext, RenderContext>();
  const contextFor = (context: SingleContext): RenderContext => {
    const known = converted.get(context);
    if (known !== undefined) return known;
    const made: RenderContext = {
      collection: slug,
      slug,
      ...(context.locale === undefined ? {} : { locale: context.locale }),
      // Carried to the page render, which places it in the Single's HTML.
      ...(context.structuredData === undefined
        ? {}
        : { structuredData: context.structuredData }),
    };
    converted.set(context, made);
    return made;
  };

  return {
    slug,
    ...singlePassthrough(config, isPublic),
    // The media tag comes from the page route's own tag set, which is computed
    // for a collection this route does not have. Taking it from there rather
    // than recomputing keeps one answer to "what does a blocks page depend on".
    tags: [...(routeConfig.tags ?? []), ...(tags ?? [])],
    render: (document, context) =>
      routeConfig.render(document, contextFor(context)),
    ...(routeConfig.buildMetadata
      ? {
          buildMetadata: (document: SingleDocument, context: SingleContext) =>
            // Non-null asserted by the branch: this arm exists only when the
            // page route produced one.
            routeConfig.buildMetadata?.(document, contextFor(context)) ?? {},
        }
      : {}),
    // What the Single's blocks say, worked out as the page route does, so a
    // plugin that provides page metadata hears it for a Single as for a page.
    ...(routeConfig.derivedMetadata
      ? {
          derivedMetadata: (document: SingleDocument, context: SingleContext) =>
            routeConfig.derivedMetadata?.(document, contextFor(context)) ?? {},
        }
      : {}),
  };
}

/**
 * A per-request route's page body inside a Suspense boundary the page
 * provides, which only Cache Components needs.
 *
 * An access-enforced page reads at request time (the visitor's access, its
 * draft gate's cookie, a param no build lists), and under Cache Components a
 * read like that is refused above a boundary, so the boundary is where the
 * prerender stops and everything above it is a static shell. The body then
 * arrives after the shell, which React sends in a hidden part that only its
 * script reveals: such a page needs JavaScript to be seen.
 *
 * The PUBLIC factories return their route's own page, boundary-free, with
 * Cache Components on as with it off. Their page reads nothing from the
 * request on an ordinary visit, so a build makes the whole page, and the HTML
 * holds it: React outlines even a finished boundary into a hidden part once
 * it holds an eagerly loaded image or the page before it passes React's chunk
 * size, which every real page does. A path no build listed is rendered on its
 * first request, whole, and then kept, since the route exports
 * `generateStaticParams`; a draft-mode request is rendered whole on demand;
 * and a missing page rejects the page itself, which Next.js answers with a
 * 404. Only a miss the site answers with its own `notFound` is answered
 * beneath a boundary (`missesBeneathBoundary`).
 *
 * Without Cache Components every factory returns the route's own page. A
 * boundary there would let the shell stream before the body's read, so a page
 * that calls `notFound()` (an unknown or unpublished entry) would answer 200
 * with the not-found page rather than a 404.
 *
 * The pages below build this before awaiting anything, because a read above
 * the boundary is the one Cache Components refuses to prerender. They still
 * return a promise, so each keeps the type of the route page it wraps.
 */
function withinBoundary(body: ReactElement): ReactElement {
  return createElement(Suspense, { fallback: null }, body);
}

/** The site's own answer to a miss, as the route configs take it. */
type MissHandler = () => never | Promise<never>;

/**
 * Thrown in place of a public page's miss under Cache Components, for the page
 * to answer beneath a boundary (`missesBeneathBoundary`). One instance, told
 * apart by identity, so nothing else thrown can pass for it.
 */
class MissForTheBoundary extends Error {}
const MISS_FOR_THE_BOUNDARY = new MissForTheBoundary(
  "A public page's miss, answered beneath its boundary."
);

/** The miss handler a public page's own route is built with: it defers. */
function deferMiss(): never {
  throw MISS_FOR_THE_BOUNDARY;
}

/**
 * The site's handler, then Next.js's `notFound()`, as the route answers a
 * miss, rendered as a component beneath the boundary.
 */
async function AnsweredMiss({
  answer,
}: {
  answer: MissHandler;
}): Promise<never> {
  await answer();
  const { notFound } = await import("next/navigation");
  return notFound();
}

/**
 * A public page that answers a miss with the site's own `notFound` beneath a
 * Suspense boundary, under Cache Components; every other answer, the page
 * itself among them, comes back with no boundary.
 *
 * The site's handler may read the request (the SEO plugin's `notFoundLogged`
 * logs each miss with its headers), and a read of the request above a boundary
 * stops a build: a public route builds a path that holds nothing, the one it
 * lists while no page is published, as Next.js refuses an empty list. So the
 * page is built with a handler that throws `MISS_FOR_THE_BOUNDARY`, and the
 * page answers that by rendering the site's handler beneath a boundary, as
 * the page did before it drew its content boundary-free. The head
 * (`generateMetadata`) keeps the site's own handler, so it still answers the
 * miss first for a crawler.
 */
function missesBeneathBoundary<A>(
  page: (args: A) => Promise<ReactElement>,
  answer: MissHandler
): (args: A) => Promise<ReactElement> {
  return async args => {
    try {
      return await page(args);
    } catch (error) {
      if (error !== MISS_FOR_THE_BOUNDARY) throw error;
      return withinBoundary(createElement(AnsweredMiss, { answer }));
    }
  };
}

/**
 * The site's own miss handler, where a public page answers it beneath a
 * boundary: under Cache Components, and only where the site passed one.
 */
function boundaryMissHandler(
  handler: MissHandler | undefined
): MissHandler | undefined {
  return underCacheComponents() ? handler : undefined;
}

/** A Single route's page as a component, its args as its props. */
function singlePageOf(
  route: SingleRoute<ReactElement>
): (props: SingleRouteArgs) => Promise<ReactElement> {
  return props => route.SinglePage(props);
}

function singleWithinBoundary(
  route: SingleRoute<ReactElement>
): SingleRoute<ReactElement> {
  if (!underCacheComponents()) return route;
  return {
    ...route,
    // Its args passed on, so a Single under a `[locale]` segment is read in
    // the language the segment names.
    SinglePage: args =>
      Promise.resolve(
        withinBoundary(createElement(singlePageOf(route), args ?? {}))
      ),
  };
}

function contentWithinBoundary<R extends ContentRoute<ReactElement>>(
  route: R
): R {
  if (!underCacheComponents()) return route;
  return {
    ...route,
    ContentPage: args =>
      Promise.resolve(withinBoundary(createElement(route.ContentPage, args))),
  };
}

/**
 * A Single rendered as a blocks page, over ACCESS-ENFORCED content.
 *
 * The secure default, and the one to reach for unless the Single is wholly
 * public: it reads as the visitor would and waits for the request, so the
 * build touches no database.
 */
export function createSinglePage(
  config: BlocksSinglePageConfig
): SingleRoute<ReactElement> {
  return singleWithinBoundary(
    createSingleRoute<ReactElement>(blocksSingleConfig(config, false))
  );
}

/**
 * A Single rendered as a blocks page, over PUBLIC content: trusted, cached,
 * pre-renderable.
 *
 * Busted by a write to the Single, so publishing updates the live page without
 * a rebuild — but it is rendered during `next build`, so the build needs a
 * reachable database.
 */
export function createPublicSinglePage(
  config: BlocksSinglePageConfig
): SingleRoute<ReactElement> {
  // No boundary, so the page's HTML holds it: see `withinBoundary`.
  const route = createPublicSingleRoute<ReactElement>(
    blocksSingleConfig(config, true)
  );
  const answer = boundaryMissHandler(config.notFound);
  if (answer === undefined) return route;
  const page = createPublicSingleRoute<ReactElement>(
    blocksSingleConfig({ ...config, notFound: deferMiss }, true)
  );
  return {
    ...route,
    SinglePage: missesBeneathBoundary(
      (args?: SingleRouteArgs) => page.SinglePage(args),
      answer
    ),
  };
}

/**
 * A blocks page over ACCESS-ENFORCED content — the secure default: a
 * collection of block documents turned into rendered pages.
 *
 * The composition `createContentRoute` was built to carry: it resolves a path
 * to an entry and owns `generateMetadata` and the not-found decisions, and this
 * fills in the render with the block renderer over a context wired to the CMS.
 *
 * Wire the result into `app/[[...slug]]/page.tsx`:
 *
 * ```tsx
 * const { ContentPage, generateMetadata } =
 *   createBlocksPage({ collections: ["pages"], field: "content" });
 *
 * export { generateMetadata };
 * export default ContentPage;
 * ```
 *
 * There is no `generateStaticParams` here, and its absence is the contract:
 * access rules decide who may read, so the answer depends on the visitor and no
 * path can be pre-rendered. See {@link createContentRoute} for why offering one
 * anyway is a defect rather than an unused convenience. For public content,
 * {@link createPublicBlocksPage} reads trusted and returns one to export.
 *
 * Draft preview needs no argument here. `createContentRoute` owns the `draft`
 * decision and this passes it through untouched, so a preview arrives as an
 * ordinary entry that happens to be the pending one.
 */
export function createBlocksPage(
  config: BlocksPageConfig
): ContentRoute<ReactElement> {
  return contentWithinBoundary(
    createContentRoute<ReactElement>(blocksRouteConfig(config, false))
  );
}

/**
 * A blocks page over PUBLIC content: trusted reads, cacheable, pre-renderable.
 *
 * Returns `generateStaticParams` for the route file to export.
 */
export function createPublicBlocksPage(
  config: BlocksPageConfig
): StaticContentRoute<ReactElement> {
  // No boundary, so the page's HTML holds it: see `withinBoundary`.
  const route = createPublicContentRoute<ReactElement>(
    blocksRouteConfig(config, true)
  );
  const answer = boundaryMissHandler(config.notFound);
  if (answer === undefined) return route;
  const page = createPublicContentRoute<ReactElement>(
    blocksRouteConfig({ ...config, notFound: deferMiss }, true)
  );
  return {
    ...route,
    ContentPage: missesBeneathBoundary(page.ContentPage, answer),
  };
}

/**
 * The site's one content route, over ACCESS-ENFORCED reads: every path the
 * site's address store holds, a page's or a collection's entry's.
 *
 * - A path a page holds is served as {@link createBlocksPage} serves the
 *   page, its draft gate included.
 * - A path a collection's entry holds is drawn with the entry's own
 *   published design where it has one, else with the collection's published
 *   template, the entry as its bindings' `entry` source, read published-only
 *   as the public reads it. Its metadata comes from that design's own SEO
 *   settings. A draft own design is never drawn here.
 * - Any other path answers not found, and so does an entry with neither an
 *   own published design nor a collection's published template. A page's
 *   draft is served where the gate grants it, since a draft holds no
 *   address.
 *
 * Returns no `generateStaticParams`, for the reason `createBlocksPage` has
 * none.
 *
 * @experimental Settles with collection templates.
 */
export function createContentPage(
  config: ContentPageConfig
): ContentRoute<ReactElement> {
  const { ContentPage, generateMetadata } = buildContentRoute(config, false);
  return contentWithinBoundary({ ContentPage, generateMetadata });
}

/**
 * The site's one content route over PUBLIC content: cached and
 * pre-renderable. `generateStaticParams` pre-renders the addresses the store
 * holds; a path's lookup is cached, tagged with every collection whose writes
 * change who holds an address.
 *
 * @experimental Settles with collection templates.
 */
export function createPublicContentPage(
  config: ContentPageConfig
): StaticContentRoute<ReactElement> {
  // No boundary, so the page's HTML holds it: see `withinBoundary`.
  const route = buildContentRoute(config, true);
  // The route's own rule for which handler answers its misses.
  const answer = boundaryMissHandler(config.notFound ?? config.pages.notFound);
  if (answer === undefined) return route;
  const page = buildContentRoute({ ...config, notFound: deferMiss }, true);
  return {
    ...route,
    ContentPage: missesBeneathBoundary(page.ContentPage, answer),
  };
}
