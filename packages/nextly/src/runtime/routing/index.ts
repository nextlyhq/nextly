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

export { createContentRoute } from "./content-route";
export type {
  ContentRoute,
  ContentRouteArgs,
  ContentRouteConfig,
  RenderContext,
  ResolvedContext,
} from "./content-route";

export { nextlySitemap } from "./sitemap";
export type { NextlySitemapEntry, NextlySitemapOptions } from "./sitemap";

export { nextlyRobots } from "./robots";
export type { NextlyRobotsOptions } from "./robots";
