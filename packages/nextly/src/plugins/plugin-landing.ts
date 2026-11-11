/**
 * Where a plugin's own rail item lands: the `landing` the plugin, or the site
 * through `admin.pluginOverrides`, names, resolved to the admin address the
 * rail links to; and what start-up says about it in development.
 *
 * One resolution for both readers. The admin metadata serializes what it
 * resolves to, and the start-up report names what it refused, so the value a
 * developer is warned about is exactly the value the admin goes without.
 *
 * @module plugins/plugin-landing
 */
import type { PluginOverride } from "../shared/types/config";

import { pluginCollectionSlugs } from "./plugin-admin-meta";
import type { PluginDefinition } from "./plugin-context";
import { pluginAdminSlug } from "./plugin-slug";
import { renamedSlug, retargetedTo } from "./served-collection-slug";

/** Where a collection's list is, ahead of its slug. */
const COLLECTIONS_PREFIX = "/admin/collections/";

/** A plugin's landing: none named, resolved to an admin address, or refused. */
export type PluginLanding =
  | { readonly kind: "unset" }
  | {
      readonly kind: "resolved";
      /** The admin address the rail item links to. */
      readonly href: string;
    }
  | {
      readonly kind: "unknown";
      /** The value as written, which names nothing the plugin owns. */
      readonly declared: string;
      /** Whether the site's override or the plugin itself wrote it. */
      readonly source: "pluginOverrides" | "plugin";
    };

/**
 * The placement a plugin is drawn in: the site's override, then the plugin's
 * own, then Plugins. The admin metadata and the start-up report both read it
 * here, so a plugin the report calls standalone is one the rail draws as such.
 */
export function resolvedPluginPlacement(
  plugin: PluginDefinition,
  hostOverride: PluginOverride | undefined
): string {
  return hostOverride?.placement ?? plugin.admin?.placement ?? "plugins";
}

/**
 * The plugin's landing, with the site's override winning over the plugin's
 * own as it does for placement and order.
 *
 * Accepts the forms a menu item's `to` is written in: one of the plugin's own
 * pages, `/admin/plugins/<slug>/<path>`, and one of its own collections,
 * `/admin/collections/<slug>`. A collection is resolved as a menu item naming
 * it is (`retargetedTo`), so a host's rename moves the link with the slug. It
 * may also be named by the slug the host registered, which is the one a site
 * writing an override knows. Anything else is `unknown`: a link to an address
 * the plugin does not own could go anywhere, and an ignored value falls back
 * to the landing the plugin had without it.
 */
export function resolvePluginLanding(
  plugin: PluginDefinition,
  hostOverride: PluginOverride | undefined
): PluginLanding {
  const fromOverride = hostOverride?.landing;
  const declared = fromOverride ?? plugin.admin?.landing;
  if (declared === undefined) return { kind: "unset" };
  const source = fromOverride === undefined ? "plugin" : "pluginOverrides";

  // Configuration is written in plain JavaScript too, where nothing stops a
  // value that is not a string; it is refused rather than read as a path.
  if (typeof declared !== "string") {
    return { kind: "unknown", declared: String(declared), source };
  }
  const href = ownedDestination(plugin, declared);
  return href === undefined
    ? { kind: "unknown", declared, source }
    : { kind: "resolved", href };
}

/**
 * The admin address `declared` resolves to when it names one of the plugin's
 * own pages or collections, or `undefined` when it names neither.
 */
