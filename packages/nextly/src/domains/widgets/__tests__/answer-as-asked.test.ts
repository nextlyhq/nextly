/**
 * A source's answer is accepted only as the kind of answer its query asked for. A resolver is
 * plugin code, so its answer's op is checked on the value, and core's own `data` result, which
 * no query asks for, is never accepted from one.
 */
import { describe, expect, it } from "vitest";

import { answerAsAsked } from "../answer-as-asked";
import type { WidgetQuery } from "../query";

const asked: WidgetQuery = { source: "plugin:acme/orders", op: "count" };

function refusal(answer: unknown): unknown {
  try {
    answerAsAsked(asked, answer);
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("a source's answer, held to what was asked", () => {
  it("is accepted as it is when it answers the op asked", () => {
    const answer = { op: "count", total: 4 };
    expect(answerAsAsked(asked, answer)).toBe(answer);
  });

  it("is refused when it answers another op, naming both for the operator only", () => {
    expect(refusal({ op: "list", items: [] })).toMatchObject({
      code: "INTERNAL_ERROR",
      publicMessage: "An unexpected error occurred.",
      logContext: {
        reason: "widget-resolver-answered-another-op",
        source: "plugin:acme/orders",
        asked: "count",
        answered: "list",
      },
    });
  });

  it("never accepts core's own data result from a source, which no query asks for", () => {
    expect(refusal({ op: "data", data: { secret: 1 } })).toMatchObject({
      code: "INTERNAL_ERROR",
      logContext: { answered: "data" },
    });
  });

  it("refuses an answer that is not an answer at all", () => {
    for (const answer of [undefined, null, 3, "count"]) {
      expect(refusal(answer), String(answer)).toMatchObject({
        code: "INTERNAL_ERROR",
      });
    }
  });
});
