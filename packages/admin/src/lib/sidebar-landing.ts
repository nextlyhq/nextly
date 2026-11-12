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

import { collectionSidebarGroup } from "@admin/lib/content-groups";
import {
  filterCollectionItems,
  filterSingleItems,
} from "@admin/lib/permissions/authorization";
import type { AdminBranding, PluginMetadata } from "@admin/types/branding";
import type { ApiCollection, ApiSingle } from "@admin/types/entities";
import type { AdminCapabilities } from "@admin/types/permissions";

/**
 * What the sidebar's "Collections" section is drawn for. Exported so a view
 * that groups types as the sidebar does (the dashboard's New menu) asks for
 * the same three things and hands them here, rather than keeping its own copy
 * of the placement and order.
 */
export interface CollectionsLandingDeps {
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
 * section.
 *
 * Rules (any of):
 *   - explicit `admin.sidebarGroup === "collections"`
 *   - not a plugin; a `sidebarGroup` of its own shows as a sub-heading inside
 *     the section (`lib/content-groups`), so it never takes a collection out
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
  if (!collection.admin?.isPlugin) return true;
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
 * Returns true if `single` is rendered in the sidebar's "Singles" section:
 * every Single not hidden. Singles do not have plugin-placement overrides,
 * and a `sidebarGroup` they name has no sub-heading under Singles, so it
 * leaves them listed there rather than nowhere: the rail's Singles section
 * counts them the same way.
 */
function isInSinglesSection(single: ApiSingle): boolean {
  return !single.admin?.hidden;
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

/** The name the sidebar shows for a collection, and searches by. */
export function collectionDisplayName(c: ApiCollection): string {
  return c.labels?.plural || c.label || c.name;
}

/** The name the sidebar shows for a Single, and searches by. */
export function singleDisplayName(s: ApiSingle): string {
  const baseLabel = s.label || s.slug;
  if (!baseLabel) return baseLabel;
  return baseLabel.charAt(0).toUpperCase() + baseLabel.slice(1);
}

/**
 * The collections the sidebar lists for a search: those whose shown name
 * contains it, ignoring case. The list draws from this and the Content panel
 * counts matches with it, so a count never disagrees with the list.
 */
export function searchSidebarCollections(
  collections: ApiCollection[],
  search: string
): ApiCollection[] {
  if (!search) return collections;
  const needle = search.toLowerCase();
  return collections.filter(c =>
    collectionDisplayName(c).toLowerCase().includes(needle)
  );
}

/** The Singles the sidebar lists for a search, as for collections. */
export function searchSidebarSingles(
  singles: ApiSingle[],
  search: string
): ApiSingle[] {
  if (!search) return singles;
  const needle = search.toLowerCase();
  return singles.filter(s =>
    singleDisplayName(s).toLowerCase().includes(needle)
  );
}

/**
 * Apply the sidebar's "Collections" section filter + permission filter
 * + pinned/order/name sort to the supplied list. Returns the items in
 * the EXACT order the sidebar would render them: the collections naming no
 * group first, then each `sidebarGroup` in the order its first collection
 * appears, each run sorted pinned/order/name.
 *
 * A group's place is read from the order and name alone, not the pins, so
 * pinning a collection moves it to the top of its own run without moving
 * its group past the others.
 */
export function getSidebarCollectionsForLanding(
  items: readonly ApiCollection[],
  deps: CollectionsLandingDeps
): ApiCollection[] {
  const visible = items.filter(c =>
    isInCollectionsSection(c, deps.branding?.plugins)
  );
  const permitted = filterCollectionItems(visible, deps.capabilities);
  const comparatorWith = (pinned: Set<string>) =>
    makeSidebarComparator<ApiCollection>({
      getKey: c => c.name,
      getOrder: c => c.admin?.order ?? 100,
      getDisplayName: collectionDisplayName,
      pinned,
    });
  // Each group's place: 0 for no group, then 1, 2, ... as groups first
  // appear in the unpinned order.
  const groupPlace = new Map<string, number>();
  for (const collection of [...permitted].sort(comparatorWith(new Set()))) {
    const group = collectionSidebarGroup(collection);
    if (group !== null && !groupPlace.has(group)) {
      groupPlace.set(group, groupPlace.size + 1);
    }
  }
  const placeOf = (c: ApiCollection) =>
    groupPlace.get(collectionSidebarGroup(c) ?? "") ?? 0;
  const comparator = comparatorWith(deps.pinnedCollections);
  return [...permitted].sort(
    (a, b) => placeOf(a) - placeOf(b) || comparator(a, b)
  );
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
