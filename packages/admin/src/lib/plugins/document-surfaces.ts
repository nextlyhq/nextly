/**
 * What plugins change on one collection's document screen: the built-in
 * actions they hide or replace, and the sections they add to its panel.
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
import type {
  OverridableDocumentAction,
  PluginDocumentActionOverride,
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
