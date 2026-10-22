/**
 * A source's answer, held to the question it was asked.
 *
 * @module domains/widgets/answer-as-asked
 */
import { NextlyError } from "../../errors/nextly-error";

import type { WidgetQuery } from "./query";
import type { WidgetResult } from "./result";

/**
 * A resolver's answer, accepted only when it answers the op it was asked.
 *
 * 🔴 The admin draws a card by its answer's op, so an answer of another kind
 * would be drawn as something it is not -- and core's own `data` result, which
 * no query asks for, would let a resolver hand a card raw data no display's
 * shape was checked against. Checked on the value, because a resolver is
 * plugin code and its answer's shape is a promise, not a type the host holds.
 * A developer's mistake, so an internal error: the reader sees the generic
 * sentence and the log names the source and both ops.
 */
export function answerAsAsked(
  query: WidgetQuery,
  answer: unknown
): WidgetResult {
  const op: unknown =
    typeof answer === "object" && answer !== null
      ? (answer as { op?: unknown }).op
      : undefined;
  if (op === query.op) return answer as WidgetResult;
  throw NextlyError.internal({
    logContext: {
      reason: "widget-resolver-answered-another-op",
      source: query.source,
      asked: query.op,
      answered: typeof op === "string" ? op : typeof answer,
    },
  });
}
