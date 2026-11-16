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

import { defineWidget } from "../declaration/define-widget";
import { listEntries } from "../query-limits";
import { CONTENT_SOURCE_ID } from "../system-source-ids";

import type { CoreListWidgetData } from "./data";
import { CORE_WIDGET_ID } from "./ids";
import { LIST_ITEMS } from "./shared";
import { readCoreList } from "./system-read";

export const contentTableWidget = defineWidget({
  id: CORE_WIDGET_ID.contentTable,
  // Drawn beside its name in the add panel.
  icon: "Table",
  title: "Content",
  // One line, as the add panel lists it.
  description:
    "Every collection and Single, with its entries, drafts and a create button.",
  // From half the row, where the table's five columns still read, to the full width.
  size: {
    default: { w: 12, h: 4 },
    min: { w: 6, h: 3 },
    max: { w: 12, h: 6 },
  },
  // How many collections and Singles the table lists before "View all".
  settings: { limit: LIST_ITEMS },
  load: async ({
    settings,
    services,
    signal,
    now,
  }): Promise<CoreListWidgetData> =>
    readCoreList(
      {
        source: CONTENT_SOURCE_ID,
        op: "list",
        // Its "Number of entries", and the one more that says more exist (`listEntries`).
        limit: listEntries(settings.limit) + 1,
      },
      { services, signal, now }
    ),
  // Its own component: a table of the rows on a wide card, rows on a narrow one.
  // Loads as the table it draws, holding the place of its "Number of entries" of rows: a site
  // has collections from its first day, so the table is nearly always full, and a full answer
  // lands at the height the card loaded at.
  skeleton: "table",
  view: { component: "core#ContentTable" },
  // The component draws its own empty state, which says what the table lists.
  isEmpty: () => false,
});
