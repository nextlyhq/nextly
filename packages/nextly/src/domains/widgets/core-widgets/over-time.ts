/**
 * Core's Over time card, as a widget. One module per widget; `core-widgets/index.ts`
 * lists them in their order.
 *
 * @module domains/widgets/core-widgets/over-time
 */

import type { WidgetDefinition } from "../definition";

import { OVER_TIME_DATE_RANGE, OVER_TIME_CHART_STYLE } from "./shared";

export const overTimeWidget = {
  id: "core/over-time",
  title: "Over time",
  description:
    "How many entries a collection gained in each day, week or month of a range.",
  archetype: "custom",
  component: "core#OverTime",
  offered: "per-collection",
  // Half the row by default; from a third, where its chart still reads, to the full width.
  size: {
    default: { w: 6, h: 3 },
    min: { w: 4, h: 3 },
    max: { w: 12, h: 4 },
  },
  settings: [
    { name: "collection", type: "collection", label: "Collection" },
    { name: "filter", type: "filter", of: "collection", label: "Filter" },
    // The card's one quick setting: its range, on the card's header.
    OVER_TIME_DATE_RANGE,
    OVER_TIME_CHART_STYLE,
  ],
  // Entries created: `createdAt`, every interval the range overlaps, the
  // first one counting only what falls inside the range.
  query: {
    op: "timeseries",
    status: "all",
    dateField: "createdAt",
    range: "30d",
  },
} as const satisfies WidgetDefinition;
