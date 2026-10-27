/**
 * What the add panel lists, decided once from what the layout read says.
 *
 * The rows, their groups, what each row's button does, and which rows a search
 * keeps are all worked out here, from three inputs: the reader's draft (what is
 * placed, and what was removed), the server's offer (which widgets may be
 * added now) and each widget's facts (its group, sub-group, description,
 * category and rank, all core's, and its sizes, from its declaration). Nothing
 * here decides a group or an
 * order of its own: the panel lists what core assigns, in the order core ranks.
 *
 * @module components/features/widgets/edit/add-panel-model
 */

import type { PublishedContentSource } from "nextly/config";

import type {
  AddPanelGroup,
  DashboardWidget,
  WidgetLayoutFacts,
  WidgetPlacement,
} from "@admin/types/dashboard/widgets";

import { columnsName } from "../sizes";
import { askableWith } from "../widget-as-asked";

/** A group the panel shows: core's four, and the reader's own removed cards first. */
export type AddPanelSection = "removed" | AddPanelGroup;

/** The panel's groups in order, each with its heading and, for some, a line under it. */
export const ADD_PANEL_SECTIONS: ReadonlyArray<{
  id: AddPanelSection;
  label: string;
  note?: string;
}> = [
  { id: "removed", label: "Removed from your dashboard" },
  { id: "overview", label: "Overview" },
  {
    id: "content",
    label: "Content",
    note: "By collection. Each card starts on the collection you add it from.",
  },
  { id: "team", label: "Team" },
  { id: "plugins", label: "Plugins", note: "By plugin." },
];

/**
 * Whether the Content group is shown. On: core groups only widgets offered per collection there,
 * so the group lists Count for each collection the reader may read, and each further content
 * widget joins it as core offers it.
 */
export const SHOW_CONTENT_GROUP = true;

/** What a row's control does, or that there is nothing to do. */
export type AddPanelAction =
  | { kind: "add"; widgetId: string; settings?: Record<string, unknown> }
  | {
      kind: "add-another";
      widgetId: string;
      settings?: Record<string, unknown>;
    }
  | { kind: "add-back"; placementId: string }
  | { kind: "on-dashboard" };

export interface AddPanelRow {
  /** Stable across renders: a removed card's placement, or the widget's id. */
  key: string;
  section: AddPanelSection;
  /** The plugin a Plugins row comes from, or the collection a Content row reads. */
  subgroup?: string;
  name: string;
  /** The line under the name, which search reads too. */
  description?: string;
  /** The declaration's category: searched, and shown as a label. */
  category?: string;
  /** Which sketch draws the row. */
  sketch?: string;
  /** "4 to 12 columns wide", or the one width's. Absent for a removed card. */
  widths?: string;
  /** How many of this widget's cards are on the dashboard now. */
  placed: number;
  action: AddPanelAction;
  /**
   * Text search reads and the panel does not draw. A removed card's row is the only way back to
   * a one-card widget, so it carries what that widget's own row would be found by (its
   * description, category, group and plugin) while showing the put-back line.
   */
  searchAlso?: readonly string[];
}

/** What the widths a widget allows read as: its one width, or the range, in columns. */
function widthsLabel(widget: DashboardWidget | undefined): string | undefined {
  if (widget === undefined) return undefined;
  const { min, max } = widget.size;
  if (min.w === max.w) return `${columnsName(min.w)} wide`;
  return `${min.w} to ${columnsName(max.w)} wide`;
}

/** The line a removed card's row says. Search reads it too, beside the widget's own facts. */
export const REMOVED_ROW_DESCRIPTION =
  "Comes back where it was, with its size and settings.";

/**
 * A widget row's button, or none.
 *
 * - One card only, and it is placed: shown as on the dashboard, not addable.
 * - One card only, and it was removed: no row here. Its card is listed under Removed, where Add
 *   back restores it; a second row would offer the same card twice, and a fresh Add would be a
 *   second card the server refuses.
 * - Offered now: Add, or Add another once one is placed.
 * - Otherwise the server does not offer it here, and it has no row.
 */
