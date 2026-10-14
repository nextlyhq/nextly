/**
 * The two ways server code asks for a plugin's kind of signed-in person:
 * `nextly.principals` for the app, and `ctx.principals` for the plugin that
 * registered the kind.
 *
 * @module plugins/principals/api
 */
import type { PluginDefinition } from "../plugin-context";

import { principalFromRequest } from "./recognise";
import { principalKindName } from "./registry";
import type { NextlyPrincipals, PluginPrincipalsApi } from "./types";

/** `nextly.principals`: any registered kind, by its full name. */
export function createNextlyPrincipals(): NextlyPrincipals {
  return {
    fromRequest: (request, kind) => principalFromRequest(request, kind),
  };
}

/**
 * `ctx.principals` for one plugin: its own kinds, by the names it gave them.
 *
 * The plugin's slug is joined on here rather than taken from the caller, so a
 * plugin's context reaches its own people only, and a name it never
 * registered is refused as an unknown kind.
 */
export function createPluginPrincipals(
  plugin: PluginDefinition
): PluginPrincipalsApi {
  return {
    fromRequest: (request, name) =>
      principalFromRequest(request, principalKindName(plugin.name, name)),
  };
}
