/**
 * Boot-check that every collection-backed menu item names a collection its
 * plugin actually contributes. Throws fail-fast.
 *
 * A `collection` that no contribution matches is not a cosmetic slip. The
 * serializer derives the item's destination and its read permission from that
 * slug, so a misspelling produces a well-formed path to a list that does not
 * exist and a well-formed gate on a permission the seeder never creates. Every
 * ordinary user then loses the item — indistinguishable from a role lacking
 * access — and every super-admin gets a broken link.
 *
 * The check belongs at REGISTRATION for the same reason `validatePluginSlugs`
 * does. Both admin surfaces answer a bad slug with something that looks like a
 * legitimate outcome, so neither can report it; and running it only while
 * serializing admin metadata would let the app boot and then throw on every
 * branding request, which can take the sign-in screen with it. A configuration
 * mistake should stop the process that loaded the configuration.
 *
 * @module plugins/validate-menus
 */
import type { PluginMenuItem } from "./admin-contributions";
import { pluginCollectionSlugs } from "./plugin-admin-meta";
import type { PluginDefinition } from "./plugin-context";
import { resolutionError } from "./resolution-error";

/** Every item in a menu tree, parents and children alike. */
function flatten(items: readonly PluginMenuItem[]): PluginMenuItem[] {
  return items.flatMap(item => [item, ...flatten(item.children ?? [])]);
}

export function validatePluginMenus(plugins: PluginDefinition[]): void {
  for (const plugin of plugins) {
    const menu = plugin.contributes?.admin?.menu;
    if (!menu || menu.length === 0) continue;

    const owned = pluginCollectionSlugs(plugin);

    for (const item of flatten(menu)) {
      // A child is exactly as stranded as a parent, which is why the walk is
      // over the flattened tree rather than the top level.
      if (item.collection === undefined) continue;
      if (owned.includes(item.collection)) continue;

      // Both the offending slug and the ones it could have been: neither is
      // recoverable from the other, and a reader looking at their own typo is
      // exactly the reader who cannot see it.
      throw resolutionError(
        "menu-item-unowned-collection",
        `Plugin "${plugin.name}" has a menu item ("${item.label}") naming ` +
          `collection "${item.collection}", which it does not contribute. ` +
          `Name one of: ${owned.join(", ") || "(none)"}.`,
        { plugin: plugin.name, collection: item.collection, owned }
      );
    }
  }
}
