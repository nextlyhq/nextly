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
      /**
       * `"above-form"` when the section is drawn above the fields, not in the
       * panel, where the editor is too narrow to keep the panel beside them.
       */
      narrow?: "above-form";
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
 * Whether a declared section applies to `entry` of collection `slug`: it is
 * not narrowed to other collections, and its rule, if any, holds for the
 * entry as the reader's read returned it.
 */
function appliesTo(
  part: DeclaredPanelSection,
  slug: string,
  entry: unknown
): boolean {
  if (part.collections !== undefined && !part.collections.includes(slug)) {
    return false;
  }
  return part.visibleWhen === undefined || rowMatches(part.visibleWhen, entry);
}

/**
 * The document panel's parts for one entry of collection `slug`, in the order
 * the server placed them: the built-in sections, less any a contribution
 * replaces, with the side panel sections plugins declared at the
 * `collection.edit` place among them. A section narrowed to other
 * collections, or whose rule does not hold for `entry` as the reader's read
 * returned it, is left out; where it replaces a built-in section, that
 * section is drawn in its place instead, as the server answers a replacement
 * the reader may not see.
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
    if (!appliesTo(part, slug, entry)) {
      // The server sent the replacement in the built-in's place, so leaving
      // both out would take the built-in away from every entry the
      // replacement does not apply to.
      return part.replaces === undefined
        ? []
        : [{ kind: "builtIn", name: part.replaces }];
    }
    return [
      {
        kind: "section",
        id: part.id,
        plugin: part.plugin,
        title: part.label,
        component: part.component,
        ...(part.narrow === undefined ? {} : { narrow: part.narrow }),
      },
    ];
  });
}

/** A placed section, as `panelOrderFor` answers one. */
export type PlacedPanelSection = Extract<PanelOrderEntry, { kind: "section" }>;

/** Where the panel's parts go on an editor of one width. */
interface PanelPlacement {
  /** The panel's parts, in the server's order; `undefined` as given. */
  panel: PanelOrderEntry[] | undefined;
  /** The sections drawn above the fields instead, in the same order. */
  aboveForm: PlacedPanelSection[];
}

/**
 * Splits the panel's parts for an editor that is `narrow` (too narrow to keep
 * the panel beside the fields, where it opens only when asked for): a section
 * declared `narrow: "above-form"` moves above the fields and out of the
 * panel, so it is on screen without opening the panel and is drawn once. On
 * a wider editor, or when nothing asks to move, the order is kept whole.
 */
export function placePanelParts(
  order: PanelOrderEntry[] | undefined,
  narrow: boolean
): PanelPlacement {
  if (order === undefined || !narrow) return { panel: order, aboveForm: [] };
  const aboveForm = order.filter(
    (part): part is PlacedPanelSection =>
      part.kind === "section" && part.narrow === "above-form"
  );
  if (aboveForm.length === 0) return { panel: order, aboveForm };
  const moved = new Set<PanelOrderEntry>(aboveForm);
  return { panel: order.filter(part => !moved.has(part)), aboveForm };
}
