/**
 * Core's Needs your attention card, declared with `defineWidget` as a plugin
 * declares its own. One module per widget; `core-widgets/index.ts` lists them
 * in their order.
 *
 * Its `load` answers the attention digest: one item per thing of open work
 * waiting for the reader, most urgent first, each with where to go about it.
 * The digest is read as the caller the card's read services were bound for,
 * so an API key is judged by its own grant rather than by the person who made
 * it. With nothing waiting the card is empty and leaves the dashboard; an item
 * whose count failed keeps it shown, since a reader with something unknown
 * cannot be called clear.
 *
 * The digest is handed to this module by the attention source when it is
 * registered (`provideAttentionDigest`), rather than imported: the widget
 * list is read by the admin's own tests and by every reader of core's ids,
 * none of which should reach the services the digest reads through.
 *
 * @module domains/widgets/core-widgets/needs-attention
 */

import { NextlyError } from "../../../errors/nextly-error";
import type { AttentionDigestItem } from "../attention/digest-item";
import {
  defineWidget,
  type WidgetReadServices,
} from "../declaration/define-widget";
import { processHeld } from "../process-held";

import { CORE_WIDGET_ID } from "./ids";

/**
 * The digest for the caller a card's read services were bound for, within
 * the card's signal and as of the batch's instant.
 */
type CardDigestRead = (
  services: WidgetReadServices,
  opts: { signal: AbortSignal; now: Date }
) => Promise<readonly AttentionDigestItem[]>;

/**
 * The digest read the attention source provided, held for the process
 * (`processHeld`): Next.js and Turbopack can evaluate this module in more than
 * one server graph, and the source registered at boot and the card answered on
 * a request can each hold a different copy.
 */
const provided = processHeld(
  "nextly.dashboard.attentionDigest",
  (): { read?: CardDigestRead } => ({}),
  (held): held is { read?: CardDigestRead } =>
    typeof held === "object" && held !== null
);

/** Hands the card its digest read; the attention source does, when it is registered. */
export function provideAttentionDigest(read: CardDigestRead): void {
  provided.read = read;
}

export const needsAttentionWidget = defineWidget({
  id: CORE_WIDGET_ID.needsAttention,
  title: "Needs your attention",
  description:
    "Open work waiting for you: releases that stopped or are overdue, and items your plugins add.",
  // Two thirds by default; from a third, where each row still holds its label,
  // reason and Review, to the full width. Three rows tall at the least, which
  // holds two items.
  size: {
    default: { w: 8, h: 3 },
    min: { w: 4, h: 3 },
    max: { w: 12, h: 6 },
  },
  hidesWhenEmpty: true,
  load: async ({ services, signal, now }) => {
    const cardDigest = provided.read;
    if (cardDigest === undefined) {
      // Booted without the attention source: a fault of the install, never
      // an empty card that would say nothing is waiting.
      throw NextlyError.internal({
        logContext: { reason: "attention-digest-not-provided" },
      });
    }
    const items = await cardDigest(services, { signal, now });
    // Each item as plain fields, which is what reaches the browser.
    return { items: items.map(item => ({ ...item })) };
  },
  view: { component: "core#NeedsAttention" },
  // Nothing waiting, and nothing unknown: a failed item is an item, so the
  // card stays to say it could not check.
  isEmpty: data => data.items.length === 0,
  // A state, not a verdict: seen in customise mode, where an empty card is
  // shown marked as hidden, and at rest only when the reader's last item
  // cleared after the dashboard was drawn, since a card never leaves the
  // page mid-view; the next visit draws the dashboard without it.
  empty: { message: "Nothing is waiting for you now." },
});
