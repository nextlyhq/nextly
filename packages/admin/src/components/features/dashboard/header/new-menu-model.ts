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
const NEW_MENU_RECENT_LIMIT = 3;

/** Past this many creatable types, the menu offers a search. */
const NEW_MENU_SEARCH_AFTER = 10;

const OTHER = "Other";

export interface NewMenuSection {
  /**
   * What the section is, whatever it is called: `collections`, a custom
   * group's slug, a plugin group's name, or `other`, each with its kind. Two
   * sections may share a heading (a custom group and a plugin group both
   * named "Commerce"), so the heading cannot name one.
   */
  id: string;
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

/** Where a type outside the Collections section sits, and its heading. */
interface SectionPlace {
  id: string;
  label: string;
  kind: "custom" | "plugin";
}

/**
 * "Other" collects both a plugin's group-less types and types placed nowhere
 * else, so the menu draws one section for them, not two.
 */
const OTHER_PLACE: SectionPlace = { id: "other", label: OTHER, kind: "plugin" };

/** The section a type outside the Collections section sits in. */
function sectionOf(
  collection: ApiCollection,
  customGroups: readonly { slug: string; name: string }[],
  plugins: readonly PluginMetadata[] | undefined
): SectionPlace {
  const customPlace = (slug: string | undefined): SectionPlace | undefined => {
    const group = slug
      ? customGroups.find(each => each.slug === slug)
      : undefined;
    return group
      ? { id: `custom:${group.slug}`, label: group.name, kind: "custom" }
      : undefined;
  };
  if (!collection.admin?.isPlugin) {
    return customPlace(collection.admin?.sidebarGroup) ?? OTHER_PLACE;
  }
  const custom = customPlace(
    resolveCollectionPlacement(collection.name, plugins)
  );
  if (custom) return custom;
  const group = collection.admin.group;
  if (isCollectionPlacedElsewhere(collection.name, plugins) || !group) {
    return OTHER_PLACE;
  }
  return { id: `plugin:${group}`, label: group, kind: "plugin" };
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
  // Keyed by each section's id, never its heading: two groups of one name
  // are two sections.
  const custom = new Map<string, NewMenuSection>();
  const plugin = new Map<string, NewMenuSection>();
  for (const collection of input.creatable) {
    if (placed.has(collection.name)) continue;
    const { id, label, kind } = sectionOf(
      collection,
      input.customGroups ?? [],
      input.plugins
    );
    const into = kind === "custom" ? custom : plugin;
    const section = into.get(id);
    into.set(id, {
      id,
      label,
      collections: [...(section?.collections ?? []), collection],
    });
  }
  const grouped = (groups: Map<string, NewMenuSection>) =>
    [...groups.values()]
      .sort(
        (a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id)
      )
      .map(section => ({
        ...section,
        collections: [...section.collections].sort(byOrderThenName),
      }));

  const sections: NewMenuSection[] = [
    ...(inCollections.length > 0
      ? [
          {
            id: "collections",
            label: "Collections",
            collections: inCollections,
          },
        ]
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
