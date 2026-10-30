/**
 * Core's Team activity card, as a widget: who created, saved, published,
 * unpublished or deleted which entry or Single, newest first, limited to what
 * the reader may read. One module per widget; `core-widgets/index.ts` lists them
 * in their order.
 *
 * @module domains/widgets/core-widgets/team-activity
 */

import type { WidgetDefinition } from "../definition";
import { ACTIVITY_SOURCE_ID } from "../system-source-ids";

import { CORE_WIDGET_ID } from "./ids";
import { LIST_DENSITY, RECENT_ACTIVITY_ITEMS } from "./shared";

export const teamActivityWidget = {
  id: CORE_WIDGET_ID.teamActivity,
  title: "Team activity",
  description: "Who changed what in your content, newest first.",
  // Its own component, because a row is a sentence with an avatar and a time
  // read relative to now, which no list line draws. Framed, so the heading,
  // the size tiers and the empty state are the card's like any other's, and
  // answered by `system:activity` through the batch, the same read the activity
  // endpoint makes: it leaves out every event about an entry, collection or
  // Single the reader may not read, so the card neither draws nor counts one.
  archetype: "custom",
  // Half the row by default; from a third, where its rows still read, to the full width. Five
  // rows tall at the default density (h 5), from four (h 4) to the ten a list draws (h 8).
  size: {
    default: { w: 6, h: 5 },
    min: { w: 4, h: 4 },
    max: { w: 12, h: 8 },
  },
  component: "core#TeamActivity",
  query: { source: ACTIVITY_SOURCE_ID, op: "list" },
  // Asked like core's own lists: the rows its size draws and one more, so the
  // card can say more exist at every size.
  sizedQuery: true,
  settings: [RECENT_ACTIVITY_ITEMS, LIST_DENSITY],
} as const satisfies WidgetDefinition;
