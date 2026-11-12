/**
 * The groups a collection is listed under: its own `admin.sidebarGroup`,
 * shown as a sub-heading inside Collections.
 *
 * Collections that name no group come first, then each group in the order its
 * first collection appears. The list handed in is already in the sidebar's
 * order (`getSidebarCollectionsForLanding`), so this only partitions it, and
 * a group's place follows from that order rather than from a second sort.
 *
 * @module lib/content-groups
 */
import type { AdminBranding } from "@admin/types/branding";
import type { ApiCollection } from "@admin/types/entities";

/** The sections the sidebar draws itself: naming one is naming no group. */
const BUILT_IN_SECTIONS: ReadonlySet<string> = new Set([
  "collections",
  "singles",
]);

/**
 * The group a collection names as its sub-heading, or null when it names
 * none of its own (no `sidebarGroup`, or one of the built-in sections).
 */
export function collectionSidebarGroup(
  collection: ApiCollection
): string | null {
  const group = collection.admin?.sidebarGroup;
  return group && !BUILT_IN_SECTIONS.has(group) ? group : null;
}

/**
 * A group's name as shown: the name the site gave it in its custom groups,
 * else its slug with a capital first letter.
 */
function sidebarGroupName(
  slug: string,
  customGroups: AdminBranding["customGroups"]
): string {
  const named = customGroups?.find(group => group.slug === slug)?.name;
  return named ?? slug.charAt(0).toUpperCase() + slug.slice(1);
}

/** One run of collections under a sub-heading, or under none. */
export interface CollectionGroup {
  /** The group's slug, or null for the collections that name no group. */
  slug: string | null;
  /** The sub-heading's text; empty for the collections that name no group. */
  name: string;
  items: ApiCollection[];
}

/**
 * The collections in the groups they are listed under, in the order given:
 * the ungrouped run first, then each group as its first collection appears.
 * A run with no collections is left out.
 */
export function groupCollections(
  collections: readonly ApiCollection[],
  customGroups: AdminBranding["customGroups"]
): CollectionGroup[] {
  const ungrouped: CollectionGroup = { slug: null, name: "", items: [] };
  const groups = new Map<string, CollectionGroup>();
  for (const collection of collections) {
    const slug = collectionSidebarGroup(collection);
    if (slug === null) {
      ungrouped.items.push(collection);
      continue;
    }
    let group = groups.get(slug);
    if (group === undefined) {
      group = { slug, name: sidebarGroupName(slug, customGroups), items: [] };
      groups.set(slug, group);
    }
    group.items.push(collection);
  }
  return [ungrouped, ...groups.values()].filter(g => g.items.length > 0);
}
