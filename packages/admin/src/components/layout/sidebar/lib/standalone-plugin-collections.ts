/**
 * The collections a standalone plugin's panel lists, and in what order.
 *
 * @module components/layout/sidebar/lib/standalone-plugin-collections
 */
import { filterCollectionItems } from "@admin/lib/permissions/authorization";
import type { AdminCapabilities } from "@admin/types/permissions";

/** What listing a plugin's collection in its panel needs of it. */
export interface StandalonePanelCollection {
  name: string;
  slug?: string;
  label?: string;
  labels?: { singular?: string; plural?: string };
  admin?: { hidden?: boolean; isPlugin?: boolean; order?: number };
}

/** A collection's place in the panel when it declares none. */
const DEFAULT_ORDER = 100;

/**
 * The collections a standalone plugin's panel lists, in the order it lists
 * them: the plugin's own, not hidden, that the reader may read, by
 * `admin.order` and then by label.
 *
 * The one answer for the panel that draws them and for the rail item that
 * opens the first of them, so the rail never lands on a collection the panel
 * hides, refuses, or lists further down.
 */
export function standalonePluginCollections<
  C extends StandalonePanelCollection,
>(
  plugin: { collections?: readonly string[] },
  collections: readonly C[],
  capabilities: AdminCapabilities
): C[] {
  const owned = new Set(plugin.collections ?? []);
  const listed = collections.filter(
    c => owned.has(c.name) && !c.admin?.hidden && c.admin?.isPlugin
  );
  return filterCollectionItems(listed, capabilities).sort(byPanelOrder);
}

/** The panel's order: `admin.order`, then the label it shows. */
function byPanelOrder(
  a: StandalonePanelCollection,
  b: StandalonePanelCollection
): number {
  return (
    panelOrder(a) - panelOrder(b) || panelLabel(a).localeCompare(panelLabel(b))
  );
}

/** A collection's `admin.order`, or the default place when it declares none. */
function panelOrder(collection: StandalonePanelCollection): number {
  return collection.admin?.order ?? DEFAULT_ORDER;
}

/** The label the panel shows for a collection. */
function panelLabel(collection: StandalonePanelCollection): string {
  return collection.labels?.plural || collection.label || collection.name;
}
