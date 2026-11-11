/**
 * Where a standalone plugin's rail item goes for the reader.
 *
 * @module components/layout/sidebar/lib/standalone-plugin-landing
 */
import { ROUTES, buildRoute } from "@admin/constants/routes";
import { resolveVisibleMenuItems } from "@admin/lib/plugins/menu";
import { pluginSlug } from "@admin/lib/plugins/plugin-slug";
import type { PluginMetadata } from "@admin/types/branding";
import type { AdminCapabilities } from "@admin/types/permissions";

import { standaloneEntryId } from "./place-standalone-plugins";
import {
  type StandalonePanelCollection,
  standalonePluginCollections,
} from "./standalone-plugin-collections";

/** What deciding a standalone plugin's landing needs to know of the reader. */
export interface StandaloneLandingReader {
  /** Every collection the admin lists, as its collections query returns them. */
  readonly collections: readonly StandalonePanelCollection[];
  /** The reader's capabilities, which decide the collections they may read. */
  readonly capabilities: AdminCapabilities;
  /** Whether the reader holds a permission, which gates a menu item. */
  readonly can: (permission: string) => boolean;
}

/**
 * The address a standalone plugin's rail item opens:
 *
 * 1. the landing the plugin, or the site's override, names, which the server
 *    has already resolved and checked against what the plugin owns;
 * 2. else the first collection its panel lists for the reader
 *    (`standalonePluginCollections`), so a hidden collection, one the reader
 *    may not read, or one the panel lists further down is never the one opened;
 * 3. else the first menu item its panel lists for the reader, by the same
 *    `resolveVisibleMenuItems` the panel draws them with;
 * 4. else `#`, which opens the panel rather than navigating.
 */
export function standalonePluginLanding(
  plugin: PluginMetadata,
  reader: StandaloneLandingReader
): string {
  if (plugin.landing) return plugin.landing;

  const [collection] = standalonePluginCollections(
    plugin,
    reader.collections,
    reader.capabilities
  );
  if (collection) {
    return buildRoute(ROUTES.COLLECTION_ENTRIES, { slug: collection.name });
  }

  const [item] = resolveVisibleMenuItems(
    [plugin],
    reader.can,
    standaloneEntryId(pluginSlug(plugin.name))
  );
  return item?.to ?? "#";
}
