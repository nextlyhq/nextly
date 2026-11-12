/**
 * Core's Continue where you left off card, declared with `defineWidget`. One
 * module per widget; `core-widgets/index.ts` lists them in their order.
 *
 * Its `load` reads `system:continue` as the caller its read services were
 * bound for, on the tab its reader chose: their pins first, then their saves
 * (Mine), or what other people saved (Team), as the reader may read each of
 * them now. Asked as core's own lists are: its "Number of entries"
 * (`listEntries`), and one more, so the card can say more exist.
 *
 * @module domains/widgets/core-widgets/continue
 */

import { defineWidget } from "../declaration/define-widget";
import { listEntries } from "../query-limits";
import { CONTINUE_SOURCE_ID } from "../system-source-ids";

import type { CoreListWidgetData } from "./data";
import { CORE_WIDGET_ID } from "./ids";
import { CONTINUE_TAB, LIST_DENSITY_SETTING, LIST_ITEMS } from "./shared";
import { readCoreList } from "./system-read";

export const continueWidget = defineWidget({
  id: CORE_WIDGET_ID.continue,
  // Drawn beside its name in the add panel.
  icon: "History",
  title: "Continue where you left off",
  // One line, as the add panel lists it.
  description: "Entries you saved or pinned, to pick up again.",
  // Half the row by default; from a third, where its rows still read, to the
  // full width. Five rows tall at the default density (h 5), from four (h 4)
  // to the ten a list draws (h 8).
  size: {
    default: { w: 6, h: 5 },
    min: { w: 4, h: 4 },
    max: { w: 12, h: 8 },
  },
  // The tab is the header's one quick control; the number of rows and their
  // density are the card's display settings.
  settings: {
    tab: CONTINUE_TAB,
    limit: LIST_ITEMS,
    density: LIST_DENSITY_SETTING,
  },
  load: async ({
    settings,
    services,
    signal,
    now,
  }): Promise<CoreListWidgetData> =>
    readCoreList(
      {
        source: CONTINUE_SOURCE_ID,
        op: "list",
        // Every field a row is drawn from, and nothing the card does not draw.
        select: [
          "id",
          "entryId",
          "entryTitle",
          "collection",
          "subjectKind",
          "icon",
          "locale",
          "actorType",
          "userId",
          "userName",
          "identityErasedAt",
          "editedAt",
          "status",
          "pendingChanges",
          "pinned",
        ],
        // The source narrows by the tab its reader chose, Mine unless chosen.
        where: { tab: settings.tab },
        // Its "Number of entries", and the one more that says more exist: the rule the card's
        // own rows are drawn by (`listEntries`).
        limit: listEntries(settings.limit) + 1,
      },
      { services, signal, now }
    ),
  // Its own component, because a row is a link to its document with a line of
  // what the list draws no room for (its collection and when it was edited),
  // its status, and a menu that pins or unpins it.
  view: { component: "core#ContinueCard" },
  // The component draws its own empty state, which says which tab has nothing
  // and how far back Team's answer looked, which the frame's one line could not.
  isEmpty: () => false,
});