function widgetAction(
  widgetId: string,
  facts: WidgetLayoutFacts,
  placed: number,
  removedPlacement: WidgetPlacement | undefined,
  offered: ReadonlySet<string>
): AddPanelAction | undefined {
  if (!facts.allowsSeveral && placed > 0) return { kind: "on-dashboard" };
  if (!facts.allowsSeveral && removedPlacement !== undefined) return undefined;
  if (!offered.has(widgetId)) return undefined;
  return placed > 0
    ? { kind: "add-another", widgetId }
    : { kind: "add", widgetId };
}

/**
 * What a widget's own row is found by, beyond its name: the facts core states for it, and its
 * group's heading. Empty for a widget core says nothing about.
 */
function searchableFacts(facts: WidgetLayoutFacts | undefined): string[] {
  if (facts === undefined) return [];
  return [
    facts.description,
    facts.category,
    facts.group === undefined ? undefined : sectionLabel(facts.group),
    facts.subgroup,
  ].filter((text): text is string => text !== undefined);
}

/**
 * Every row the panel could show, before any search: the reader's removed cards first, then each
 * widget core groups, in core's rank.
 *
 * Only widgets this admin can draw are listed (a declaration is needed for its title): a row for
 * one it cannot draw would add a card the grid then skips.
 */
export function addPanelRows(input: {
  placements: readonly WidgetPlacement[];
  offered: readonly string[];
  widgets: Readonly<Record<string, WidgetLayoutFacts>>;
  byId: ReadonlyMap<string, DashboardWidget>;
  /**
   * The collections the reader may read, as the server published them: a widget offered per
   * collection gets one row for each.
   */
  collections?: readonly PublishedContentSource[];
  /** Whether the Content group is shown; absent, `SHOW_CONTENT_GROUP` decides. */
  showContent?: boolean;
}): AddPanelRow[] {
  const { placements, widgets, byId } = input;
  const showContent = input.showContent ?? SHOW_CONTENT_GROUP;
  const offered = new Set(input.offered);

  const removed: AddPanelRow[] = placements.flatMap(placement => {
    const widget = byId.get(placement.widgetId);
    if (!placement.removed || widget === undefined) return [];
    return [
      {
        key: `removed:${placement.id}`,
        section: "removed" as const,
        name: widget.title,
        description: REMOVED_ROW_DESCRIPTION,
        placed: 0,
        action: { kind: "add-back" as const, placementId: placement.id },
        searchAlso: searchableFacts(widgets[placement.widgetId]),
      },
    ];
  });

  const grouped = Object.entries(widgets)
    .filter(
      ([widgetId, facts]) =>
        facts.group !== undefined &&
        (showContent || facts.group !== "content") &&
        byId.has(widgetId)
    )
    .sort(([, a], [, b]) => (a.rank ?? 0) - (b.rank ?? 0));

  const rows = grouped.flatMap(([widgetId, facts]) => {
    if (facts.perCollection === true) {
      return perCollectionRows(
        widgetId,
        facts,
        byId.get(widgetId),
        placements,
        input.collections ?? [],
        offered
      );
    }
    const mine = placements.filter(p => p.widgetId === widgetId);
    const placed = mine.filter(p => !p.removed).length;
    const action = widgetAction(
      widgetId,
      facts,
      placed,
      mine.find(p => p.removed),
      offered
    );
    if (action === undefined) return [];
    return [widgetRowOf(widgetId, facts, byId.get(widgetId), placed, action)];
  });

  return [...removed, ...rows];
}

/**
 * What a widget's row says about the widget, whichever row it is: its name, the description,
 * category and sketch core states for it, and the widths its declaration allows, each shown and
 * searched alike on every row.
 */
function rowFacts(
  widgetId: string,
  facts: WidgetLayoutFacts,
  widget: DashboardWidget | undefined
): Pick<
  AddPanelRow,
  "name" | "description" | "category" | "sketch" | "widths"
> {
  const widths = widthsLabel(widget);
  return {
    name: widget?.title ?? widgetId,
    ...(facts.description === undefined
      ? {}
      : { description: facts.description }),
    ...(facts.category === undefined ? {} : { category: facts.category }),
    ...(facts.sketch === undefined ? {} : { sketch: facts.sketch }),
    ...(widths === undefined ? {} : { widths }),
  };
}

