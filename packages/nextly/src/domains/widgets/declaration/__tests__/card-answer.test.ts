/**
 * The one rule a card's data is held to: it reaches the browser as itself, and a core display's
 * data has the shape that display draws, checked in that order.
 */
import { describe, expect, it } from "vitest";

import { cardAnswerProblem } from "../card-answer";

describe("whether a value can be a card's data", () => {
  it("accepts a value that travels as itself in the shape its display draws", () => {
    expect(cardAnswerProblem("metric", { total: 3 })).toBeUndefined();
    expect(cardAnswerProblem("list", { items: [{ id: "a" }] })).toBeUndefined();
  });

  it("refuses a value JSON would not carry as it is, naming where", () => {
    expect(cardAnswerProblem("list", { items: [{ id: Infinity }] })).toEqual({
      kind: "untransportable",
      detail: "the value.items[0].id is Infinity",
    });
    // An answer of nothing is not data either: JSON has no `undefined` to send.
    expect(cardAnswerProblem("metric", undefined)).toEqual({
      kind: "untransportable",
      detail: "the value is a undefined",
    });
  });

  it("says a value cannot travel before it says its shape is wrong", () => {
    // NaN is both: JSON writes it as `null`, and `metric` draws a finite total. What the author must
    // fix first is that it never arrives, so that is the reason given.
    expect(cardAnswerProblem("metric", { total: NaN })).toEqual({
      kind: "untransportable",
      detail: "the value.total is NaN",
    });
  });

  it("refuses a value in a shape its core display does not draw, naming the display", () => {
    const problem = cardAnswerProblem("metric", { total: "3" });
    expect(problem).toMatchObject({ kind: "shape", display: "metric" });
    expect(problem?.detail).toContain("total");
  });

  it("holds a widget's own component to the first rule only, since it draws what it is handed", () => {
    const own = { component: "acme/orders#Card" };
    expect(cardAnswerProblem(own, { anything: "goes" })).toBeUndefined();
    expect(cardAnswerProblem(own, { at: NaN })).toEqual({
      kind: "untransportable",
      detail: "the value.at is NaN",
    });
  });
});
