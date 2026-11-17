/**
 * The builder's start-up read: the reads the builder opens on, answered in
 * one request by the same route objects the plugin registers for each.
 */
import type { PluginRoute } from "@nextlyhq/plugin-sdk";

import { builderStartupRoute } from "../builder-startup-route";

/** The routes the builder reads as it opens, each as the plugin registers it. */
export interface StartupReads {
  readonly loopCollections: PluginRoute;
  readonly namedQueries: PluginRoute;
  readonly componentLibrary: PluginRoute;
  readonly patternCapability: PluginRoute;
  readonly siteStyle: PluginRoute;
  readonly pageCollection: PluginRoute;
  readonly layoutChoices: PluginRoute;
}

/** The start-up read over the routes the builder opens on. */
export function routesForStartup(reads: StartupReads): {
  readonly builderStartup: PluginRoute;
} {
  return { builderStartup: builderStartupRoute(Object.values(reads)) };
}
