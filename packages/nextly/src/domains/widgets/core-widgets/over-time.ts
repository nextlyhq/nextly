/**
 * Core's Over time card, declared with `defineWidget`. One module per widget;
 * `core-widgets/index.ts` lists them in their order.
 *
 * Its `load` reads one series, as the person asking: the entries the card's
 * collection gained under its Filter, placed by when each was created, in every
 * interval of the card's Date range, the first one counting only what falls
 * inside the range. The range decides the interval (a day for 7 and 30 days,
 * a week for 90, a month for 12 months), and its component draws the points as
 * a line or bars by its Chart style, and the same values as a table on
 * request. Through the public read services alone, as a plugin's card reads.
 *
 * @module domains/widgets/core-widgets/over-time
 */

import { defineWidget } from "../declaration/define-widget";

import { askedQuery } from "./asked";
import type { OverTimeWidgetData } from "./data";
import { CORE_WIDGET_ID } from "./ids";
import {
  CARD_COLLECTION,
  CARD_FILTER,
  OVER_TIME_CHART_STYLE,
  OVER_TIME_DATE_RANGE,
} from "./shared";

/** Over time's settings, its range the one on the card's header. */
const OVER_TIME_SETTINGS = {
  collection: CARD_COLLECTION,
  filter: CARD_FILTER,
  dateRange: OVER_TIME_DATE_RANGE,
  chartStyle: OVER_TIME_CHART_STYLE,
};

export const overTimeWidget = defineWidget({
  id: CORE_WIDGET_ID.overTime,
  title: "Over time",
  description:
    "How many entries a collection gained in each day, week or month of a range.",
  offered: "per-collection",
  // Half the row by default; from a third, where its chart still reads, to the full width.
  size: {
    default: { w: 6, h: 3 },
    min: { w: 4, h: 3 },
    max: { w: 12, h: 4 },
  },
  settings: OVER_TIME_SETTINGS,
  load: async ({ settings, services }): Promise<OverTimeWidgetData> => {
    // The Filter as core's knobs join it, judged against the collection as
    // the public `describe` read answers it.
    const { where } = askedQuery(
      { op: "timeseries" },
      OVER_TIME_SETTINGS,
      settings,
      await services.describe(settings.collection)
    );
    const { points, interval } = await services.timeseries(
      settings.collection,
      {
        // The card's Date range is the range the series is drawn over.
        range: settings.dateRange,
        dateField: "createdAt",
        status: "all",
        ...(where === undefined ? {} : { where }),
      }
    );
    return { points, interval };
  },
  view: { component: "core#OverTime" },
  // It loads, and its add-panel row is sketched, as a series over time.
  skeleton: "series",
  // A range is drawn in every one of its intervals, a quiet one at zero, so
  // its answer always has points to draw; the component says so for one that
  // has none.
  isEmpty: () => false,
});
