/**
 * Core's Continue where you left off card, as a widget. One module per widget;
 * `core-widgets/index.ts` lists them in their order.
 *
 * @module domains/widgets/core-widgets/continue
 */

import type { WidgetDefinition } from "../definition";
import { CONTINUE_SOURCE_ID } from "../system-source-ids";

import { CORE_WIDGET_ID } from "./ids";
import { CONTINUE_ITEMS, CONTINUE_TAB, LIST_DENSITY } from "./shared";

export const continueWidget = {
  id: CORE_WIDGET_ID.continue,
  title: "Continue where you left off",
  description:
    "Your pinned entries and your latest saves, or what other people saved, one row per entry.",
  // Its own component, because a row is a link to its document with a line of
  // what the list draws no room for (its collection and when it was edited),
  // its status, and a menu that pins or unpins it. Framed, so the heading, the
  // size tiers and the empty state are the card's like any other's.
  archetype: "custom",
  component: "core#ContinueCard",
  // Half the row by default; from a third, where its rows still read, to the
  // full width. Five rows tall at the default density (h 5), from four (h 4)
  // to the ten a list draws (h 8).
  size: {
    default: { w: 6, h: 5 },
    min: { w: 4, h: 4 },
    max: { w: 12, h: 8 },
  },
  // Pins first, then saves, as the reader may read each of them now; every
  // field a row is drawn from, and nothing the card does not draw.
  query: {
    source: CONTINUE_SOURCE_ID,
    op: "list",
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
    limit: 5,
  },
  // Asked like core's own lists: the rows its size draws and one more, so the
  // card can say more exist at every size.
  sizedQuery: true,
  // Offered only while the reader may read a collection or a Single the
  // dashboard lists: with none, nobody's saves could reach a row, and the card
  // would only ever say so.
  lifecycle: "conditional",
  visibleWhen: "content:present",
  // The tab is the header's one quick control; the number of rows and their
  // density are the card's display settings.
  settings: [CONTINUE_TAB, CONTINUE_ITEMS, LIST_DENSITY],
} as const satisfies WidgetDefinition;
