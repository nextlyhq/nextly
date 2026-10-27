/**
 * Core's Breakdown card, as a widget. One module per widget; `core-widgets/index.ts`
 * lists them in their order.
 *
 * @module domains/widgets/core-widgets/breakdown
 */

import type { WidgetDefinition } from "../definition";

export const breakdownWidget = {
  id: "core/breakdown",
  title: "Breakdown",
  description:
    "How a collection's entries divide: by status, or by a field with choices.",
  archetype: "bars",
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
  settings: [
    { name: "collection", type: "collection", label: "Collection" },
    { name: "filter", type: "filter", of: "collection", label: "Filter" },
    // No static default: collections need not share a field. Unset, or set
    // to a field this reader may not use, it groups by what the collection
    // divides by (status, else its first groupable choice field).
    {
      name: "groupBy",
      type: "groupBy",
      of: "collection",
      label: "Group by",
      defaultFrom: "collection",
    },
  ],
  // Its source and its group key are the card's settings: a Breakdown set
  // to no collection, or to one with nothing to divide by, asks nothing.
  query: { op: "groupBy", status: "all" },
} as const satisfies WidgetDefinition;
