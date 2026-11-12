/**
 * The navigation the device keeps, as the sidebar draws it: the rail's
 * entries in their order, and the Content panel's collections and Singles in
 * theirs, each reduced to a name, a link and an icon's name.
 *
 * Built from the very lists the sidebar draws (`useSidebarCollectionList`,
 * `useSidebarSingleList`), so what a fresh tab draws from memory is what the
 * person last saw, not a second answer to "what does the sidebar list".
 *
 * @module components/layout/sidebar/lib/remembered-menu
 */
import { useEffect, useSyncExternalStore } from "react";

import {
  useSidebarCollectionList,
  useSidebarSingleList,
} from "@admin/hooks/useSidebarContentLists";
import {
  deviceMemoryRevision,
  onDeviceMemoryChange,
  recallMenu,
  rememberMenu,
  type RememberedContentItem,
  type RememberedMenu,
  type RememberedRailEntry,
} from "@admin/lib/device-memory/device-memory";
import { pluginSlug } from "@admin/lib/plugins/plugin-slug";
import { resolvePluginIcon } from "@admin/lib/plugins/resolve-plugin-icon";
import {
  collectionDisplayName,
  singleDisplayName,
} from "@admin/lib/sidebar-landing";
import type { PluginMetadata } from "@admin/types/branding";
import type { ApiCollection, ApiSingle } from "@admin/types/entities";

import type { MainMenuItem } from "../sidebar-types";

import { standaloneEntryId } from "./place-standalone-plugins";

/**
 * The rail's entries as drawn, as the device keeps them: each one's name and
 * where it goes, and for a plugin's own entry the icon it names, which the
 * admin cannot draw from the entry's id alone.
 */
function railEntriesToKeep(
  items: readonly MainMenuItem[],
  hrefOf: (item: MainMenuItem) => string,
  standalonePlugins: readonly PluginMetadata[]
): RememberedRailEntry[] {
  return items.map(item => {
    const plugin = standalonePlugins.find(
      p => standaloneEntryId(pluginSlug(p.name)) === item.id
    );
    const icon = plugin
      ? resolvePluginIcon(plugin, { fallback: "Database", allowAsset: false })
          .name
      : undefined;
    return {
      id: item.id,
      label: item.label,
      href: hrefOf(item),
      ...(icon ? { icon } : {}),
    };
  });
}

/** A content item to keep, or nothing when it has no name to show. */
function contentItem(
  slug: string,
  label: string,
  icon: string | undefined
): RememberedContentItem[] {
  if (!slug || !label) return [];
  return [{ slug, label, ...(icon ? { icon } : {}) }];
}

/** The Content panel's collections, as the device keeps them. */
function rememberedCollections(
  collections: readonly ApiCollection[]
): RememberedContentItem[] {
  return collections.flatMap(collection =>
    contentItem(
      collection.name,
      collectionDisplayName(collection),
      collection.admin?.icon
    )
  );
}

/** The Content panel's Singles, as the device keeps them. */
function rememberedSingles(
  singles: readonly ApiSingle[]
): RememberedContentItem[] {
  return singles.flatMap(single =>
    contentItem(single.slug, singleDisplayName(single), single.admin?.icon)
  );
}

/**
 * The menu to keep, or undefined while the collections have not arrived. The
 * Singles are read only once a screen asked for them; until then the ones
 * kept before (`previous`) stand, so opening Collections alone does not
 * forget them.
 */
function menuToRemember(input: {
  rail: readonly RememberedRailEntry[];
  parts: RememberedMenu["parts"];
  collections: readonly RememberedContentItem[] | undefined;
  singles: readonly RememberedContentItem[] | undefined;
  previous: RememberedMenu | undefined;
}): RememberedMenu | undefined {
  if (input.collections === undefined) return undefined;
  return {
    rail: [...input.rail],
    parts: input.parts,
    collections: [...input.collections],
    singles: [...(input.singles ?? input.previous?.singles ?? [])],
  };
}

/** The device memory's revision while the server renders: it keeps nothing. */
const noRevisionOnServer = () => 0;

/**
 * Keep the sidebar's menu on the device: the rail's entries as drawn, once
 * every answer the rail draws from is in, with the Content
 * panel's lists, read from the queries the panel draws from. The Singles are
 * read only once a screen asked for them, never asked for here.
 */
function useKeepSidebarMenu({
  settled,
  items,
  hrefOf,
  standalonePlugins,
  parts,
}: {
  /** Whether every answer the rail draws from is in. */
  settled: boolean;
  /** Which parts the Content panel offers this reader. */
  parts: RememberedMenu["parts"];
  /** The rail's entries as drawn. */
  items: readonly MainMenuItem[];
  /** Where each entry goes. */
  hrefOf: (item: MainMenuItem) => string;
  /** The plugins with an entry of their own, which name its icon. */
  standalonePlugins: readonly PluginMetadata[];
}): void {
  const rail = settled
    ? railEntriesToKeep(items, hrefOf, standalonePlugins)
    : null;
  const collectionList = useSidebarCollectionList();
  const singleList = useSidebarSingleList({ enabled: false });
  // As text, so the effect runs when what would be kept changes, not on every
  // render that builds the same lists anew.
  const seen =
    rail === null
      ? null
      : JSON.stringify({
          rail,
          parts,
          collections:
            collectionList.data === undefined
              ? undefined
              : rememberedCollections(collectionList.items),
          singles: singleList.hasArrived
            ? rememberedSingles(singleList.items)
            : undefined,
        });
  // The device memory's labels moving (the schema version advanced while the
  // page is open) discards the menu kept under the old ones, though the menu
  // as drawn may be exactly what it was, as after a change to a field alone:
  // read here, that move keeps the settled menu again under the new labels.
  const labelled = useSyncExternalStore(
    onDeviceMemoryChange,
    deviceMemoryRevision,
    noRevisionOnServer
  );
  useEffect(() => {
    if (seen === null) return;
    const parsed = JSON.parse(seen) as Omit<
      Parameters<typeof menuToRemember>[0],
      "previous"
    >;
    const menu = menuToRemember({ ...parsed, previous: recallMenu() });
    if (menu !== undefined) rememberMenu(menu);
  }, [seen, labelled]);
}

/**
 * {@link useKeepSidebarMenu} as a component that draws nothing, so the
 * sidebar keeps its menu without one more hook of its own.
 */
export function KeepSidebarMenu(
  props: Parameters<typeof useKeepSidebarMenu>[0]
): null {
  useKeepSidebarMenu(props);
  return null;
}
