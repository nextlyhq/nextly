/**
 * Core's displays, and the shape of data each one draws.
 *
 * A widget either names one of these, and core draws it, or names a component
 * of its own. Naming one is a promise about the data: a `bars` card drawn from
 * a single number has nothing to draw. Stating each display's shape as a type
 * turns that mismatch into a compile error in the declaration, where it was
 * made, rather than an error card on every load.
 *
 * @module domains/widgets/declaration/displays
 */

import { DATA_ARCHETYPES, type DataWidgetArchetype } from "../definition";
import type { WidgetResult } from "../result";
import type { WidgetOp } from "../sources";

/**
 * Core's displays that draw data: today's data archetypes, so a display is a
 * way of drawing that already exists rather than a new vocabulary.
 */
export const CORE_DISPLAYS = DATA_ARCHETYPES;

/** One of core's displays that draws data. */
export type CoreDisplay = DataWidgetArchetype;

/**
 * Requires a table to name every core display, each with an op.
 *
 * A bound rather than an annotation, so the table keeps its literal ops: a
 * display left out, or an op that does not exist, fails the bound.
 */
type EveryDisplay<T extends Record<CoreDisplay, WidgetOp>> = T;

/**
 * Which query answer each display draws.
 *
 * 🔴 The same pairing the registry checks at startup (`ARCHETYPE_RESULTS` in
 * `definition.ts`). There it is a runtime map, here a type; one should be
 * read from the other once both exist in one implementation, so the
 * compile-time check and the startup check cannot disagree.
 */
type DisplayAnswers = EveryDisplay<{
  metric: "count";
  list: "list";
  table: "list";
  bars: "groupBy";
  timeseries: "timeseries";
}>;

/** The op of the query whose answer a display draws. */
export type DisplayOp<D extends CoreDisplay> = DisplayAnswers[D];

/**
 * What a query with this op answers, as core sends it.
 *
 * The wire shape, `op` included: a query core runs answers this whole.
 */
export type QueryAnswer<Op extends WidgetOp> = Extract<
  WidgetResult,
  { op: Op }
>;

/**
 * The data a display draws.
 *
 * 🔴 DERIVED from `WidgetResult` rather than restated, so a field core adds to
 * a query's answer reaches the display's contract with no second edit. `op` is
 * left out: it is how the wire tells answers apart, and a data function that
 * already names its display has nothing to tell apart. A query's answer still
 * carries it, and an extra property is no mismatch, so the answer of a `list`
 * query is data the `list` display draws.
 */
export type DisplayData<D extends CoreDisplay> = Omit<
  QueryAnswer<DisplayOp<D>>,
  "op"
>;

/**
 * A component of the widget's own, named by where the admin can load it.
 *
 * A string rather than the component itself, because the declaration lives in
 * server code and the component in the admin's bundle. The component reaches
 * its types through `import type` of the declaration; nothing here imports it.
 */
export interface ComponentDisplay {
  component: string;
}

/** How a widget is displayed. */
export type WidgetDisplay = CoreDisplay | ComponentDisplay;
