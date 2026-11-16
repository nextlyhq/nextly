/**
 * How a standalone plugin's panel lists its menu items: the ones naming no
 * group first, under no heading, then each declared group under its heading,
 * in the order the plugin declared them.
 *
 * @module lib/plugins/panel-groups
 */
import type {
  PluginMenuItemMeta,
  PluginPanelGroupMeta,
} from "@admin/types/branding";

/** One heading of the panel and the items listed under it. */
export interface PanelGroupItems {
  readonly id: string;
  readonly label: string;
  readonly items: readonly PluginMenuItemMeta[];
}

/** The panel's items, split as it draws them. */
export interface PanelItems {
  /** The items naming no group the panel draws, in their own order. */
  readonly ungrouped: readonly PluginMenuItemMeta[];
  /** Each group holding an item, in the order declared. */
  readonly groups: readonly PanelGroupItems[];
}

/**
 * Splits `items`, as the panel already lists them for the reader, by the
 * group each names. An item naming a group not in `groups` is listed with
 * the ungrouped ones, so it is never lost; a group with no item draws no
 * heading. Each item keeps its place within its part.
 */
export function panelItemsByGroup(
  items: readonly PluginMenuItemMeta[],
  groups: readonly PluginPanelGroupMeta[]
): PanelItems {
  const known = new Set(groups.map(group => group.id));
  const inGroup = (item: PluginMenuItemMeta) =>
    item.group !== undefined && known.has(item.group);
  return {
    ungrouped: items.filter(item => !inGroup(item)),
    groups: groups.flatMap(group => {
      const held = items.filter(item => item.group === group.id);
      return held.length === 0
        ? []
        : [{ id: group.id, label: group.label, items: held }];
    }),
  };
}
