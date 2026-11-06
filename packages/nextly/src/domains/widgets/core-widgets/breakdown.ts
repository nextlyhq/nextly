/**
 * Core's Breakdown card, declared with `defineWidget`. One module per widget;
 * `core-widgets/index.ts` lists them in their order.
 *
 * Its `load` reads one grouping, as the person asking: the collection the card
 * is set to, under its Filter, divided by its Group by, or by what the
 * collection most naturally divides by where that is unset or names a field
 * this reader may not use. Its component draws the groups as bars, and the
 * same values as a table on request.
 *
 * Through the public read services alone, as a plugin's card reads: the
 * collection as `describe` answers it decides the grouping, by the same knobs
 * the admin applies (`askedQuery`, so an unset Group by takes the field the
 * public `naturalGroupBy` names), and names the grouped field and its values;
 * `groupBy` answers the buckets, and whether the counts are floors or groups
 * were left out.
 *
 * @module domains/widgets/core-widgets/breakdown
 */

import { defineWidget } from "../declaration/define-widget";

import { askedQuery } from "./asked";
import type { BreakdownWidgetData } from "./data";
import { CORE_WIDGET_ID } from "./ids";
import { CARD_COLLECTION, CARD_FILTER, COLLECTION_GROUP_BY } from "./shared";

/** Breakdown's settings: the collection it divides, its Filter, and what it groups by. */
const BREAKDOWN_SETTINGS = {
  collection: CARD_COLLECTION,
  filter: CARD_FILTER,
  groupBy: COLLECTION_GROUP_BY,
};

/** Made-up entries by status, for the add gallery's tile and the preview page. */
const SAMPLE_BREAKDOWN: BreakdownWidgetData = {
  buckets: [
    { value: "published", count: 86 },
    { value: "draft", count: 24 },
    { value: "archived", count: 6 },
  ],
  field: {
    name: "status",
    type: "string",
    label: "Status",
    choices: [
      { value: "published", label: "Published" },
      { value: "draft", label: "Draft" },
      { value: "archived", label: "Archived" },
    ],
  },
};

export const breakdownWidget = defineWidget({
  id: CORE_WIDGET_ID.breakdown,
  title: "Breakdown",
  description:
    "How a collection's entries divide: by status, or by a field with choices.",
  // Added from a collection's group of the add panel, once per collection
  // and again with other settings, never placed on the default dashboard.
  // Offered only on a collection with something to divide its entries by.
  offered: "per-collection",
  // A third by default; from a quarter to half the row.
  size: {
    default: { w: 4, h: 3 },
    min: { w: 3, h: 3 },
    max: { w: 6, h: 4 },
  },
  settings: BREAKDOWN_SETTINGS,
  load: async ({ settings, services }): Promise<BreakdownWidgetData> => {
    const { collection } = settings;
    const described = await services.describe(collection);
    const asked = askedQuery(
      { op: "groupBy" },
      BREAKDOWN_SETTINGS,
      settings,
      described
    );
    const field = asked.groupBy;
    // A collection with nothing to divide by, for this reader: nothing is
    // asked, as the card asked nothing from the browser.
    if (asked.source === undefined || field === undefined) {
      return { buckets: null };
    }
    const { buckets, truncated, atLeast } = await services.groupBy(collection, {
      field,
      status: "all",
      ...(asked.where === undefined ? {} : { where: asked.where }),
    });
    // The grouped field as the collection describes it: the bars' heading,
    // and the name of each value it holds.
    const grouped = described?.fields.find(each => each.name === field);
    return {
      buckets,
      ...(grouped === undefined
        ? {}
        : {
            field: {
              name: grouped.name,
              type: grouped.type,
              label: grouped.label,
              ...(grouped.choices === undefined
                ? {}
                : { choices: grouped.choices }),
            },
          }),
      ...(truncated === true ? { truncated: true } : {}),
      ...(atLeast === true ? { atLeast: true } : {}),
    };
  },
  view: { component: "core#Breakdown" },
  // It loads, and its add-panel row is sketched, as bars.
  skeleton: "bars",
  // The component draws its own empty state, worded for groups and for a read
  // that stopped at its bound, which the frame's one line could not say.
  isEmpty: () => false,
  preview: [{ name: "By status", data: SAMPLE_BREAKDOWN }],
});
