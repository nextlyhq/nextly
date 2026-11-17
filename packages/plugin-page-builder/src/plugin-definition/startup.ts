/**
 * The builder's start-up read: the reads the builder opens on, answered in
 * one request by the same route objects the plugin registers for each.
 */
import type { PluginRoute } from "@nextlyhq/plugin-sdk";

import { builderStartupRoute } from "../builder-startup-route";

/**
 * The routes the builder reads as it opens, each as the plugin registers it,
 * whose handlers judge their callers. The component library and the Layout
 * choices are gated by a declared permission, which the dispatcher judges,
 * so they are read on their own.
 */
export interface StartupReads {
  readonly loopCollections: PluginRoute;
  readonly namedQueries: PluginRoute;
  readonly patternCapability: PluginRoute;
  readonly siteStyle: PluginRoute;
  readonly pageCollection: PluginRoute;
}

/** The start-up read over the routes the builder opens on. */
export function routesForStartup(reads: StartupReads): {
  readonly builderStartup: PluginRoute;
} {
  return { builderStartup: builderStartupRoute(Object.values(reads)) };
}