function ownedDestination(
  plugin: PluginDefinition,
  declared: string
): string | undefined {
  // The address without a query or hash, which are carried through unchanged.
  const [path = ""] = declared.split(/[?#]/, 1);

  if (path.startsWith(COLLECTIONS_PREFIX)) {
    const [named = ""] = path.slice(COLLECTIONS_PREFIX.length).split("/", 1);
    const renameMap = plugin.renameMap ?? {};
    const slugs = pluginCollectionSlugs(plugin);
    // A declared slug wins over a registered one across the whole set: renames
    // may chain (`reports` to `exports`, `exports` to `data-exports`), and the
    // plugin's author writes the slug they declared.
    if (slugs.includes(named)) {
      return retargetedTo(declared, named, renamedSlug(renameMap, named));
    }
    return slugs.some(slug => renamedSlug(renameMap, slug) === named)
      ? declared
      : undefined;
  }

  // The address the admin mounts the plugin's pages at (`pluginPagePath`).
  const pagesPrefix = `/admin/plugins/${pluginAdminSlug(plugin.name)}/`;
  if (path.startsWith(pagesPrefix)) {
    const named = path.slice(pagesPrefix.length);
    const pages = plugin.contributes?.admin?.pages ?? [];
    return pages.some(page => page.path.replace(/^\/+/, "") === named)
      ? declared
      : undefined;
  }
  return undefined;
}

/** One line of the start-up report about plugins' landings. */
export interface PluginLandingWarning {
  readonly kind: "plugin-landing-unknown" | "plugin-landing-missing";
  readonly plugin: string;
  readonly message: string;
}

/**
 * What a development start says about the plugins' landings, and nothing
 * anywhere else: the value it reports is already ignored in every
 * environment, so a production log would gain a line nobody there can act on.
 *
 * Two things are reported, neither of them fatal:
 * - a landing that names neither one of the plugin's pages nor one of its
 *   collections, which is ignored;
 * - a standalone plugin with no landing and no collections, whose rail item
 *   then opens the first menu item of its panel, which may not be the page
 *   its author meant people to start on.
 *
 * Disabled plugins are skipped: they draw no menu items and no pages.
 */
export function pluginLandingWarnings(
  plugins: readonly PluginDefinition[],
  pluginOverrides: Record<string, PluginOverride> | undefined,
  nodeEnv: string | undefined
): PluginLandingWarning[] {
  if (nodeEnv !== "development") return [];

  return plugins.flatMap(plugin => {
    if (plugin.enabled === false) return [];
    const slug = pluginAdminSlug(plugin.name);
    const hostOverride = pluginOverrides?.[slug];
    const landing = resolvePluginLanding(plugin, hostOverride);
    const warnings: PluginLandingWarning[] = [];

    if (landing.kind === "unknown") {
      const where =
        landing.source === "pluginOverrides"
          ? `The site's admin.pluginOverrides["${slug}"].landing`
          : `Plugin "${plugin.name}"'s admin.landing`;
      warnings.push({
        kind: "plugin-landing-unknown",
        plugin: plugin.name,
        message:
          `${where} names "${landing.declared}", which is neither one of its ` +
          `pages (/admin/plugins/${slug}/<path>) nor one of its collections ` +
          `(/admin/collections/<slug>). It is ignored.`,
      });
    }

    if (
      landing.kind !== "resolved" &&
      resolvedPluginPlacement(plugin, hostOverride) === "standalone" &&
      pluginCollectionSlugs(plugin).length === 0 &&
      listsMenuItems(plugin)
    ) {
      warnings.push({
        kind: "plugin-landing-missing",
        plugin: plugin.name,
        message:
          `Plugin "${plugin.name}" is placed standalone and names no landing ` +
          `page, and has no collections, so its rail item opens the first ` +
          `menu item its panel lists. Name the page to start on with ` +
          `admin.landing.`,
      });
    }
    return warnings;
  });
}

/**
 * Whether the plugin's own standalone panel lists a menu item: one declaring
 * no section, which defers to the plugin's placement, or the standalone
 * section itself. An item placed in another section is listed there, so it is
 * not one this plugin's rail item could open.
 */
function listsMenuItems(plugin: PluginDefinition): boolean {
  const items = plugin.contributes?.admin?.menu ?? [];
  return items.some(
    item => item.section === undefined || item.section === "standalone"
  );
}
