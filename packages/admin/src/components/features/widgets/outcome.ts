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

import { actionsAccepts, actionsBody } from "./archetypes/actions";
import { listAccepts, listBody } from "./archetypes/list";
import { metricBody } from "./archetypes/metric";
import { tableAccepts, tableBody } from "./archetypes/table";
import type { ArchetypeRenderer, DeclaredWidget } from "./archetypes/types";

/**
 * The archetypes core draws from a query result.
 *
 * Partial on purpose: an archetype with no entry is one this release does not
 * render, and the card says so by name rather than coming up blank. `custom`
 * is deliberately absent — it is not drawn from a result at all.
 */
const ARCHETYPE_BODIES: Partial<Record<WidgetArchetype, ArchetypeRenderer>> = {
  metric: { body: metricBody },
  list: { accepts: listAccepts, body: listBody },
  table: { accepts: tableAccepts, body: tableBody },
  actions: { accepts: actionsAccepts, declared: actionsBody },
};

/**
 * The renderer for an archetype, or `undefined` — by OWN property only.
 *
 * `ARCHETYPE_BODIES[archetype]` is not this question, and the difference is
 * reachable. The archetype arrives over the wire from a plugin that may be
 * JavaScript or built against a newer core, and boot deliberately accepts a
 * name this release does not know so one unknown card cannot abort the install.
 * A plain object answers for every name on `Object.prototype` as well as its
 * own: `"__proto__"` returns an object, so the renderer looked present and then
 * threw "body is not a function", taking the whole grid down with it — and
 * `"constructor"`, `"toString"` and `"valueOf"` are worse, because they are
 * FUNCTIONS. Those get CALLED with a widget result, return something whose `ok`
 * is `undefined`, and draw a blank error with no message on it.
 *
 * `Object.hasOwn` asks the question that was meant.
 */
function archetypeRenderer(archetype: string): ArchetypeRenderer | undefined {
  return Object.hasOwn(ARCHETYPE_BODIES, archetype)
    ? ARCHETYPE_BODIES[archetype as WidgetArchetype]
    : undefined;
}

/**
 * Whether core can draw this archetype from a result in this release.
 *
 * Exported so `resolve-widgets` can ask the question rather than answer it
 * again. It decides whether a widget that ALSO shipped a component should be
 * drawn from that component instead, and the honest input to that decision is
 * the table above -- not a second list that has to be remembered when an
 * archetype lands here.
 */
/**
 * Why core cannot draw this DECLARATION, or `undefined` when it can.
 *
 * The question every caller actually has, and the one `coreDrawsArchetype` --
 * "is there an entry in the table?" -- only approximated. An archetype having a
 * renderer says nothing about whether that renderer can draw a particular
 * widget: a `list` needs `select`, and a declaration without one is refused by
 * the same renderer that claims the archetype.
 *
 * Treating those as the same question cost two things. The grid batched a query
 * for a widget that could never be drawn, spending an unprojected read and one
 * of the batch's slots on documents thrown away on arrival. And a widget
 * declared through both channels lost its contributed component -- the
 * fallback fires when core cannot draw, and core reported that it could.
 *
 * `custom` is not asked about here: it is drawn by the plugin, and its
 * declaration is judged where the component is resolved.
 */
export function coreCannotDraw(definition: DeclaredWidget): string | undefined {
  const archetype = definition.archetype;
  if (typeof archetype !== "string" || archetype === "custom") return undefined;

  const renderer = archetypeRenderer(archetype);
  if (!renderer) {
    return `The "${archetype}" widget archetype is not rendered yet.`;
  }

  return renderer.accepts?.(definition);
}

/** Whether core can draw this declaration at all. */
export function coreDraws(definition: DeclaredWidget): boolean {
  return coreCannotDraw(definition) === undefined;
}

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

  // Everything knowable WITHOUT a payload, decided first: an archetype with no
  // renderer, and a declaration the renderer refuses. Both are settled before
  // the slot is consulted, so a card that can never be drawn says why on the
  // first render instead of waiting for a request the grid does not make.
  const refusal = coreCannotDraw(definition);
  if (refusal !== undefined) return { state: "failed", message: refusal };

  const renderer = archetypeRenderer(definition.archetype);
  // Unreachable: `coreCannotDraw` returned nothing, which for a non-`custom`
  // archetype means the table held a renderer. Narrowing rather than asserting,
  // so a future archetype that answers differently cannot walk past this.
  if (!renderer) {
    return {
      state: "failed",
      message: `The "${definition.archetype}" widget archetype is not rendered yet.`,
    };
  }

  // A DECLARED archetype is drawn before the slot logic is reached, because no
  // slot is ever coming for it. `text` and `actions` are queryless by core's
  // own contract -- the registry validator refuses a query on them -- so they
  // never enter the batch. Reading that absence below as "in flight" or as
  // "drawn from a query and declaring none" is right for every data archetype
  // and would have been permanently wrong for these two: the first body
  // registered for one would have failed on every render.
  if (renderer.declared) {
    const drawn = renderer.declared(definition);
    return drawn.ok
      ? { state: "ready", node: drawn.node }
      : { state: "failed", message: drawn.message };
  }

  if (!renderer.body) {
    // A renderer with neither kind of body is a table entry nobody finished.
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

  const drawn = renderer.body(slot.result, definition);
  return drawn.ok
    ? { state: "ready", node: drawn.node }
    : { state: "failed", message: drawn.message };
}
