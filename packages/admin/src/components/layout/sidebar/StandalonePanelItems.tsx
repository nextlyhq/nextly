/**
 * The menu items a standalone plugin lists in its own panel, below its
 * collections.
 *
 * A plugin that declares nothing about its panel has its items drawn exactly
 * as every panel draws plugin items (`PluginMenuItems`). One that declares
 * groups, or a count or badge on an item, has them drawn as declared: the
 * items naming no group first, under no heading, then each group under its
 * heading in the order declared, each item with its number once the panel's
 * one request answers (`usePluginPanelCounts`). The numbers are read only
 * while this panel is drawn.
 *
 * @module components/layout/sidebar/StandalonePanelItems
 */
import { useId, type JSX, type ReactNode } from "react";

import type { ShownItemNumber } from "@admin/components/features/dashboard/PluginItemNumber";
import {
  MenuEntries,
  PluginMenuItems,
} from "@admin/components/features/dashboard/PluginMenuItems";
import type { ActiveNavSection } from "@admin/constants/nav-sections";
import { useBranding } from "@admin/context/providers/BrandingProvider";
import { usePluginPanelCounts } from "@admin/hooks/queries/usePluginPanelCounts";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import { resolveVisibleMenuItems } from "@admin/lib/plugins/menu";
import {
  declaresNumbers,
  panelPlaceOf,
  withPanelPlaces,
  type PanelItemNumber,
} from "@admin/lib/plugins/panel-counts";
import { panelItemsByGroup } from "@admin/lib/plugins/panel-groups";
import { pluginSlug } from "@admin/lib/plugins/plugin-slug";
import type { PluginMenuItemMeta, PluginMetadata } from "@admin/types/branding";

import { standaloneEntryId } from "./lib/place-standalone-plugins";

import { SidebarMenu } from "./index";

interface StandalonePanelItemsProps {
  /** The panel showing: `standalone-<slug>`. */
  section: ActiveNavSection;
  isActive: (href?: string) => boolean;
}

export function StandalonePanelItems({
  section,
  isActive,
}: StandalonePanelItemsProps): JSX.Element | null {
  const branding = useBranding();
  const plugin = panelPlugin(branding?.plugins, section);
  if (plugin === undefined || !declaresPanel(plugin)) {
    return <PluginMenuItems isActive={isActive} section={section} asMenu />;
  }
  return (
    <DeclaredPanelItems plugin={plugin} section={section} isActive={isActive} />
  );
}

/** The plugin whose standalone panel `section` is. */
function panelPlugin(
  plugins: readonly PluginMetadata[] | undefined,
  section: ActiveNavSection
): PluginMetadata | undefined {
  return (plugins ?? []).find(
    plugin => standaloneEntryId(pluginSlug(plugin.name)) === section
  );
}

/** Whether the plugin declares groups, or a number on any item. */
function declaresPanel(plugin: PluginMetadata): boolean {
  if ((plugin.panel?.groups.length ?? 0) > 0) return true;
  return declaresNumbers(plugin.menu);
}

/** What an item shows: its declared kind, and its number once read. */
function shownNumber(
  item: PluginMenuItemMeta,
  numbers: ReadonlyMap<number, PanelItemNumber>
): ShownItemNumber | undefined {
  const kind = item.badge !== undefined ? "badge" : "count";
  if (item[kind] === undefined) return undefined;
  // By the item's own place, never its address: two items may link to one
  // page and show different numbers.
  const place = panelPlaceOf(item);
  const number = place === undefined ? undefined : numbers.get(place);
  return number === undefined ? { kind } : { kind, number };
}

function DeclaredPanelItems({
  plugin,
  section,
  isActive,
}: {
  plugin: PluginMetadata;
  section: ActiveNavSection;
  isActive: (href?: string) => boolean;
}): JSX.Element | null {
  const { hasPermission } = useCurrentUserPermissions();
  // The items the panel lists for the reader, by the same filter and order
  // every panel lists plugin items with, each marked with its place among the
  // published menu first, which its number is keyed by.
  const items = resolveVisibleMenuItems(
    [{ ...plugin, menu: withPanelPlaces(plugin.menu ?? []) }],
    hasPermission,
    section
  );
  const numbers = usePluginPanelCounts(plugin);
  const { ungrouped, groups } = panelItemsByGroup(
    items,
    plugin.panel?.groups ?? []
  );
  if (items.length === 0) return null;
  const numberOf = (item: PluginMenuItemMeta) => shownNumber(item, numbers);
  return (
    <>
      {ungrouped.length > 0 ? (
        <SidebarMenu>
          <MenuEntries
            items={ungrouped}
            isActive={isActive}
            searching={false}
            numberOf={numberOf}
          />
        </SidebarMenu>
      ) : null}
      {groups.map(group => (
        <PanelGroup key={group.id} label={group.label}>
          <MenuEntries
            items={group.items}
            isActive={isActive}
            searching={false}
            numberOf={numberOf}
          />
        </PanelGroup>
      ))}
    </>
  );
}

/**
 * One group: its heading, naming the list of items under it. Spaced and
 * headed as the Settings panel's groups are, so every panel reads alike.
 */
function PanelGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): JSX.Element {
  const headingId = useId();
  return (
    <div role="group" aria-labelledby={headingId} className="space-y-1 pt-8">
      <p
        id={headingId}
        className="text-xs font-bold uppercase tracking-wider text-sidebar-foreground px-3 mb-2"
      >
        {label}
      </p>
      <SidebarMenu>{children}</SidebarMenu>
    </div>
  );
}
