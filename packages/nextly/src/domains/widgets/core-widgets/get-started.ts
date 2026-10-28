/**
 * Core's Get started card, as a widget. One module per widget; `core-widgets/index.ts`
 * lists them in their order.
 *
 * @module domains/widgets/core-widgets/get-started
 */

import type { WidgetDefinition } from "../definition";
import { GET_STARTED_WIDGET_ID } from "../get-started-steps";

export const getStartedWidget = {
  id: GET_STARTED_WIDGET_ID,
  title: "Get started",
  description:
    "The setup steps this reader could still take, detected from the install rather than ticked by hand.",
  archetype: "custom",
  // Full width only, and compact: it draws the whole steps its rows hold and folds the rest
  // behind "Show N more", which grows the card in place (the admin's Get started fold). A card
  // never scrolls, so no step is ever cut by its edge, at any height a reader gives it.
  size: {
    default: { w: 12, h: 4 },
    min: { w: 12, h: 3 },
    max: { w: 12, h: 12 },
  },
  component: "core#GetStartedCard",
  /*
   * 🔴 No condition. Whether a widget is visible is part of the token a
   * layout write is checked against, so a card whose visibility followed its
   * steps would turn a reader's skip or dismissal into a stale-scope refusal
   * whenever a step changed between their read and their write, and a card
   * in their row would vanish from view and from Removed. Visible by
   * permission alone, it is drawn or left dormant by the layout read, from
   * the step answer and the card's own settings, after the stored row is
   * read (see `api/widget-layout.ts`).
   *
   * It replaces "Set up your project" and the sample-content offer.
   */
  dismissible: true,
} as const satisfies WidgetDefinition;
