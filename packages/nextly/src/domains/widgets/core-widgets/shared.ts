/**
 * The settings several of core's cards share, and the prefix core's components resolve under.
 *
 * @module domains/widgets/core-widgets/shared
 */

import {
  DENSITY_OPTIONS,
  setting,
  type SettingDeclaration,
  type WidgetFilter,
} from "../declaration/setting-builders";
import type { WidgetSetting } from "../definition";
import { MAX_WIDGET_ROWS } from "../query-limits";
import { WIDGET_TABS, type WidgetTab } from "../sources";

/**
 * A list card's "Number of items", from 1 to the most rows a card draws
 * (`MAX_WIDGET_ROWS`), so the editor never offers rows the card would not draw.
 * Keyed `limit` by every card that declares it, the name the knob that sets a
 * query's rows reads.
 */
export const LIST_ITEMS = setting.number({
  label: "Number of items",
  defaultValue: 5,
  min: 1,
  max: MAX_WIDGET_ROWS,
});

/**
 * Recent activity's "Number of items": the one offer every list card makes,
 * under the name `limit`, so it sets the card's query.
 *
 * Held as the public `WidgetSetting` rather than written into the list: the
 * builder's own type carries a value brand only declarations read, which the
 * published list of core's widgets has no name for.
 */
export const RECENT_ACTIVITY_ITEMS: WidgetSetting = {
  name: "limit",
  ...LIST_ITEMS,
};

/**
 * The most a note holds, in characters (code points). A note is the reader's
 * own text in their layout row, which is bounded as a whole
 * (`MAX_LAYOUT_BYTES`), so one note cannot take the whole of it.
 */
const NOTE_MAX_LENGTH = 2000;

/**
 * A note's text: Markdown over several lines, empty until its reader writes it.
 * A setting of the note's declaration, which names it by its key (`text`).
 */
export const NOTE_TEXT = setting.textarea({
  label: "Note",
  defaultValue: "",
  maxLength: NOTE_MAX_LENGTH,
});

/**
 * Where every list card's Density is drawn: folded under Advanced in the
 * card's settings panel, since how tightly rows are spaced is a preference
 * few readers change. One value for both forms of the setting below.
 */
const DENSITY_SECTION = "advanced";

/**
 * Every list card's Density, as a declaration takes it: default or compact
 * rows, default unless chosen, one option for every density the admin sizes
 * rows by (`DENSITY_OPTIONS`), so core's list cards and a plugin's offer the
 * same choice. Keyed `density` by every card that declares it, the name the
 * admin reads to decide how many rows fit.
 */
export const LIST_DENSITY_SETTING = setting.select({
  label: "Density",
  options: DENSITY_OPTIONS,
  defaultValue: "default",
  section: DENSITY_SECTION,
});

/**
 * The same Density, as a definition lists it. Written out rather than spread
 * from the declaration: a builder's type does not carry the options a select
 * definition must state.
 */
export const LIST_DENSITY: WidgetSetting = {
  name: "density",
  label: LIST_DENSITY_SETTING.label,
  type: "select",
  defaultValue: "default",
  options: [...DENSITY_OPTIONS],
  section: DENSITY_SECTION,
};

/** The card's Collection: the collection it reads, set from the group it is added from. */
export const CARD_COLLECTION = setting.collection({ label: "Collection" });

/**
 * The card's Filter over its Collection: the list view's conditions, none
 * until its reader sets some. Starting at no conditions rather than at none
 * at all, so a card whose reader set none is loaded with every entry, never
 * asked for a filter first; a Filter of no conditions adds nothing to a query.
 *
 * 🔴 Its type is written, not inferred: inferred, the spread copies the
 * builder's private value brand into a type the published declaration cannot
 * name (TS4023). Written over the builders' own exported `SettingDeclaration`,
 * the published type says exactly what the setting is.
 */
export const CARD_FILTER: SettingDeclaration<
  WidgetFilter,
  "filter",
  "collection"
> & { readonly defaultValue: WidgetFilter } = {
  ...setting.filter({ of: "collection", label: "Filter" }),
  defaultValue: {},
};

/**
 * The card's Collection, read as titled rows: each row is asked by the
 * collection's own title field, its status where it has one, and when it was
 * updated. Written as a type, rather than left to the spread to infer, so the
 * published declaration names it by the builders' own `SettingDeclaration`.
 */
export const TITLED_COLLECTION: SettingDeclaration<string, "collection"> & {
  readonly rows: "titled";
} = { ...CARD_COLLECTION, rows: "titled" };

/**
 * The card's Group by over its Collection, with no static default:
 * collections need not share a field. Unset, or set to a field this reader may
 * not use, it groups by what the collection divides by (status, else its first
 * groupable choice field). Written as a type for the reason `TITLED_COLLECTION` is.
 */
export const COLLECTION_GROUP_BY: SettingDeclaration<
  string,
  "groupBy",
  "collection"
> & { readonly defaultFrom: "collection" } = {
  ...setting.groupBy({ of: "collection", label: "Group by" }),
  defaultFrom: "collection",
};

/**
 * Over time's Date range, its one quick setting, on the card's header: the
 * range its chart draws, the last 30 days unless chosen, in the builders' own
 * ranges and words.
 */
export const OVER_TIME_DATE_RANGE = setting.dateRange({
  label: "Date range",
  quick: true,
});

/** Over time's Chart style: a line, or one bar per interval. */
export const OVER_TIME_CHART_STYLE = setting.select({
  label: "Chart style",
  options: [
    { label: "Line", value: "line" },
    { label: "Bars", value: "bars" },
  ],
  defaultValue: "line",
});

/** Continue where you left off's "Number of items", the same offer under the same name. */
export const CONTINUE_ITEMS: WidgetSetting = RECENT_ACTIVITY_ITEMS;

/** What each tab is called on the card's header. */
const TAB_LABELS: Readonly<Record<WidgetTab, string>> = {
  mine: "Mine",
  team: "Team",
};

/**
 * Continue where you left off's Tab, its one quick setting: the reader's own
 * work (Mine, the default) or other people's (Team). Its source narrows by it
 * (`tab` among its filters), so the knob sets the query's `where`. The values
 * are the Tab filter's own (`WIDGET_TABS`).
 */
export const CONTINUE_TAB: WidgetSetting = {
  name: "tab",
  label: "Show",
  type: "select",
  defaultValue: "mine",
  quick: true,
  options: WIDGET_TABS.map(value => ({ label: TAB_LABELS[value], value })),
  // Drawn with the card's data in its settings panel: it narrows whose work the card reads.
  section: "data",
};
