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
import {
  displayDataProblem,
  isCoreDisplay,
  type CoreDisplay,
} from "./displays";
import { transportableProblem } from "./transportable";

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
