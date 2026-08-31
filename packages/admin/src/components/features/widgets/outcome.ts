/**
 * What a widget's card will actually SHOW, decided once.
 *
 * Two callers need this and they must never disagree. `WidgetRenderer` draws
 * from it, and `WidgetGrid` counts from it for the live region — and the grid
 * previously counted SLOTS instead, which is a different question. A slot can
 * be `ok` and still unrenderable: a `list` archetype in a release that draws
 * only `metric`, or a metric handed a list payload. The grid then announced
 * "3 of 3 widgets updated" while a card on screen said the archetype is not
 * rendered yet, and the announcement carried the authority of having been
 * derived from the response.
 *
 * So the transport's verdict is not the card's verdict, and the announcement
 * has to come from the second. Deriving one view from the other rather than
 * computing them alongside is what keeps them from drifting the day a new
 * archetype lands.
 *
 * The grid and the renderer each call this, so a body runs twice per render.
 * That is deliberate and it is the cheap half of the trade: a body returns an
 * element it does not mount, while the alternative — the grid counting
 * something adjacent — is the defect above.
 *
 * @module components/features/widgets/outcome
 */

import type { WidgetArchetype } from "nextly/config";
import type { ReactNode } from "react";

import type {
  DashboardWidget,
  WidgetSlot,
} from "@admin/types/dashboard/widgets";

import { metricBody } from "./archetypes/metric";
import type { ArchetypeBody } from "./archetypes/types";

/**
 * The archetypes core draws from a query result.
 *
 * Partial on purpose: an archetype with no entry is one this release does not
 * render, and the card says so by name rather than coming up blank. `custom`
 * is deliberately absent — it is not drawn from a result at all.
 */
const ARCHETYPE_BODIES: Partial<Record<WidgetArchetype, ArchetypeBody>> = {
  metric: metricBody,
};

/**
 * What the card is about to be, as four cases the grid can count and the
 * renderer can draw.
 *
 * `self-drawn` is neither success nor failure and must not be counted as
 * either: the plugin's component decides what it shows, and core has no way to
 * know whether it worked.
 */
export type WidgetOutcome =
  | { state: "self-drawn" }
  | { state: "loading" }
  | { state: "failed"; message: string }
  | { state: "ready"; node: ReactNode };

export function resolveWidgetOutcome(
  definition: DashboardWidget,
  slot: WidgetSlot | undefined
): WidgetOutcome {
  // The escape hatch. A plugin component owns its own body and its own states.
  if (definition.archetype === "custom") return { state: "self-drawn" };

  const body = ARCHETYPE_BODIES[definition.archetype];
  if (!body) {
    return {
      state: "failed",
      message: `The "${definition.archetype}" widget archetype is not rendered yet.`,
    };
  }

  if (!slot) {
    // Absent means IN FLIGHT, and only a widget that actually asked for
    // something can have a request in flight. One with no query never will, so
    // reading its absent slot as busy leaves the card spinning for the life of
    // the page -- with nothing on screen, in the live region or in the console
    // saying why. `resolve-widgets` prefers a contributed component over this,
    // so reaching here means there was none to prefer.
    if (!definition.query) {
      return {
        state: "failed",
        message: `The "${definition.archetype}" archetype is drawn from a query, and this widget declares none.`,
      };
    }
    return { state: "loading" };
  }

  if (!slot.ok) return { state: "failed", message: slot.error };

  const drawn = body(slot.result, definition);
  return drawn.ok
    ? { state: "ready", node: drawn.node }
    : { state: "failed", message: drawn.message };
}
