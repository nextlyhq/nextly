/**
 * Core's Needs attention card, as a widget. One module per widget; `core-widgets/index.ts`
 * lists them in their order.
 *
 * @module domains/widgets/core-widgets/needs-attention
 */

import type { WidgetDefinition } from "../definition";
import { MAX_WIDGET_LIMIT } from "../query-limits";
import { ATTENTION_SOURCE_ID } from "../system-source-ids";

export const needsAttentionWidget = {
  id: "core/needs-attention",
  title: "Needs attention",
  description:
    "What is waiting: unpublished changes, releases due this week, and overdue releases.",
  archetype: "custom",
  // Two thirds by default; from a third, where its small tier still names
  // each kind, to the full width, where each kind breaks down per collection.
  // Four rows tall at the least: a row for each of its three kinds always
  // fits, with room for a part beneath them.
  size: {
    default: { w: 8, h: 4 },
    min: { w: 4, h: 4 },
    max: { w: 12, h: 6 },
  },
  defaultOrder: 10,
  // Offered only to a reader who may read a kind it counts; its source
  // answers "not available" to anyone else.
  lifecycle: "conditional",
  visibleWhen: "attention:readable",
  // Ungated: each kind is answered by its own domain as the reader, and a
  // kind they may not read is simply absent from the answer.
  // As many kinds and parts as a grouped answer may carry: the card draws
  // each part at its widest, and the source caps the answer at this.
  query: {
    source: ATTENTION_SOURCE_ID,
    op: "groupBy",
    groupBy: "item",
    limit: MAX_WIDGET_LIMIT,
  },
  component: "core#NeedsAttention",
} as const satisfies WidgetDefinition;
