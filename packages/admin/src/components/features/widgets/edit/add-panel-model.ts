/**
 * What the add panel lists, decided once from what the layout read says.
 *
 * The rows, their groups, what each row's button does, and which rows a search
 * keeps are all worked out here, from three inputs: the reader's draft (what is
 * placed, and what was removed), the server's offer (which widgets may be
 * added now) and each widget's facts (its group, sub-group, description,
 * category, widths and rank, all core's). Nothing here decides a group or an
 * order of its own: the panel lists what core assigns, in the order core ranks.
 *
 * @module components/features/widgets/edit/add-panel-model
 */

import type {
  AddPanelGroup,
  DashboardWidget,
  WidgetPlacement,
  WidgetWidthFacts,
} from "@admin/types/dashboard/widgets";

import { WIDTH_NAMES } from "../sizes";

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
 * Whether the Content group is shown. Off until the per-collection content widgets exist: the
 * cards core generates per collection today are retired, and listing them would offer what is
 * about to go.
 */
export const SHOW_CONTENT_GROUP = false;

/** What a row's control does, or that there is nothing to do. */
export type AddPanelAction =
  | { kind: "add"; widgetId: string }
  | { kind: "add-another"; widgetId: string }
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
  /** "⅓ to Full wide", or the one width's name. Absent for a removed card. */
  widths?: string;
  /** How many of this widget's cards are on the dashboard now. */
  placed: number;
  action: AddPanelAction;
}

/** What the widths a widget allows read as: its one width's name, or the range. */
function widthsLabel(facts: WidgetWidthFacts | undefined): string | undefined {
  const allowed = facts?.allowedWidths ?? [];
  if (allowed.length === 0) return undefined;
  if (allowed.length === 1) return WIDTH_NAMES[allowed[0]].name;
  const first = WIDTH_NAMES[allowed[0]].fraction;
  const last = WIDTH_NAMES[allowed[allowed.length - 1]].fraction;
  return `${first} to ${last} wide`;
}

/** The line a removed card's row says, which is also what search reads for it. */
export const REMOVED_ROW_DESCRIPTION =
  "Comes back where it was, with its width and settings.";

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
  facts: WidgetWidthFacts,
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
 * Every row the panel could show, before any search: the reader's removed cards first, then each
 * widget core groups, in core's rank.
 *
 * Only widgets this admin can draw are listed (a declaration is needed for its title): a row for
 * one it cannot draw would add a card the grid then skips.
 */
export function addPanelRows(input: {
  placements: readonly WidgetPlacement[];
  offered: readonly string[];
  widgets: Readonly<Record<string, WidgetWidthFacts>>;
  byId: ReadonlyMap<string, DashboardWidget>;
}): AddPanelRow[] {
  const { placements, widgets, byId } = input;
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
      },
    ];
  });

  const grouped = Object.entries(widgets)
    .filter(
      ([widgetId, facts]) =>
        facts.group !== undefined &&
        (SHOW_CONTENT_GROUP || facts.group !== "content") &&
        byId.has(widgetId)
    )
    .sort(([, a], [, b]) => (a.rank ?? 0) - (b.rank ?? 0));

  const rows = grouped.flatMap(([widgetId, facts]) => {
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
    const widget = byId.get(widgetId);
    return [
      {
        key: widgetId,
        section: facts.group as AddPanelGroup,
        ...(facts.subgroup === undefined ? {} : { subgroup: facts.subgroup }),
        name: widget?.title ?? widgetId,
        ...(facts.description === undefined
          ? {}
          : { description: facts.description }),
        ...(facts.category === undefined ? {} : { category: facts.category }),
        ...(facts.sketch === undefined ? {} : { sketch: facts.sketch }),
        ...(widthsLabel(facts) === undefined
          ? {}
          : { widths: widthsLabel(facts) }),
        placed,
        action,
      },
    ];
  });

  return [...removed, ...rows];
}

/** A section's heading, which search reads too. */
function sectionLabel(section: AddPanelSection): string {
  return ADD_PANEL_SECTIONS.find(entry => entry.id === section)?.label ?? "";
}

/**
 * The rows a search keeps: those whose name, description, category, group or sub-group contains
 * the query, ignoring case. An empty query keeps them all.
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
