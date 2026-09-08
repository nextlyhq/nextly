import type { MainMenuCategory, MainMenuItem } from "../sidebar-types";

/** What placing a plugin in the rail needs of it, and nothing more. */
export interface StandaloneMenuPlugin {
  name: string;
  /** The rail entry this plugin asks to sit after. */
  after?: string;
  /** Tie-break among plugins anchored to the same entry; lower comes first. */
  order?: number;
  appearance?: { label?: string };
}

interface PlacementDeps<P> {
  slugOf: (name: string) => string;
  /**
   * The icon component for this plugin.
   *
   * Resolved by the caller because a menu item stores an ElementType rendered
   * as `<Icon className=… />`, so this surface cannot show an image, and the
   * resolution that knows which asset to decline lives with the icon registry
   * rather than here.
   */
  iconFor: (plugin: P) => MainMenuItem["icon"];
}

/**
 * The rail entry each anchor name refers to.
 *
 * `users` is remapped rather than dropped: the top-level Users icon is gone and
 * User Management lives under Settings, so a plugin still declaring
 * `after: "users"` is anchored next to Settings instead of falling through to
 * the end of the rail.
 */
const ANCHORS: Record<string, string> = {
  dashboard: "dashboard",
  collections: "collections",
  singles: "singles",
  media: "media",
  plugins: "plugins",
  settings: "settings",
  users: "settings",
};

/**
 * The primary rail's items, with standalone plugins placed among them.
 *
 * A plugin declares where it wants to sit (`after`) and how it sorts against
 * others asking for the same place (`order`). Anything anchored to an entry
 * that is not in the rail — because the reader cannot see it, or because the
 * plugin named something that never existed — is appended rather than dropped,
 * so a plugin is never made unreachable by a name it got wrong.
 *
 * @module components/layout/sidebar/lib/place-standalone-plugins
 */
export function placeStandalonePlugins<P extends StandaloneMenuPlugin>(
  baseMenuItems: readonly MainMenuItem[],
  plugins: readonly P[],
  deps: PlacementDeps<P>
): readonly MainMenuItem[] {
  if (plugins.length === 0) return baseMenuItems;

  const byAnchor = new Map<string, { item: MainMenuItem; order: number }[]>();
  for (const plugin of plugins) {
    const anchor = ANCHORS[plugin.after ?? "plugins"] ?? "plugins";
    const entry = {
      item: {
        id: `standalone-${deps.slugOf(plugin.name)}` as MainMenuCategory,
        label: plugin.appearance?.label || plugin.name,
        icon: deps.iconFor(plugin),
        href: "#",
      },
      order: plugin.order ?? 100,
    };
    byAnchor.set(anchor, [...(byAnchor.get(anchor) ?? []), entry]);
  }

  for (const group of byAnchor.values()) {
    group.sort((a, b) => a.order - b.order);
  }

  const placed: MainMenuItem[] = [];
  for (const item of baseMenuItems) {
    placed.push(item);
    for (const { item: standalone } of byAnchor.get(item.id) ?? []) {
      placed.push(standalone);
    }
    byAnchor.delete(item.id);
  }

  // Anchored to something this rail does not show. Appended so the plugin
  // stays reachable.
  for (const group of byAnchor.values()) {
    for (const { item: standalone } of group) placed.push(standalone);
  }
  return placed;
}
