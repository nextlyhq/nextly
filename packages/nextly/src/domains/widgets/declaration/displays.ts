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

import { z } from "zod";

import { TIMESERIES_INTERVALS } from "../../collections/query/timeseries-interval";
import {
  ARCHETYPE_OPS,
  DATA_ARCHETYPES,
  type DataWidgetArchetype,
} from "../definition";
import type { WidgetResult } from "../result";
import { WIDGET_SOURCE_FIELD_TYPES, type WidgetOp } from "../sources";

import { quote } from "./quote";

/**
 * Core's displays that draw data: today's data archetypes, so a display is a
 * way of drawing that already exists rather than a new vocabulary.
 */
export const CORE_DISPLAYS = DATA_ARCHETYPES;

/** One of core's displays that draws data. */
export type CoreDisplay = DataWidgetArchetype;

/** Whether a value names one of core's displays. */
export const isCoreDisplay = (value: unknown): value is CoreDisplay =>
  typeof value === "string" &&
  (CORE_DISPLAYS as readonly string[]).includes(value);

/**
 * Why a core display cannot draw what a query with this op answers, or
 * `undefined` when it can: the run-time half of {@link DisplayOp}, read from
 * the same table, for a declaration no type checked.
 */
export function displayOpProblem(
  display: CoreDisplay,
  op: unknown
): string | undefined {
  const ops: readonly string[] = ARCHETYPE_OPS[display];
  return typeof op === "string" && ops.includes(op)
    ? undefined
    : `its query's operation ${quote(op)} is not one the "${display}" display draws (${ops.join(", ")})`;
}

/**
 * Why a core display that draws rows has nothing to draw in each, or
 * `undefined` when it does: the run-time half of the type requiring a row
 * display's query to select a field (`QueryRequires` in `define-widget.ts`).
 *
 * A row display is one whose query answers a list, read from the same table
 * as {@link displayOpProblem}, so the two checks cannot disagree about which
 * displays draw rows. A list or table whose query selects nothing is refused
 * where it is drawn; for a plain JavaScript declaration no type saw, startup
 * says so first, to the author.
 */
export function displaySelectProblem(
  display: CoreDisplay,
  select: unknown
): string | undefined {
  const ops: readonly string[] = ARCHETYPE_OPS[display];
  if (!ops.includes("list")) return undefined;
  return Array.isArray(select) && select.length > 0
    ? undefined
    : `its query selects no fields, so the "${display}" display has nothing to show in each row`;
}

/**
 * Why a declared widget's display cannot draw its query, or `undefined` when
 * it can: the operation and the selection, judged together.
 *
 * One check for both places a declared query is built, at startup from the
 * starting settings and for each card from its own, so a query is never
 * accepted by one and refused by the other. A component display draws
 * whatever its component does, so only a core display is judged.
 */
export function declaredQueryProblem(
  display: unknown,
  query: { readonly op?: unknown; readonly select?: unknown }
): string | undefined {
  if (!isCoreDisplay(display)) return undefined;
  return (
    displayOpProblem(display, query.op) ??
    displaySelectProblem(display, query.select)
  );
}

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

/**
 * The data each core display draws, as a check that runs.
 *
 * The types above say this to a TypeScript author. These say it to everything
 * else: a declaration written in plain JavaScript, whose example startup checks,
 * and a data function's answer, which the card checks before drawing it. `zod`,
 * because both are outside input at the point they are read.
 *
 * Loose about extra keys, as the types are: a query's answer carries `op`, and
 * an answer may carry what the display does not draw.
 */
const ROW = z.record(z.string(), z.unknown());

/**
 * A list's column, or a grouped answer's field, as `WidgetResultField` declares it. A choice's
 * label is what a cell or a bar shows in place of the stored value, so an empty one is refused
 * as source registration refuses it.
 */
const RESULT_FIELD = z.looseObject({
  name: z.string(),
  label: z.string().optional(),
  type: z.enum(WIDGET_SOURCE_FIELD_TYPES).optional(),
  choices: z
    .array(
      z.looseObject({ value: z.string(), label: z.string().trim().min(1) })
    )
    .optional(),
});

/**
 * A list's rows and, when the query selected them, its columns: the admin's
 * table heads and formats each column from `fields`, so a malformed one would
 * break the card it was accepted for.
 */
const LIST_DATA = z.looseObject({
  items: z.array(ROW),
  fields: z.array(RESULT_FIELD).optional(),
});

const DISPLAY_DATA_SCHEMAS: Record<CoreDisplay, z.ZodType> = {
  metric: z.looseObject({
    total: z.number().finite(),
    atLeast: z.boolean().optional(),
  }),
  list: LIST_DATA,
  table: LIST_DATA,
  bars: z.looseObject({
    buckets: z.array(
      z.looseObject({
        value: z.string().nullable(),
        count: z.number().finite(),
      })
    ),
    truncated: z.boolean().optional(),
    // The grouped field, whose choices name each bucket's value.
    field: RESULT_FIELD.optional(),
    // The bucket counts are floors, as a count's `atLeast` says its total is.
    atLeast: z.boolean().optional(),
  }),
  timeseries: z.looseObject({
    points: z.array(
      z.looseObject({ start: z.string(), count: z.number().finite() })
    ),
    interval: z.enum(TIMESERIES_INTERVALS),
  }),
};

/**
 * Why `value` is not data the display draws, or `undefined` when it is.
 *
 * Names the first place the shape differs, as a path, so the message says
 * where to look: `buckets.0.count: expected a number`.
 */
export function displayDataProblem(
  display: CoreDisplay,
  value: unknown
): string | undefined {
  const parsed = DISPLAY_DATA_SCHEMAS[display].safeParse(value);
  if (parsed.success) return undefined;
  const issue = parsed.error.issues[0];
  const where = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
  return `${where}${issue.message}`;
}
