/**
 * What the dashboard header's New button offers: the type its main part
 * creates, and the menu behind its caret.
 *
 * The main part creates the reader's most recent type they may still create,
 * else the first creatable type in sidebar order. The menu lists up to three
 * recent types, then every creatable type grouped as the sidebar groups it, so
 * a type is found where the reader already looks for it: the Collections
 * section in the sidebar's own order (pins included), then each custom group,
 * then each plugin's heading. A type the sidebar places nowhere among those is
 * listed under "Other" rather than dropped, because the create endpoint, not
 * this menu, decides what may be created.
 *
 * @module components/features/dashboard/header/new-menu-model
 */
import {
  isCollectionPlacedElsewhere,
  resolveCollectionPlacement,
} from "@admin/lib/plugins/collection-placement";
import { collectionDisplayName } from "@admin/lib/sidebar-landing";
import type { PluginMetadata } from "@admin/types/branding";
import type { ApiCollection } from "@admin/types/entities";

/** At most this many recent types lead the menu. */
export const NEW_MENU_RECENT_LIMIT = 3;

/** Past this many creatable types, the menu offers a search. */
export const NEW_MENU_SEARCH_AFTER = 10;

const OTHER = "Other";

export interface NewMenuSection {
  label: string;
  collections: readonly ApiCollection[];
}

export interface NewMenu {
  /** What the main part creates; null when nothing is creatable. */
  primary: ApiCollection | null;
  recent: readonly ApiCollection[];
  sections: readonly NewMenuSection[];
  searchable: boolean;
}

export interface NewMenuInput {
  /** Every type the reader may create, in any order. */
  creatable: readonly ApiCollection[];
  /** The reader's recent types' slugs, the most recent first. */
  recentSlugs: readonly string[];
  /** The sidebar's Collections section, in the order it draws it. */
  sidebarCollections: readonly ApiCollection[];
  customGroups?: readonly { slug: string; name: string }[];
  plugins?: readonly PluginMetadata[];
}

/** Order then shown name: how both the custom-group and plugin navs sort. */
function byOrderThenName(a: ApiCollection, b: ApiCollection): number {
  const order = (a.admin?.order ?? 100) - (b.admin?.order ?? 100);
  return order !== 0
    ? order
    : collectionDisplayName(a).localeCompare(collectionDisplayName(b));
}

/** The heading a type outside the Collections section sits under. */
function sectionOf(
  collection: ApiCollection,
  customGroups: readonly { slug: string; name: string }[],
  plugins: readonly PluginMetadata[] | undefined
): { label: string; kind: "custom" | "plugin" | "other" } {
  const groupNamed = (slug: string | undefined) =>
    slug ? customGroups.find(group => group.slug === slug) : undefined;
  if (collection.admin?.isPlugin) {
    const custom = groupNamed(
      resolveCollectionPlacement(collection.name, plugins)
    );
    if (custom) return { label: custom.name, kind: "custom" };
    if (!isCollectionPlacedElsewhere(collection.name, plugins)) {
      return { label: collection.admin.group || OTHER, kind: "plugin" };
    }
    return { label: OTHER, kind: "other" };
  }
  const custom = groupNamed(collection.admin?.sidebarGroup);
  return custom
    ? { label: custom.name, kind: "custom" }
    : { label: OTHER, kind: "other" };
}

export function newMenu(input: NewMenuInput): NewMenu {
  const creatable = new Map(input.creatable.map(c => [c.name, c]));
  const recent = input.recentSlugs
    .flatMap(slug => creatable.get(slug) ?? [])
    .slice(0, NEW_MENU_RECENT_LIMIT);

  const inCollections = input.sidebarCollections.flatMap(
    c => creatable.get(c.name) ?? []
  );
  const placed = new Set(inCollections.map(c => c.name));
  const custom = new Map<string, ApiCollection[]>();
  const plugin = new Map<string, ApiCollection[]>();
  for (const collection of input.creatable) {
    if (placed.has(collection.name)) continue;
    const { label, kind } = sectionOf(
      collection,
      input.customGroups ?? [],
      input.plugins
    );
    // "Other" collects both a plugin's group-less types and types placed
    // nowhere else, so the menu draws one heading for them, not two.
    const into = kind === "custom" ? custom : plugin;
    into.set(label, [...(into.get(label) ?? []), collection]);
  }
  const grouped = (groups: Map<string, ApiCollection[]>) =>
    [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, collections]) => ({
        label,
        collections: [...collections].sort(byOrderThenName),
      }));

  const sections: NewMenuSection[] = [
    ...(inCollections.length > 0
      ? [{ label: "Collections", collections: inCollections }]
      : []),
    ...grouped(custom),
    ...grouped(plugin),
  ];
  return {
    primary: recent[0] ?? sections[0]?.collections[0] ?? null,
    recent,
    sections,
    searchable: creatable.size > NEW_MENU_SEARCH_AFTER,
  };
}
