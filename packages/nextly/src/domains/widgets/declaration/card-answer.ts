/**
 * Whether a value is fit to be a card's data.
 *
 * Two things must hold, in this order. The value must reach the browser as
 * itself, since the admin draws what JSON carries and nothing else. And when
 * the card is drawn by one of core's displays, the value must have the shape
 * that display draws, or the card would show an error that names nothing the
 * author can fix.
 *
 * 🔴 One rule for every value core is handed as a card's data. A declaration's
 * `example` is checked by it at startup, because the admin draws the example
 * as the card's preview; a value checked one way at startup and another way
 * later would let an example pass that the card itself could never show.
 *
 * @module domains/widgets/declaration/card-answer
 */
import { NextlyError } from "../../../errors/nextly-error";
import { ARCHETYPE_OPS } from "../definition";
import type { WidgetResult } from "../result";

import {
  displayDataProblem,
  isCoreDisplay,
  type CoreDisplay,
} from "./displays";
import { transportableProblem, type TransportableValue } from "./transportable";

/** Why a value cannot be a card's data. */
export type CardAnswerProblem =
  | {
      /** JSON would not carry it as it is; `detail` names where, from "the value". */
      kind: "untransportable";
      detail: string;
    }
  | {
      /** It reaches the browser, but not in the shape `display` draws. */
      kind: "shape";
      display: CoreDisplay;
      detail: string;
    };

/**
 * Why `value` cannot be the data of a card drawn by `display`, or `undefined`
 * when it can.
 *
 * A display that is not one of core's (a widget's own component) draws
 * whatever it is handed, so only the first rule applies to it.
 */
export function cardAnswerProblem(
  display: unknown,
  value: unknown
): CardAnswerProblem | undefined {
  const untransportable = transportableProblem(value);
  if (untransportable !== undefined) {
    return { kind: "untransportable", detail: untransportable };
  }
  if (!isCoreDisplay(display)) return undefined;
  const mismatch = displayDataProblem(display, value);
  return mismatch === undefined
    ? undefined
    : { kind: "shape", display, detail: mismatch };
}

/**
 * A data function's answer as its card's slot carries it, once
 * {@link cardAnswerProblem} accepts it: a core display's answer as the result
 * of the one op that display draws, and a widget's own component's answer as
 * core's `data` result.
 *
 * 🔴 A value the rule refuses fails THIS card alone, as an internal error: the
 * reader sees the generic sentence, and the log names the widget and the
 * problem, since what the function answered is the author's to fix and may
 * hold what the reader should not see.
 */
export function cardAnswerResult(
  display: unknown,
  value: unknown,
  widgetId: string
): WidgetResult {
  const problem = cardAnswerProblem(display, value);
  if (problem !== undefined) {
    throw NextlyError.internal({
      logContext: {
        reason: "widget-data-answer-refused",
        widget: widgetId,
        kind: problem.kind,
        detail: problem.detail,
      },
    });
  }
  if (!isCoreDisplay(display)) {
    // Known to travel as itself by the rule above.
    return { op: "data", data: value as TransportableValue };
  }
  // The discriminator is core's, so it is written after the authored value: a
  // display's schema checks the fields it reads and lets others through, and
  // an authored `op` would otherwise turn a metric's answer into a list's.
  return {
    ...(value as object),
    op: ARCHETYPE_OPS[display][0],
  } as WidgetResult;
}
