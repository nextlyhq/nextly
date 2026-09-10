/**
 * Which transient widgets survive, given what the host answered.
 *
 * The two decisions are asked directly rather than through the database read
 * behind them: what a set of widgets ASKS about, and which of them to keep once
 * the answers are in. A test that stood up a install to observe the same two
 * would be slower and would confirm the read rather than the rule.
 */

import { describe, expect, it } from "vitest";

import { conditionsNeeded, widgetsHeldByVerdict } from "../conditions";
import type { WidgetCondition } from "../lifecycle";

/**
 * The shape the filter actually receives: a canonical widget carries an id and
 * declares the lifecycle fields only when it has them. Named rather than left
 * to inference, because `ConditionalDeclaration` is a weak type — every member
 * optional — and TypeScript refuses an object that shares no property with it,
 * so a bare `{ id }` literal is rejected at the call it is meant to model.
 */
interface Card {
  id: string;
  lifecycle?: string;
  visibleWhen?: string;
}

const permanent: Card = { id: "core/team" };
const transient: Card = {
  id: "core/get-started",
  lifecycle: "conditional",
  visibleWhen: "content:empty",
};

const verdict = (held: boolean): ReadonlyMap<WidgetCondition, boolean> =>
  new Map([["content:empty", held]]);

describe("what a dashboard asks about", () => {
  it("asks nothing when every card is permanent", () => {
    // The property that keeps this free for the ordinary dashboard: an empty
    // set means the evaluator is never called, so no count is issued at all.
    // Observable here as the set; from outside it would only be visible as
    // absent database traffic, which is not something a test can assert.
    expect(conditionsNeeded<Card>([permanent, { id: "core/other" }]).size).toBe(
      0
    );
  });

  it("asks once for a condition two cards share", () => {
    const needed = conditionsNeeded([
      transient,
      { ...transient, id: "core/second" },
    ]);
    expect([...needed]).toEqual(["content:empty"]);
  });

  it("ignores a condition name it cannot evaluate", () => {
    // Registration refuses these, so reaching here means the vocabulary and the
    // evaluators disagree. Asking the host about a name it has no arm for would
    // throw; the card is dropped by the verdict rule below instead.
    expect(
      conditionsNeeded([{ ...transient, visibleWhen: "onboarding:incomplete" }])
        .size
    ).toBe(0);
  });

  it("ignores a condition on a card that never declared the lifecycle", () => {
    expect(
      conditionsNeeded<Card>([{ id: "x", visibleWhen: "content:empty" }]).size
    ).toBe(0);
  });
});

describe("which widgets are kept", () => {
  it("keeps a permanent widget whatever the verdicts say", () => {
    // It never asked, so no answer can remove it.
    expect(widgetsHeldByVerdict([permanent], verdict(false))).toEqual([
      permanent,
    ]);
    expect(widgetsHeldByVerdict([permanent], new Map())).toEqual([permanent]);
  });

  it("keeps a transient widget while its condition holds", () => {
    expect(widgetsHeldByVerdict([transient], verdict(true))).toEqual([
      transient,
    ]);
  });

  it("drops a transient widget once its condition lapses", () => {
    expect(widgetsHeldByVerdict([transient], verdict(false))).toEqual([]);
  });

  it("HIDES a transient widget whose condition nobody answered", () => {
    // 🔴 Fails closed. The other reading -- show it -- turns a disagreement
    // between the vocabulary and the evaluators into a card that shows
    // unconditionally, which is the behaviour this whole mechanism removes.
    expect(widgetsHeldByVerdict([transient], new Map())).toEqual([]);
  });

  it("hides a transient widget naming a condition this host cannot evaluate", () => {
    const unknown = { ...transient, visibleWhen: "onboarding:incomplete" };
    expect(widgetsHeldByVerdict([unknown], verdict(true))).toEqual([]);
  });

  it("decides each card on its own condition, not on the set", () => {
    // Two transient cards under different verdicts: the surviving one must be
    // the one whose condition held. A filter that kept or dropped the whole
    // group would satisfy a single-card test either way.
    const other: Card = {
      id: "core/other-transient",
      lifecycle: "conditional",
      visibleWhen: "content:empty",
    };
    const mixed = widgetsHeldByVerdict(
      [
        permanent,
        transient,
        { ...other, visibleWhen: "onboarding:incomplete" },
      ],
      verdict(true)
    );
    expect(mixed.map(w => w.id)).toEqual([permanent.id, transient.id]);
  });

  it("preserves the order it was given", () => {
    // The caller has already ordered these; a filter that reordered would move
    // cards on the dashboard for reasons no reader could see.
    const list: Card[] = [permanent, transient, { id: "core/third" }];
    expect(widgetsHeldByVerdict(list, verdict(true)).map(w => w.id)).toEqual([
      "core/team",
      "core/get-started",
      "core/third",
    ]);
  });
});
