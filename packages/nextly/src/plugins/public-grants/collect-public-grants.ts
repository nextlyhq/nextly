/**
 * The permissions plugins declare for the Public role on their own
 * collections (`contributes.publicGrants`), resolved to the slugs the host
 * installed those collections under.
 *
 * Pure: no database access. A disabled plugin's grants are returned apart, as
 * withheld, so the caller can take back one it made while the plugin was
 * enabled. A plugin may only open its own collections to visitors, so a grant
 * naming a collection it does not contribute, or an action other than `read`
 * and `create`, is refused here and returned for the caller to log rather
 * than granted.
 *
 * @module plugins/public-grants/collect-public-grants
 */
import type { PluginDefinition } from "../plugin-context";
import { resolvePluginSelf } from "../self";

/** The actions a plugin may grant the Public role. */
const GRANTABLE = new Set(["read", "create"]);

/** A grant to make: the permission, and the plugin that declared it. */
export interface CollectedPublicGrant {
  action: string;
  resource: string;
  owner: string;
}

/** A grant refused: what it named, and the plugin that declared it. */
export interface RefusedPublicGrant {
  action: string;
  collection: string;
  owner: string;
}

/**
 * Every plugin's declared Public grants, split into those to make, those
 * withheld because their plugin is disabled, and those refused. A grant names
 * its collection by the slug the plugin declares; a host's rename of that
 * collection is followed, as `ctx.self` follows it.
 */
export function collectPublicGrants(plugins: readonly PluginDefinition[]): {
  grants: CollectedPublicGrant[];
  withheld: CollectedPublicGrant[];
  refused: RefusedPublicGrant[];
} {
  const grants: CollectedPublicGrant[] = [];
  const withheld: CollectedPublicGrant[] = [];
  const refused: RefusedPublicGrant[] = [];
  for (const plugin of plugins) {
    // A plugin the host disabled keeps its collections but opens nothing:
    // its routes and behaviour are off, so visitors get no grant from it, and
    // one it made while enabled is withheld for the caller to take back. Its
    // refusals are not reported, since nothing it declares is acted on.
    const enabled = plugin.enabled !== false;
    // Its own collections, declared slug to the slug the host installed it
    // under: the map `ctx.self` reads, so a grant lands on the collection the
    // plugin's own code works on.
    const own = resolvePluginSelf(plugin).collections;
    for (const { collection, action } of plugin.contributes?.publicGrants ??
      []) {
      if (!Object.hasOwn(own, collection) || !GRANTABLE.has(action)) {
        if (enabled) refused.push({ action, collection, owner: plugin.name });
        continue;
      }
      (enabled ? grants : withheld).push({
        action,
        resource: own[collection],
        owner: plugin.name,
      });
    }
  }
  return { grants, withheld, refused };
}
