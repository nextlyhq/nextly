/**
 * The settings several of core's cards share, and the prefix core's components resolve under.
 *
 * @module domains/widgets/core-widgets/shared
 */

import {
  DATE_RANGE_OPTIONS,
  DENSITY_OPTIONS,
  setting,
} from "../declaration/setting-builders";
import type { WidgetSetting } from "../definition";
import { MAX_WIDGET_ROWS } from "../query-limits";
import type { AnyWidgetSetting } from "../settings";

/**
 * Recent activity's "Number of items": the one offer every card makes, named
 * `limit` so it sets the card's query, from 1 to the most rows a card draws
 * (`MAX_WIDGET_ROWS`), so the editor never offers rows the card would not draw.
 *
 * Held as the public `WidgetSetting` rather than written into the list: the
 * builder's own type carries a value brand only declarations read, which the
 * published list of core's widgets has no name for.
 */
export const RECENT_ACTIVITY_ITEMS: WidgetSetting = {
  name: "limit",
  ...setting.number({
    label: "Number of items",
    defaultValue: 5,
    min: 1,
    max: MAX_WIDGET_ROWS,
  }),
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

/** Recent entries' "Number of items", the same offer under the same name. */
export const RECENT_ENTRIES_ITEMS: WidgetSetting = RECENT_ACTIVITY_ITEMS;

/**
 * Every list card's Density: default or compact rows, default unless chosen.
 * One declaration, so each list card offers the same choice under one name,
 * and the admin reads it by that name to decide how many rows fit.
 */
export const LIST_DENSITY: WidgetSetting = {
  name: "density",
  label: "Density",
  type: "select",
  defaultValue: "default",
  // The builder's own options, one per density the admin sizes rows by, so core's list cards
  // and a plugin's offer the same choice.
  options: [...DENSITY_OPTIONS],
};

/**
 * Over time's Date range, its one quick setting: the range its chart draws,
 * which becomes its query's `range`.
 */
export const OVER_TIME_DATE_RANGE: WidgetSetting = {
  name: "dateRange",
  label: "Date range",
  type: "select",
  defaultValue: "30d",
  quick: true,
  // The builders' own, named for the reader as the card's header shows them,
  // so core's chart and a plugin's offer the same ranges in the same words;
  // each value is a range the query draws (`TIMESERIES_RANGES`).
  options: [...DATE_RANGE_OPTIONS],
};

/** Over time's Chart style: a line, or one bar per interval. */
export const OVER_TIME_CHART_STYLE: WidgetSetting = {
  name: "chartStyle",
  label: "Chart style",
  type: "select",
  defaultValue: "line",
  options: [
    { label: "Line", value: "line" },
    { label: "Bars", value: "bars" },
  ],
};

/** Recently edited's "Number of items", the same offer under the same name. */
export const RECENTLY_EDITED_ITEMS: WidgetSetting = RECENT_ACTIVITY_ITEMS;

/**
 * Recently edited's "Only mine": the reader's own saves alone. Its source
 * narrows by it (`onlyMine` among its filters), so the knob sets the query's
 * `where` rather than the card's source.
 */
export const RECENTLY_EDITED_ONLY_MINE: WidgetSetting = {
  name: "onlyMine",
  ...setting.checkbox({ label: "Only mine", defaultValue: false }),
};

/**
 * Recently edited's "Collection": one collection's saves, or every collection
 * the reader may read when none is chosen, which is the default. Its source
 * reads across collections and narrows by one, so the knob sets the query's
 * `where` and the card keeps its source.
 */
export const RECENTLY_EDITED_COLLECTION: AnyWidgetSetting = {
  name: "collection",
  ...setting.collection({ label: "Collection" }),
};
