/**
 * Core's Content table, as a widget. One module per widget; `core-widgets/index.ts`
 * lists them in their order.
 *
 * @module domains/widgets/core-widgets/content-table
 */

import type { WidgetDefinition } from "../definition";
import { MAX_WIDGET_ROWS } from "../query-limits";
import { CONTENT_SOURCE_ID } from "../system-source-ids";

import { CORE_WIDGET_ID } from "./ids";

export const contentTableWidget = {
  id: CORE_WIDGET_ID.contentTable,
  title: "Content",
  description:
    "One compact table of the collections and Singles this reader may see: entries, drafts, the last update, and a create button on each row.",
  archetype: "custom",
  // From half the row, where the table's five columns still read, to the full width.
  size: {
    default: { w: 12, h: 4 },
    min: { w: 6, h: 3 },
    max: { w: 12, h: 6 },
  },
  component: "core#ContentTable",
  // The rows of the table, latest update first, each collection's entries and drafts counted as
  // the reader for the rows answered and no others. Asked like core's own lists: the rows the
  // card's size draws, at most the ten a list draws, and one more, so the card counts only what
  // it shows and still knows more exist.
  query: { source: CONTENT_SOURCE_ID, op: "list", limit: MAX_WIDGET_ROWS },
  sizedQuery: true,
  /*
   * Offered only while this reader has a collection or a Single to see that
   * is neither internal nor hidden. A reader with nothing to list is not
   * shown an empty table.
   */
  lifecycle: "conditional",
  visibleWhen: "content:present",
} as const satisfies WidgetDefinition;
