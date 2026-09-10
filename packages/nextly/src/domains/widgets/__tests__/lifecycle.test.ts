/**
 * What a conditional widget may declare, and what a permanent one may not.
 *
 * The refusals carry the weight here. A field that is meaningless where it was
 * written but ACCEPTED reads as working: an author sets `pin: "top"` on an
 * ordinary card, watches it sit wherever it was dragged, and has nothing
 * telling them the field was never read.
 */

import { describe, expect, it } from "vitest";

import {
  isWidgetCondition,
  lifecycleProblem,
  WIDGET_CONDITIONS,
} from "../lifecycle";

const conditional = (patch: Record<string, unknown> = {}) => ({
  lifecycle: "conditional",
  visibleWhen: "content:empty",
  ...patch,
});

describe("a permanent widget", () => {
  it("declares nothing and is accepted", () => {
    // The default, and the shape every widget shipped before this had.
    expect(lifecycleProblem({})).toBeUndefined();
    expect(lifecycleProblem({ lifecycle: "always" })).toBeUndefined();
  });

  it("may not name a condition it has no lifecycle for", () => {
    const problem = lifecycleProblem({ visibleWhen: "content:empty" });
    expect(problem).toContain("visibleWhen");
    expect(problem).toContain("conditional");
  });
});

describe("a conditional widget", () => {
  it("is accepted with a known condition", () => {
    expect(lifecycleProblem(conditional())).toBeUndefined();
  });

  it("must name the condition it shows under", () => {
    // Without one there is nothing to evaluate, and the honest reading of a
    // missing condition is not "always show" -- it is a declaration that never
    // finished.
    const problem = lifecycleProblem({ lifecycle: "conditional" });
    expect(problem).toContain("visibleWhen");
  });

  it("is refused for a condition this host cannot evaluate", () => {
    // 🔴 The structural defence. A name this file does not know is refused at
    // registration, where the author can still be told -- rather than at
    // render, where an unknown condition would simply never hold and the card
    // would read as broken.
    const problem = lifecycleProblem(
      conditional({ visibleWhen: "billing:overdue" })
    );
    expect(problem).toContain("visibleWhen");
    // The known set is NAMED, because a mistyped condition and one this
    // release does not carry need different next steps and the message cannot
    // tell them apart.
    for (const known of WIDGET_CONDITIONS) {
      expect(problem).toContain(known);
    }
  });

  it("names a value it cannot print, rather than throwing while refusing", () => {
    // 🔴 `JSON.stringify` throws a native TypeError on a BigInt and on a cyclic
    // object. This string is built while composing a REFUSAL, so the throw
    // would escape before the refusal became a developer-facing error -- the
    // message that exists to help an author replaced by a crash from the code
    // writing it.
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    for (const value of [1n, cyclic, Symbol("x")]) {
      expect(() =>
        lifecycleProblem(conditional({ visibleWhen: value }))
      ).not.toThrow();
      expect(lifecycleProblem(conditional({ visibleWhen: value }))).toContain(
        "visibleWhen"
      );
    }
  });

  it("refuses a condition that is not a string at all", () => {
    for (const value of [0, false, null, {}, ["content:empty"]]) {
      expect(lifecycleProblem(conditional({ visibleWhen: value }))).toContain(
        "visibleWhen"
      );
    }
  });
});

describe("an unknown lifecycle", () => {
  it("is refused rather than treated as permanent", () => {
    // Falling back to `always` would place a card whose author asked for
    // something else, and say nothing.
    const problem = lifecycleProblem({ lifecycle: "transient" });
    expect(problem).toContain("lifecycle");
    expect(problem).toContain("conditional");
  });
});

describe("the condition vocabulary", () => {
  it("recognises exactly what it publishes", () => {
    // DERIVED from the exported set rather than listed again here: a hand-copy
    // agrees on the day it is written and stops agreeing the day a condition
    // is added, while both look correct.
    for (const condition of WIDGET_CONDITIONS) {
      expect(isWidgetCondition(condition)).toBe(true);
    }
  });

  it("recognises nothing else, including a near miss", () => {
    for (const value of ["content:Empty", "content", "", undefined, 1]) {
      expect(isWidgetCondition(value)).toBe(false);
    }
  });
});
