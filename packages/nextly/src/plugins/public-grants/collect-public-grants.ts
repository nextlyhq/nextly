/**
 * The permissions plugins declare for the Public role on their own
 * collections (`contributes.publicGrants`), resolved to the slugs the host
 * installed those collections under.
 *
 * Pure: no database access. A plugin may only open its own collections to
 * visitors, so a grant naming a collection it does not contribute, or an
 * action other than `read` and `create`, is refused here and returned for the
 * caller to log rather than granted.
 *
 * @module plugins/public-grants/collect-public-grants
 */
import type { PluginDefinition } from "../plugin-context";

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
 * Every plugin's declared Public grants, split into those to make and those
 * refused. A grant names its collection by the slug the plugin declares; a
 * host's rename of that collection is followed, as `ctx.self` follows it.
 */
export function collectPublicGrants(plugins: readonly PluginDefinition[]): {
  grants: CollectedPublicGrant[];
  refused: RefusedPublicGrant[];
} {
  const grants: CollectedPublicGrant[] = [];
  const refused: RefusedPublicGrant[] = [];
  for (const plugin of plugins) {
    const own = new Set(
      (plugin.contributes?.collections ?? []).map(({ slug }) => slug)
    );
    const renameMap = plugin.renameMap ?? {};
    for (const { collection, action } of plugin.contributes?.publicGrants ??
      []) {
      if (!own.has(collection) || !GRANTABLE.has(action)) {
        refused.push({ action, collection, owner: plugin.name });
        continue;
      }
      grants.push({
        action,
        // `Object.hasOwn`, for a slug such as `constructor`, which a plain
        // lookup would answer with an inherited function.
        resource: Object.hasOwn(renameMap, collection)
          ? renameMap[collection]
          : collection,
        owner: plugin.name,
      });
    }
  }
  return { grants, refused };
}
