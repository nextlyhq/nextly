/**
 * The collections whose document screens start with the rail's panel folded
 * away (`contributes.admin.views[slug].foldedPanel`), on the slugs the admin
 * routes them under.
 *
 * Read in two places that must agree: the admin metadata, which tells a
 * signed-in admin, and the prebuilt admin page, which tells the admin's first
 * frame before any request has answered. So the frame draws a folded screen
 * folded from its first paint, and nothing moves when the screen arrives.
 *
 * Imports nothing but types and the import-free slug helpers, as the admin
 * layout reaches it through `nextly/config`.
 *
 * @module plugins/folded-panels
 */
import type { PluginDefinition } from "./plugin-context";
import { renamedSlug } from "./plugin-slug";

/**
 * The slugs whose document screens one plugin, or every plugin in a list,
 * declares folded. Disabled plugins declare none: their views are not served.
 * Only an explicit `true` counts, so a JavaScript plugin's stray value folds
 * nothing (the boot check refuses it by name).
 */
export function foldedPanelCollections(
  plugins: readonly PluginDefinition[] | undefined
): string[] {
  const slugs: string[] = [];
  for (const plugin of plugins ?? []) {
    if (plugin.enabled === false) continue;
    const views = plugin.contributes?.admin?.views ?? {};
    for (const [declared, view] of Object.entries(views)) {
      const slug = renamedSlug(plugin, declared);
      if (view?.foldedPanel === true && !slugs.includes(slug)) {
        slugs.push(slug);
      }
    }
  }
  return slugs;
}
