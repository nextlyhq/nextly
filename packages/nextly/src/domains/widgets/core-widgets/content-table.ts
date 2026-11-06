/**
 * Core's Content table, declared with `defineWidget`. One module per widget;
 * `core-widgets/index.ts` lists them in their order.
 *
 * Its `load` reads `system:content` as the caller its read services were bound
 * for: the collections and Singles this reader may see, latest update first,
 * each collection's entries and drafts counted as that reader and no others.
 * Asked as core's own lists are: the rows the card's size draws, at most the
 * ten a list draws, and one more, so the card counts only what it shows and
 * still knows more exist.
 *
 * @module domains/widgets/core-widgets/content-table
 */

import { rowsThatFit } from "../card-geometry";
import { defineWidget } from "../declaration/define-widget";
import { MAX_WIDGET_ROWS } from "../query-limits";
import { CONTENT_SOURCE_ID } from "../system-source-ids";

import type { CoreListWidgetData } from "./data";
import { CORE_WIDGET_ID } from "./ids";
import { readCoreList } from "./system-read";

export const contentTableWidget = defineWidget({
  id: CORE_WIDGET_ID.contentTable,
  title: "Content",
  description:
    "One compact table of the collections and Singles this reader may see: entries, drafts, the last update, and a create button on each row.",
  // From half the row, where the table's five columns still read, to the full width.
  size: {
    default: { w: 12, h: 4 },
    min: { w: 6, h: 3 },
    max: { w: 12, h: 6 },
  },
  load: async ({ services, size, signal, now }): Promise<CoreListWidgetData> =>
    readCoreList(
      {
        source: CONTENT_SOURCE_ID,
        op: "list",
        // The rows the card's height holds, at most the ten a list draws, and the one more that
        // says more exist. The card offers no Density, so its rows are the default's.
        limit:
          Math.min(MAX_WIDGET_ROWS, rowsThatFit(size, { density: "default" })) +
          1,
      },
      { services, signal, now }
    ),
  // Its own component: a table of the rows on a wide card, rows on a narrow one.
  view: { component: "core#ContentTable" },
  // The component draws its own empty state, which says what the table lists.
  isEmpty: () => false,
});
