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
 * Every card is a widget declared with `defineWidget`, answered on the server
 * from its declaration's `load`: a `custom` card is drawn by its own component
 * with that answer, and every other archetype by the body below for it.
 *
 * The grid and the renderer each call this, so a body runs twice per render.
 * That is deliberate and it is the cheap half of the trade: a body returns an
 * element it does not mount, while the alternative — the grid counting
 * something adjacent — is the defect above.
 *
 * @module components/features/widgets/outcome
 */

import { noSettingChosen, settingInSentence } from "nextly/widget-result";
import type { ReactNode } from "react";

import type { RegisteredWidgetMeta } from "@admin/types/branding";
import type {
  DashboardWidget,
  WidgetSlot,
} from "@admin/types/dashboard/widgets";

import { barsBody } from "./archetypes/bars";
import { listBody } from "./archetypes/list";
import { metricBody } from "./archetypes/metric";
import { tableBody } from "./archetypes/table";
import { timeseriesBody } from "./archetypes/timeseries";
import type { ArchetypeBody, ArchetypeOutcome } from "./archetypes/types";
import { EMPTY_DEFAULT, type CardEmptyContent } from "./frame/states";

/** An archetype a published widget names. */
type Archetype = RegisteredWidgetMeta["archetype"];

/**
 * The archetypes core draws from a card's answer.
 *
 * Partial on purpose: an archetype with no entry is one this release does not
 * render, and the card says so by name rather than coming up blank. `custom`
 * is deliberately absent — it is drawn by the widget's own component.
 */
const ARCHETYPE_BODIES: Partial<Record<Archetype, ArchetypeBody>> = {
  metric: metricBody,
  list: listBody,
  table: tableBody,
  bars: barsBody,
  timeseries: timeseriesBody,
};

/**
 * The body for an archetype, or `undefined` — by OWN property only.
 *
 * `ARCHETYPE_BODIES[archetype]` is not this question, and the difference is
 * reachable. The archetype arrives over the wire from a plugin that may be
 * JavaScript or built against a newer core, and boot deliberately accepts a
 * name this release does not know so one unknown card cannot abort the install.
 * A plain object answers for every name on `Object.prototype` as well as its
 * own: `"__proto__"` returns an object, so the body looked present and then
 * threw "body is not a function", taking the whole grid down with it — and
 * `"constructor"`, `"toString"` and `"valueOf"` are worse, because they are
 * FUNCTIONS. Those get CALLED with a widget result, return something whose `ok`
 * is `undefined`, and draw a blank error with no message on it.
 *
 * `Object.hasOwn` asks the question that was meant.
 */
function archetypeBody(archetype: string): ArchetypeBody | undefined {
  return Object.hasOwn(ARCHETYPE_BODIES, archetype)
    ? ARCHETYPE_BODIES[archetype as Archetype]
    : undefined;
}

/**
 * An empty card's words and action as the outcome decides them: the frame's own action, or the
 * card's settings, which only the card can open and draws as a button where it can
 * (`WidgetRenderer`), and not at all where it cannot.
 */
type OutcomeEmpty = Omit<CardEmptyContent, "action"> & {
  action?: CardEmptyContent["action"] | { label: string; opensSettings: true };
};

/**
 * A card's empty state with its widget's declared one in place of the frame's:
 * the declared message as its title, with no detail of the frame's beneath it,
 * and the declared action as its one action. The frame's or the body's own,
 * as it is, for a widget that declares none.
 */
function emptyFor(
  definition: DashboardWidget,
  own: OutcomeEmpty = EMPTY_DEFAULT
): OutcomeEmpty {
  const declared = definition.declaredEmpty;
  if (declared === undefined) return own;
  const words = declared.title === undefined ? own : { title: declared.title };
  return declared.action === undefined
    ? words
    : { ...words, action: declared.action };
}

/**
 * What the card is about to be, as cases the grid can count and the renderer
 * can draw. Every one is decided from the card's answer, so the grid counts
 * exactly what is on screen.
 */
