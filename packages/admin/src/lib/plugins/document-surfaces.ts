/**
 * What plugins change on one collection's document screen: the built-in
 * actions they hide or replace, and the sections they add to its panel, by
 * slug (`views[slug].panelSections`) or as a side panel section declared at
 * the `collection.edit` place (`panelOrderFor`).
 *
 * Read from `branding.plugins[]`, where admin-meta publishes both on the slug
 * the admin routes (the plugin's rename map already applied), for enabled
 * plugins only. The server refuses two plugins overriding one action on one
 * collection at boot, so at most one override per action arrives; the first
 * is kept should that ever not hold, rather than letting the order of a later
 * one decide.
 *
 * @module lib/plugins/document-surfaces
 */
import {
  rowMatches,
  type AdminContributionsMeta,
  type DeliveredAdminContribution,
  type OverridableDocumentAction,
  type PluginDocumentActionOverride,
} from "nextly/config";

import type { PluginMetadata } from "@admin/types/branding";

/** One panel section as the document panel draws it. */
export interface PluginPanelSectionEntry {
  /** The contributing plugin, for a stable key and its error boundary. */
  plugin: string;
  title: string;
  component: string;
  /**
   * Whether its component is still on its way, so the panel draws the
   * section as loading rather than blank. Absent, it is not.
   */
  loading?: boolean;
}

/** What plugins change on one collection's document screen. */
export interface CollectionDocumentSurfaces {
  /** Each overridden action's override, by action. */
  actions: Partial<
    Record<OverridableDocumentAction, PluginDocumentActionOverride>
  >;
  /** The sections to draw after Details, in plugin then declaration order. */
  sections: PluginPanelSectionEntry[];
}

/** The surfaces `plugins` declare on the collection `slug`. */
export function documentSurfacesFor(
  plugins: readonly PluginMetadata[] | undefined,
  slug: string
): CollectionDocumentSurfaces {
  const actions: CollectionDocumentSurfaces["actions"] = {};
  const sections: PluginPanelSectionEntry[] = [];
  for (const plugin of plugins ?? []) {
    for (const each of plugin.documentActions ?? []) {
      if (each.slug !== slug || actions[each.action] !== undefined) continue;
      actions[each.action] = each.override;
    }
    for (const section of plugin.panelSections ?? []) {
      if (section.slug !== slug) continue;
      sections.push({
        plugin: plugin.name,
        title: section.title,
        component: section.component,
      });
    }
  }
  return { actions, sections };
}

/** A side panel section declared at the `collection.edit` place. */
type DeclaredPanelSection = Extract<
  DeliveredAdminContribution,
  { kind: "sidebarSection" }
>;

/** One part of the document panel, in the order the panel draws them. */
export type PanelOrderEntry =
  /** One of the panel's own sections: status, publishing, language, details. */
  | { kind: "builtIn"; name: string }
  /** A plugin's section, which the panel frames and the plugin fills. */
  | {
      kind: "section";
      /** The contribution's id, unique across plugins. */
      id: string;
      plugin: string;
      title: string;
      component: string;
    };

/** Whether a delivered entry is a declared panel section, not a built-in. */
function isDeclaredSection(entry: unknown): entry is DeclaredPanelSection {
  return (
    typeof entry === "object" &&
    entry !== null &&
    "kind" in entry &&
    entry.kind === "sidebarSection"
  );
}

/**
 * The document panel's parts for one entry of collection `slug`, in the order
 * the server placed them: the built-in sections, less any a contribution
 * replaces, with the side panel sections plugins declared at the
 * `collection.edit` place among them. A section narrowed to other
 * collections, or whose rule does not hold for `entry` as the reader's read
 * returned it, is left out.
 *
 * `undefined` when the place has no list for this reader, so the panel draws
 * its own sections in their usual order.
 */
export function panelOrderFor(
  contributions: AdminContributionsMeta | undefined,
  slug: string,
  entry: unknown
): PanelOrderEntry[] | undefined {
  const delivered = contributions?.["collection.edit"]?.sidebarSection;
  if (delivered === undefined) return undefined;
  return delivered.flatMap((part): PanelOrderEntry[] => {
    if ("builtIn" in part) return [{ kind: "builtIn", name: part.builtIn }];
    if (!isDeclaredSection(part)) return [];
    if (part.collections !== undefined && !part.collections.includes(slug)) {
      return [];
    }
    if (
      part.visibleWhen !== undefined &&
      !rowMatches(part.visibleWhen, entry)
    ) {
      return [];
    }
    return [
      {
        kind: "section",
        id: part.id,
        plugin: part.plugin,
        title: part.label,
        component: part.component,
      },
    ];
  });
}
