/**
 * Core's Create card, as a widget. One module per widget; `core-widgets/index.ts`
 * lists them in their order.
 *
 * @module domains/widgets/core-widgets/quick-create
 */

import type { WidgetDefinition } from "../definition";

import { CORE_WIDGET_ID } from "./ids";

export const quickCreateWidget = {
  id: CORE_WIDGET_ID.quickCreate,
  title: "Create",
  description:
    "One click to an empty entry form, for the collections this reader may create in.",
  archetype: "custom",
  // From a third, where its row of create buttons wraps, to the full width.
  // Four rows tall by default, the height of Needs attention, whose row of the
  // default dashboard it shares.
  size: {
    default: { w: 4, h: 4 },
    min: { w: 4, h: 2 },
    max: { w: 12, h: 4 },
  },
  component: "core#QuickCreate",
  // Offered only to a reader who could create an entry somewhere: every
  // button on it would otherwise open onto a refusal.
  lifecycle: "conditional",
  visibleWhen: "create:available",
} as const satisfies WidgetDefinition;
