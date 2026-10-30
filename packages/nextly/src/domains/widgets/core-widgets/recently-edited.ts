/**
 * Core's Recently edited card, as a widget. One module per widget; `core-widgets/index.ts`
 * lists them in their order.
 *
 * @module domains/widgets/core-widgets/recently-edited
 */

import type { WidgetDefinition } from "../definition";
import { RECENT_EDITS_SOURCE_ID } from "../system-source-ids";

import { CORE_WIDGET_ID } from "./ids";
import {
  LIST_DENSITY,
  RECENTLY_EDITED_ITEMS,
  RECENTLY_EDITED_ONLY_MINE,
  RECENTLY_EDITED_COLLECTION,
} from "./shared";

export const recentlyEditedWidget = {
  id: CORE_WIDGET_ID.recentlyEdited,
  title: "Recently edited",
  description:
    "The entries and Singles most recently saved, newest first, one row each.",
  // Its own component, because a row is a link to its document and a line of
  // what the list draws no room for: its collection, who saved it, when, and
  // its status. Framed, so the heading, the size tiers and the empty state are
  // the card's like any other's.
  archetype: "custom",
  component: "core#RecentlyEdited",
  // Half the row by default; from a third, where its rows still read, to the full width. Five
  // rows tall at the default density (h 5), from four (h 4) to the ten a list draws (h 8).
  size: {
    default: { w: 6, h: 5 },
    min: { w: 4, h: 4 },
    max: { w: 12, h: 8 },
  },
  // From the activity trail, one row per document at its latest save the
  // reader may see, across every collection they may read; the same trail
  // Recent activity reads, grouped by document rather than by run. Every
  // field a row is drawn from, and nothing the card does not draw.
  query: {
    source: RECENT_EDITS_SOURCE_ID,
    op: "list",
    select: [
      "id",
      "entryId",
      "entryTitle",
      "collection",
      "subjectKind",
      "locale",
      "actorType",
      "userId",
      "userName",
      "identityErasedAt",
      "createdAt",
      "status",
      "pendingChanges",
    ],
    limit: 5,
  },
  // Asked like core's own lists: the rows its size draws and one more, so the
  // card can say more exist at every size.
  sizedQuery: true,
  settings: [
    RECENTLY_EDITED_ONLY_MINE,
    RECENTLY_EDITED_COLLECTION,
    RECENTLY_EDITED_ITEMS,
    LIST_DENSITY,
  ],
} as const satisfies WidgetDefinition;
