/**
 * Core's Recent entries card, as a widget. One module per widget; `core-widgets/index.ts`
 * lists them in their order.
 *
 * @module domains/widgets/core-widgets/recent-entries
 */

import type { WidgetDefinition } from "../definition";

import { LIST_DENSITY, RECENT_ENTRIES_ITEMS } from "./shared";

export const recentEntriesWidget = {
  id: "core/recent-entries",
  title: "Recent entries",
  description:
    "A collection's entries changed most recently, each linking to its entry.",
  archetype: "custom",
  component: "core#RecentEntries",
  // Added from a collection's group of the add panel, once per collection or
  // more, and never placed on the default dashboard.
  offered: "per-collection",
  // Half the row by default; from a third, where its rows still read, to the full width. Five
  // rows tall at the default density (h 5), from four (h 4) to the ten a list draws (h 8).
  size: {
    default: { w: 6, h: 5 },
    min: { w: 4, h: 4 },
    max: { w: 12, h: 8 },
  },
  // Asked like core's own lists: the rows its size draws and one more, so the
  // card can say more exist at every size.
  sizedQuery: true,
  settings: [
    // Titled: each row is asked by the collection's own title field, its
    // status where it has a lifecycle, and when it was updated.
    {
      name: "collection",
      type: "collection",
      label: "Collection",
      rows: "titled",
    },
    { name: "filter", type: "filter", of: "collection", label: "Filter" },
    {
      name: "sort",
      type: "sort",
      of: "collection",
      label: "Sort",
      defaultValue: "-updatedAt",
    },
    RECENT_ENTRIES_ITEMS,
    LIST_DENSITY,
  ],
  query: { op: "list", status: "all", sort: "-updatedAt", limit: 5 },
} as const satisfies WidgetDefinition;
