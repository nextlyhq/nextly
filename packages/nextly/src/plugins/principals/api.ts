/**
 * The two ways server code asks for a plugin's kind of signed-in person:
 * `nextly.principals` for the app, and `ctx.principals` for the plugin that
 * registered the kind.
 *
 * @module plugins/principals/api
 */
import type { PluginDefinition } from "../plugin-context";

import { lookupPrincipal, principalFromRequest } from "./recognise";
import { principalKindName } from "./registry";
import type { NextlyPrincipals, PluginPrincipalsApi } from "./types";

/** `nextly.principals`: any registered kind, by its full name. */
export function createNextlyPrincipals(): NextlyPrincipals {
  return {
    fromRequest: (request, kind) => principalFromRequest(request, kind),
    byId: (kind, id) => lookupPrincipal(kind, id),
  };
}

/**
 * `ctx.principals` for one plugin: its own kinds, by the names it gave them,
 * or `undefined` for a plugin that registers none.
 *
 * Absent rather than present and refusing every name, so a plugin's presence
 * check means what it says: `contributes.principals: []` registers nothing,
 * and its context has nothing to recognise.
 *
 * The plugin's slug is joined on here rather than taken from the caller, so a
 * plugin's context reaches its own people only, and a name it never
 * registered is refused as an unknown kind.
 */
export function createPluginPrincipals(
  plugin: PluginDefinition
): PluginPrincipalsApi | undefined {
  if ((plugin.contributes?.principals?.length ?? 0) === 0) return undefined;
  return {
    fromRequest: (request, name) =>
      principalFromRequest(request, principalKindName(plugin.name, name)),
    byId: (name, id) =>
      lookupPrincipal(principalKindName(plugin.name, name), id),
  };
}
