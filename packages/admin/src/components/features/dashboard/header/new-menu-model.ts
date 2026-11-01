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
import {
  type CollectionsLandingDeps,
  collectionDisplayName,
  getSidebarCollectionsForLanding,
} from "@admin/lib/sidebar-landing";
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

/**
 * What the sidebar's Collections section is drawn for (the branding, whose
 * custom groups and plugins also place every other type, the reader's
 * capabilities and their pins), not the list the sidebar drew from it. That
 * list is one page of collections, so a creatable type past it would leave
 * the Collections section; the section is derived here from every creatable
 * type, by the sidebar's own placement and order.
 */
export interface NewMenuInput extends CollectionsLandingDeps {
  /** Every type the reader may create, in any order. */
  creatable: readonly ApiCollection[];
  /** The reader's recent types' slugs, the most recent first. */
  recentSlugs: readonly string[];
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
 * "Other" collects a plugin's group-less types, a plugin's types grouped as
 * "Other" and types placed nowhere else, so the menu draws one section for
 * them, not two.
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
  // A missing heading is "Other", as the plugin nav names it, so a group-less
  // type and one grouped as "Other" share the one "Other" section.
  const group = collection.admin.group || OTHER;
  if (
    isCollectionPlacedElsewhere(collection.name, plugins) ||
    group === OTHER
  ) {
    return OTHER_PLACE;
  }
  return { id: `plugin:${group}`, label: group, kind: "plugin" };
}

export function newMenu(input: NewMenuInput): NewMenu {
  const creatable = new Map(input.creatable.map(c => [c.name, c]));
  const recent = input.recentSlugs
    .flatMap(slug => creatable.get(slug) ?? [])
    .slice(0, NEW_MENU_RECENT_LIMIT);

  // Every creatable type, never the sidebar's one page: the section's members
  // and order come from the helper that draws the sidebar's own.
  const inCollections = getSidebarCollectionsForLanding(input.creatable, input);
  const placed = new Set(inCollections.map(c => c.name));
  // Keyed by each section's id, never its heading: two groups of one name
  // are two sections.
  const custom = new Map<string, NewMenuSection>();
  const plugin = new Map<string, NewMenuSection>();
  for (const collection of input.creatable) {
    if (placed.has(collection.name)) continue;
    const { id, label, kind } = sectionOf(
      collection,
      input.branding?.customGroups ?? [],
      input.branding?.plugins
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
