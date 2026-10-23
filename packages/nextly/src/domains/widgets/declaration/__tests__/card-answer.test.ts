/**
 * The one rule a card's data is held to: it reaches the browser as itself, and a core display's
 * data has the shape that display draws, checked in that order.
 */
import { describe, expect, it } from "vitest";

import { cardAnswerProblem, cardAnswerResult } from "../card-answer";

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

describe("a data function's answer as its card's slot carries it", () => {
  it("is the result of the one op a core display draws", () => {
    expect(cardAnswerResult("metric", { total: 3 }, "acme/orders")).toEqual({
      op: "count",
      total: 3,
    });
    expect(
      cardAnswerResult("list", { items: [{ id: "a" }] }, "acme/orders")
    ).toEqual({ op: "list", items: [{ id: "a" }] });
  });

  it("keeps core's op when the authored data carries one of its own", () => {
    // A display's schema checks the fields it reads and lets others through,
    // so an `op` in the data reaches the result. Core's must win: a metric's
    // answer read as a list has no items, and the card would draw it unreadable.
    expect(
      cardAnswerResult("metric", { total: 3, op: "list" }, "acme/orders")
    ).toEqual({ op: "count", total: 3 });
  });

  it("is core's data result for a widget's own component, carrying the value as it is", () => {
    const value = { anything: ["goes", 1, null] };
    expect(
      cardAnswerResult({ component: "acme/orders#Card" }, value, "acme/orders")
    ).toEqual({ op: "data", data: value });
  });

  it("fails this card alone when refused, naming the widget and the problem for the log only", () => {
    let refused: unknown;
    try {
      cardAnswerResult("metric", { total: "a secret" }, "acme/orders");
    } catch (error) {
      refused = error;
    }
    expect(refused).toMatchObject({
      code: "INTERNAL_ERROR",
      publicMessage: "An unexpected error occurred.",
      logContext: {
        reason: "widget-data-answer-refused",
        widget: "acme/orders",
        kind: "shape",
      },
    });
    // What the function answered stays out of what the reader is told.
    expect(
      JSON.stringify({
        message: (refused as { publicMessage?: string }).publicMessage,
      })
    ).not.toContain("a secret");
  });
});
