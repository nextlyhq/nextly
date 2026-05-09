/**
 * Shared filter + sort helpers that decide which collection / single
 * the sidebar renders FIRST in its respective section. Reused by:
 *
 * - `DynamicCollectionNav` and `DynamicSingleNav` (sidebar render order)
 * - `CollectionsLandingRedirect` and `SinglesLandingRedirect` (deciding
 *   where `/admin/collections` and `/admin/singles` should land)
 *
 * Centralising the logic guarantees the redirect target is always the
 * same as the sidebar's first item (WYSIWYG). If the sidebar's order
 * changes in the future, the redirects follow automatically.
 */

import {
  filterCollectionItems,
  filterSingleItems,
} from "@admin/lib/permissions/authorization";
import type { AdminBranding, PluginMetadata } from "@admin/types/branding";
import type { ApiCollection, ApiSingle } from "@admin/types/entities";
import type { AdminCapabilities } from "@admin/types/permissions";

interface CollectionsLandingDeps {
  /** From `useBranding()` — needed to resolve plugin placement overrides. */
  branding: AdminBranding | undefined;
  /** From `useCurrentUserPermissions().capabilities`. */
  capabilities: AdminCapabilities;
  /** From `useSidebarPins({ storageKey: PINNED_COLLECTIONS_STORAGE_KEY }).pinned`. */
  pinnedCollections: Set<string>;
}

interface SinglesLandingDeps {
  /** From `useCurrentUserPermissions().capabilities`. */
  capabilities: AdminCapabilities;
  /** From `useSidebarPins({ storageKey: PINNED_SINGLES_STORAGE_KEY }).pinned`. */
  pinnedSingles: Set<string>;
}

/**
 * Returns true if `collection` is rendered in the sidebar's "Collections"
 * section. Mirrors the inline filter inside `DynamicCollectionNav`.
 *
 * Rules (any of):
 *   - explicit `admin.sidebarGroup === "collections"`
 *   - no `sidebarGroup` AND not a plugin
 *   - is a plugin AND its plugin metadata `placement === "collections"`
 *
 * Hidden collections (`admin.hidden === true`) are always excluded.
 */
function isInCollectionsSection(
  collection: ApiCollection,
  pluginMetadata: PluginMetadata[] | undefined
): boolean {
  if (collection.admin?.hidden) return false;
  const group = collection.admin?.sidebarGroup;
  if (group === "collections") return true;
  if (!group && !collection.admin?.isPlugin) return true;
  if (collection.admin?.isPlugin) {
    const meta = pluginMetadata?.find(p =>
      (p.collections ?? []).includes(collection.name)
    );
    const placement = meta?.placement ?? meta?.group;
    return placement === "collections";
  }
  return false;
}

/**
 * Returns true if `single` is rendered in the sidebar's "Singles" section.
 * Mirrors the inline filter inside `DynamicSingleNav`. Singles do not have
 * plugin-placement overrides today.
 */
function isInSinglesSection(single: ApiSingle): boolean {
  if (single.admin?.hidden) return false;
  const group = single.admin?.sidebarGroup;
  if (group === "singles") return true;
  if (!group) return true;
  return false;
}

/**
 * Build the comparator the sidebar uses to order items: pinned first,
 * then `admin.order` ascending (default 100), then display name asc.
 */
function makeSidebarComparator<T>(opts: {
  getKey: (item: T) => string;
  getOrder: (item: T) => number;
  getDisplayName: (item: T) => string;
  pinned: Set<string>;
}): (a: T, b: T) => number {
  const { getKey, getOrder, getDisplayName, pinned } = opts;
  return (a, b) => {
    const aPinned = pinned.has(getKey(a));
    const bPinned = pinned.has(getKey(b));
    if (aPinned !== bPinned) return aPinned ? -1 : 1;
    const orderA = getOrder(a);
    const orderB = getOrder(b);
    if (orderA !== orderB) return orderA - orderB;
    return getDisplayName(a).localeCompare(getDisplayName(b));
  };
}

function collectionDisplayName(c: ApiCollection): string {
  return c.labels?.plural || c.label || c.name;
}

function singleDisplayName(s: ApiSingle): string {
  // Capitalise the first letter to match `DynamicSingleNav.getDisplayName`.
  const baseLabel = s.label || s.slug;
  if (!baseLabel) return baseLabel;
  return baseLabel.charAt(0).toUpperCase() + baseLabel.slice(1);
}

/**
 * Apply the sidebar's "Collections" section filter + permission filter
 * + pinned/order/name sort to the supplied list. Returns the items in
 * the EXACT order the sidebar would render them.
 */
export function getSidebarCollectionsForLanding(
  items: ApiCollection[],
  deps: CollectionsLandingDeps
): ApiCollection[] {
  const visible = items.filter(c =>
    isInCollectionsSection(c, deps.branding?.plugins)
  );
  const permitted = filterCollectionItems(visible, deps.capabilities);
  const comparator = makeSidebarComparator<ApiCollection>({
    getKey: c => c.name,
    getOrder: c => c.admin?.order ?? 100,
    getDisplayName: collectionDisplayName,
    pinned: deps.pinnedCollections,
  });
  return [...permitted].sort(comparator);
}

/**
 * Apply the sidebar's "Singles" section filter + permission filter +
 * pinned/order/name sort. Returns items in sidebar render order.
 */
export function getSidebarSinglesForLanding(
  items: ApiSingle[],
  deps: SinglesLandingDeps
): ApiSingle[] {
  const visible = items.filter(isInSinglesSection);
  const permitted = filterSingleItems(visible, deps.capabilities);
  const comparator = makeSidebarComparator<ApiSingle>({
    getKey: s => s.slug,
    getOrder: s => s.admin?.order ?? 100,
    getDisplayName: singleDisplayName,
    pinned: deps.pinnedSingles,
  });
  return [...permitted].sort(comparator);
}

/**
 * Pick the first collection the sidebar would render, or null when
 * none are visible. The collection's `name` is the URL slug used by
 * `/admin/collections/{name}`.
 */
export function pickCollectionsLandingTarget(
  items: ApiCollection[],
  deps: CollectionsLandingDeps
): ApiCollection | null {
  const sorted = getSidebarCollectionsForLanding(items, deps);
  return sorted[0] ?? null;
}

/**
 * Pick the first single the sidebar would render, or null when none
 * are visible. The single's `slug` is the URL segment used by
 * `/admin/singles/{slug}`.
 */
export function pickSinglesLandingTarget(
  items: ApiSingle[],
  deps: SinglesLandingDeps
): ApiSingle | null {
  const sorted = getSidebarSinglesForLanding(items, deps);
  return sorted[0] ?? null;
}
