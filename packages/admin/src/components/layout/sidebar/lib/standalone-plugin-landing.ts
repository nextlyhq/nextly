/**
 * Where a standalone plugin's rail item goes for the reader.
 *
 * @module components/layout/sidebar/lib/standalone-plugin-landing
 */
import { ROUTES, buildRoute } from "@admin/constants/routes";
import { capabilitiesAllow } from "@admin/hooks/useCurrentUserPermissions";
import { resolveVisibleMenuItems } from "@admin/lib/plugins/menu";
import { pluginPagePath } from "@admin/lib/plugins/plugin-route-registry";
import { pluginSlug } from "@admin/lib/plugins/plugin-slug";
import { resolveRoute } from "@admin/lib/routing";
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

/** Where a collection's list is, ahead of its slug. */
const COLLECTIONS_PREFIX = "/admin/collections/";

/**
 * The address a standalone plugin's rail item opens:
 *
 * 1. the landing the plugin, or the site's override, names, which the server
 *    has already resolved and checked against what the plugin owns, where the
 *    reader may open it (`landingOpensFor`);
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
  if (plugin.landing && landingOpensFor(plugin, plugin.landing, reader)) {
    return plugin.landing;
  }

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

/**
 * Whether the reader may open the plugin's landing, as the destination's own
 * guard decides: a collection address by the action its route asks of the
 * collection (`resolveRoute`'s `entityAccess`: reading its list, creating an
 * entry, reading a document's history), and one of the plugin's pages by the
 * `requiredPermission` its route carries, which `PermissionGuard` checks with
 * `hasPermission`. A landing the reader would be refused at, or one no route
 * answers, falls through to the next rule, so the rail never sends them to a
 * refusal.
 *
 * A landing that is neither is followed: the server serializes only one that
 * names one of the plugin's pages or collections.
 */
function landingOpensFor(
  plugin: PluginMetadata,
  landing: string,
  reader: StandaloneLandingReader
): boolean {
  // The address without a query or hash, as the route is matched.
  const [path = ""] = landing.split(/[?#]/, 1);

  if (path.startsWith(COLLECTIONS_PREFIX)) {
    const access = resolveRoute(path, "").entityAccess;
    return (
      access !== undefined &&
      capabilitiesAllow(reader.capabilities, access.slug, access.action)
    );
  }

  // Matched as the route registry matches a page: its full address, built by
  // the same function it registers the page under.
  const slug = pluginSlug(plugin.name);
  const page = plugin.pages?.find(p => pluginPagePath(slug, p.path) === path);
  if (page === undefined) return true;
  // Guarded only when it names one, as `RootLayout` guards a route.
  return !page.requiredPermission || reader.can(page.requiredPermission);
}
