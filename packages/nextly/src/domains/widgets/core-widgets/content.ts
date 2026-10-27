/**
 * Core's Content card, as a widget. One module per widget; `core-widgets/index.ts`
 * lists them in their order.
 *
 * @module domains/widgets/core-widgets/content
 */

import type { WidgetDefinition } from "../definition";
import { MAX_WIDGET_LIMIT } from "../query-limits";
import { CONTENT_SOURCE_ID } from "../system-source-ids";

import { CORE_WIDGET_ID } from "./ids";

export const contentWidget = {
  id: CORE_WIDGET_ID.content,
  title: "Content",
  description:
    "Each collection and Single this reader may see, with its entries and drafts.",
  archetype: "custom",
  // From half the row, where its list of collections and Singles still reads, to the full width.
  size: {
    default: { w: 12, h: 4 },
    min: { w: 6, h: 3 },
    max: { w: 12, h: 6 },
  },
  defaultOrder: 50,
  component: "core#CollectionQuickLinks",
  // Each collection's entries and drafts, and each Single, counted as the reader, in the batch
  // like every card. Asked the most any widget query may return: an omitted limit is the
  // default 5, and this card lists everything, saying "more exist" past the last it draws.
  query: { source: CONTENT_SOURCE_ID, op: "list", limit: MAX_WIDGET_LIMIT },
  /*
   * Offered only while this reader has a collection or a Single to see that
   * is neither internal nor hidden. A reader with nothing to list is not
   * shown an empty list. It replaces the Collections and Singles cards.
   */
  lifecycle: "conditional",
  visibleWhen: "content:present",
} as const satisfies WidgetDefinition;
