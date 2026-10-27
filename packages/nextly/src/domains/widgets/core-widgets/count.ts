/**
 * Core's Count card, as a widget. One module per widget; `core-widgets/index.ts`
 * lists them in their order.
 *
 * @module domains/widgets/core-widgets/count
 */

import { IN_RELEASE_KEY } from "../../collections/query/reserved-filter-keys";
import type { WidgetDefinition } from "../definition";

import { CORE_WIDGET_ID } from "./ids";

export const countWidget = {
  id: CORE_WIDGET_ID.count,
  title: "Count",
  description:
    "How many entries a collection holds, published and draft, and how that is changing.",
  archetype: "custom",
  component: "core#Count",
  // Added from a collection's group of the add panel, once per collection,
  // and never placed on the default dashboard.
  offered: "per-collection",
  // A figure, a quarter wide by default; up to two thirds, where the trend
  // is drawn, and a row taller to give it room.
  size: { default: { w: 3, h: 2 }, max: { w: 8, h: 3 } },
  settings: [
    { name: "collection", type: "collection", label: "Collection" },
    { name: "filter", type: "filter", of: "collection", label: "Filter" },
  ],
  // Each read on its own path. The number is ONE read either way: the status
  // split for a collection with a lifecycle (the total is its buckets'
  // sum), a plain count for one without.
  cells: [
    {
      key: "split",
      when: "lifecycle",
      query: { op: "groupBy", groupBy: "status", status: "all" },
    },
    {
      key: "total",
      when: "no-lifecycle",
      query: { op: "count", status: "all" },
    },
    {
      // The trend and the change against the 30 days before are drawn by a
      // large card alone, so a narrower one does not ask them.
      key: "trend",
      drawnFrom: "large",
      query: {
        op: "timeseries",
        dateField: "createdAt",
        interval: "day",
        status: "all",
        limit: 30,
        since: "30d",
      },
    },
    {
      key: "prior",
      drawnFrom: "large",
      query: { op: "count", status: "all", since: "60d", until: "30d" },
    },
    {
      // The entries a scheduled release will publish, through the entry
      // list's own condition, so the figure and the list it links to are
      // one read. A caller with no release to read is answered "not
      // available", and the card leaves the figure out.
      key: "scheduled",
      when: "lifecycle",
      // Beside the split, which a small card leaves out.
      drawnFrom: "medium",
      query: {
        op: "count",
        status: "all",
        where: { [IN_RELEASE_KEY]: true },
      },
    },
  ],
} as const satisfies WidgetDefinition;
