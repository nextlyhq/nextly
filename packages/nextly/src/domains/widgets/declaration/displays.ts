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

import {
  type ARCHETYPE_OPS,
  DATA_ARCHETYPES,
  type DataWidgetArchetype,
} from "../definition";
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
 * Which query answer each display draws, read from the table registration
 * checks at startup (`ARCHETYPE_OPS` in `definition.ts`), so the compile-time
 * pairing and the startup check are one table.
 */
type DisplayAnswers = {
  [D in CoreDisplay]: (typeof ARCHETYPE_OPS)[D][number];
};

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
export type DisplayData<D extends CoreDisplay> = AuthoredRows<
  Omit<QueryAnswer<DisplayOp<D>>, "op">
>;

/**
 * A list's rows as an author may write them: any plain object.
 *
 * 🔴 The wire type says `Record<string, unknown>`, and an interface has no
 * implicit index signature, so `interface Row { title: string }` was refused
 * as a row although every value in it is safe. A row only has to be an
 * object here; what JSON carries is checked separately, by the transport
 * bound on the answer. A query's own answer, `Record<string, unknown>` rows
 * included, still fits.
 */
type AuthoredRows<T> = T extends { items: Record<string, unknown>[] }
  ? Omit<T, "items"> & { items: readonly object[] }
  : T;

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