/** One widget's row in its add-panel group, carrying only the facts it states. */
function widgetRowOf(
  widgetId: string,
  facts: WidgetLayoutFacts,
  widget: DashboardWidget | undefined,
  placed: number,
  action: AddPanelAction
): AddPanelRow {
  return {
    key: widgetId,
    section: facts.group as AddPanelGroup,
    ...(facts.subgroup === undefined ? {} : { subgroup: facts.subgroup }),
    ...rowFacts(widgetId, facts, widget),
    placed,
    action,
  };
}

/**
 * A widget offered per collection, as one row for each collection the reader may read and its
 * card could be asked of: each adds a card set to that collection, and counts that collection's
 * cards already placed. A collection the card would ask nothing of (a Breakdown where nothing
 * divides the entries) gets no row, by the rule that draws such a card as not available.
 */
function perCollectionRows(
  widgetId: string,
  facts: WidgetLayoutFacts,
  widget: DashboardWidget | undefined,
  placements: readonly WidgetPlacement[],
  collections: readonly PublishedContentSource[],
  offered: ReadonlySet<string>
): AddPanelRow[] {
  const setting = widget?.settings?.find(s => s.type === "collection")?.name;
  if (widget === undefined || setting === undefined || !offered.has(widgetId)) {
    return [];
  }
  const askable = collections.filter(({ collection }) =>
    askableWith(widget, { [setting]: collection }, collections)
  );
  return askable.map(({ collection, label }) => {
    const placed = placements.filter(
      p =>
        p.widgetId === widgetId &&
        !p.removed &&
        p.config?.[setting] === collection
    ).length;
    const settings = { [setting]: collection };
    return {
      key: `${widgetId}:${collection}`,
      section: "content" as const,
      subgroup: label,
      ...rowFacts(widgetId, facts, widget),
      placed,
      action:
        placed > 0
          ? { kind: "add-another" as const, widgetId, settings }
          : { kind: "add" as const, widgetId, settings },
    };
  });
}

/** A section's heading, which search reads too. */
function sectionLabel(section: AddPanelSection): string {
  return ADD_PANEL_SECTIONS.find(entry => entry.id === section)?.label ?? "";
}

/**
 * The rows a search keeps: those whose name, description, category, group or sub-group contains
 * the query, ignoring case, or whose `searchAlso` does. An empty query keeps them all.
 */
export function searchAddPanel(
  rows: readonly AddPanelRow[],
  query: string
): AddPanelRow[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [...rows];
  return rows.filter(row =>
    [
      row.name,
      row.description,
      row.category,
      sectionLabel(row.section),
      row.subgroup,
      ...(row.searchAlso ?? []),
    ].some(text => text?.toLowerCase().includes(needle))
  );
}

/** What the count line says, and what is announced when it changes. */
export function addPanelCount(found: number, query: string): string {
  const trimmed = query.trim();
  const noun = found === 1 ? "widget" : "widgets";
  if (trimmed === "") return `${found} ${noun}`;
  return `${found} ${found === 1 ? "result" : "results"} for “${trimmed}”`;
}

/** One group as drawn: its rows outside any sub-group, then each sub-group's. */
export interface AddPanelGroupView {
  section: (typeof ADD_PANEL_SECTIONS)[number];
  rows: AddPanelRow[];
  subgroups: Array<{ name: string; rows: AddPanelRow[] }>;
}

/** The rows a search kept, as the panel draws them: by group, in order, and by sub-group. */
export function addPanelGroups(
  rows: readonly AddPanelRow[]
): AddPanelGroupView[] {
  return ADD_PANEL_SECTIONS.flatMap(section => {
    const inGroup = rows.filter(row => row.section === section.id);
    if (inGroup.length === 0) return [];
    const names = [
      ...new Set(inGroup.flatMap(row => (row.subgroup ? [row.subgroup] : []))),
    ];
    return [
      {
        section,
        rows: inGroup.filter(row => row.subgroup === undefined),
        subgroups: names.map(name => ({
          name,
          rows: inGroup.filter(row => row.subgroup === name),
        })),
      },
    ];
  });
}