export type WidgetOutcome =
  // A `custom` card, drawn by its widget's own component with its data: the
  // frame draws every other state, and the component this one.
  | { state: "answered"; data: unknown }
  | { state: "loading" }
  | { state: "failed"; message: string }
  // The source is forbidden, gone, or kept off the dashboard: one state for all three.
  | { state: "unavailable" }
  // The widget's own `shows` said no for this person: left out of their dashboard, neither drawn
  // nor counted; customise mode still shows it, marked, so it can be removed.
  | { state: "not-shown" }
  | { state: "empty"; empty: OutcomeEmpty }
  | { state: "ready"; node: ReactNode };

/** An archetype's own answer, as the grid's outcome. */
function asOutcome(drawn: ArchetypeOutcome): WidgetOutcome {
  if (!drawn.ok) return { state: "failed", message: drawn.message };
  return drawn.empty !== undefined
    ? { state: "empty", empty: drawn.empty }
    : { state: "ready", node: drawn.node };
}

/**
 * What a card missing a setting says, with the one step that fixes it: its own settings, opened
 * on their first field. The button is drawn only where the card can open them
 * (`WidgetRenderer`); elsewhere its words are drawn as the detail line, so the card still says
 * where the setting is chosen.
 */
function needsSettingEmpty(setting: string): OutcomeEmpty {
  return {
    // Says what is missing; the button beside it says how to fix it, so the two never repeat.
    title: noSettingChosen(setting),
    action: {
      label: `Choose ${settingInSentence(setting)}`,
      opensSettings: true,
    },
  };
}

/**
 * A slot with no data as the grid's outcome: one code marks every "not available", a card whose
 * widget needs a setting asks for it as its empty state, and one its widget does not show for
 * this person is left out. Only the rest are failures.
 */
function slotFailure(slot: Extract<WidgetSlot, { ok: false }>): WidgetOutcome {
  switch (slot.code) {
    case "unavailable":
      return { state: "unavailable" };
    case "needs-setting":
      return { state: "empty", empty: needsSettingEmpty(slot.setting) };
    case "not-shown":
      return { state: "not-shown" };
    default:
      return { state: "failed", message: slot.error };
  }
}

/**
 * A `custom` card, drawn by its widget's own component: core builds its data,
 * so the frame draws loading, no permission and error as for any card, and the
 * component is called only once there is data (`WidgetProps`).
 *
 * Its data is what the declaration types it as: a data function's answer,
 * carried as an `op: "data"` result and unwrapped here, or, for a widget
 * whose data is `{ query }`, the query's own answer as it is, a count, a list
 * or a grouped result (`QueryAnswer`).
 */
function declaredComponentOutcome(slot: WidgetSlot | undefined): WidgetOutcome {
  if (!slot) return { state: "loading" };
  if (!slot.ok) return slotFailure(slot);
  return {
    state: "answered",
    data: slot.result.op === "data" ? slot.result.data : slot.result,
  };
}

export function resolveWidgetOutcome(
  definition: DashboardWidget,
  slot: WidgetSlot | undefined
): WidgetOutcome {
  // A declared widget's empty test held: the frame draws its empty state, the
  // widget's own words in place of its own, whatever draws the card when it
  // has something to show -- its own component included.
  if (slot?.ok === true && slot.empty === true) {
    return { state: "empty", empty: emptyFor(definition) };
  }

  // Every `custom` card is drawn by its widget's own component, handed the
  // answer its `load` gave.
  if (definition.archetype === "custom") return declaredComponentOutcome(slot);

  // An archetype with no body is settled before the slot is consulted, so a
  // card that can never be drawn says why on the first render instead of
  // waiting for an answer it cannot use.
  const body = archetypeBody(definition.archetype);
  if (!body) {
    return {
      state: "failed",
      message: `The "${definition.archetype}" widget archetype is not rendered yet.`,
    };
  }

  // Absent means IN FLIGHT: every card is asked for by its id, so an answer
  // is on its way for each one the batch holds.
  if (!slot) return { state: "loading" };

  if (!slot.ok) return slotFailure(slot);

  const drawn = asOutcome(body(slot.result, definition));
  // A display that finds nothing in its answer draws its empty state with the
  // widget's declared one in place of its own, as the server's verdict does.
  return drawn.state === "empty"
    ? { state: "empty", empty: emptyFor(definition, drawn.empty) }
    : drawn;
}
