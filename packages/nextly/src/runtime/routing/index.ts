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
export {
  createContentRoute,
  createPublicContentRoute,
  slugToStaticParam,
} from "./content-route";
export type {
  ContentRoute,
  StaticContentRoute,
  ContentRouteArgs,
  ContentRouteConfig,
  RenderContext,
  ResolvedContext,
} from "./content-route";

export { createSingleRoute, createPublicSingleRoute } from "./single-route";
export type {
  SingleRoute,
  SingleRouteConfig,
  SingleContext,
  SingleDraftRequest,
  SingleDocument,
  NextlySingleReader,
} from "./single-route";

export { nextlySitemap } from "./sitemap";
export type { NextlySitemapEntry, NextlySitemapOptions } from "./sitemap";

export { nextlyRobots } from "./robots";
export type { NextlyRobotsOptions } from "./robots";
