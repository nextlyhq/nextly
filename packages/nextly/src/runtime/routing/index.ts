/**
 * `runtime/routing` — Next-coupled content-routing + sitemap/robots delivery.
 * `next`/`react` imports are type-only and `next/navigation` is resolved
 * lazily, so importing this never forces those at load.
 *
 * @module runtime/routing
 */
export { resolveContent } from "./resolve-content";
export type {
  ContentEntry,
  NextlyContentReader,
  ResolveContentOptions,
} from "./resolve-content";

export { isReservedPath } from "./reserved-paths";

// `slugToStaticParam` is public because it is the route's own answer to "what
// path does this stored slug render at". Anything emitting a URL for an entry —
// a canonical, a link between entries — has to agree with the route or it names
// a path the route does not serve, and re-deriving the rule is how the two come
// to disagree.
//
// Taken from the LEAF module rather than through `./content-route`, which also
// re-exports it. Both spellings compile and one of them hands every consumer of
// this barrel the route's whole import graph for a pure string function.
export {
  slugToStaticParam,
  LIST_PAGE_SEGMENT,
  listPageNumber,
  listPageOf,
  slugToPath,
} from "./slug-param";

export {
  contentPageMetadata,
  contentPageStructuredData,
  createContentRoute,
  createPublicContentRoute,
} from "./content-route";
export type {
  ContentRoute,
  StaticContentRoute,
  ContentRouteArgs,
  ContentRouteParams,
  ContentStaticParamsArgs,
  ContentRouteConfig,
  RenderContext,
  ResolvedContext,
} from "./content-route";

export {
  createSingleRoute,
  createPublicSingleRoute,
  singlePageMetadata,
  singlePageStructuredData,
} from "./single-route";
export type {
  SingleRoute,
  SingleRouteArgs,
  SingleRouteParams,
  SinglePageAnswerConfig,
  SingleRouteConfig,
  SingleContext,
  SingleDraftRequest,
  SingleDocument,
  NextlySingleReader,
} from "./single-route";

// The language a request is served in, from a `[locale]` segment, and the
// address it is served at in that language: for a route built on the content
// route that reads the segment itself (`@nextlyhq/blocks-react`'s).
// @experimental
export {
  confirmedLanguage,
  requestLanguage,
  servedAddress,
} from "./request-language";
export type { RequestLanguage } from "./request-language";

export { nextlySitemap } from "./sitemap";
export type { NextlySitemapEntry, NextlySitemapOptions } from "./sitemap";

export { nextlyRobots } from "./robots";
export type { NextlyRobotsOptions } from "./robots";
