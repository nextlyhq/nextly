/**
 * Which transient widgets survive, given what the host answered.
 *
 * The two decisions are asked directly rather than through the database read
 * behind them: what a set of widgets ASKS about, and which of them to keep once
 * the answers are in. A test that stood up a install to observe the same two
 * would be slower and would confirm the read rather than the rule.
 *
 * The layout read's composition of the two is asked the same way, with the
 * probe replaced so a case can state what the count answered -- including a
 * count that FAILED, which a real install cannot be made to produce on demand.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ReadCaller } from "../../../services/dashboard/readable-resources";
import {
  conditionsNeeded,
  layoutConditions,
  widgetsHeldByVerdict,
} from "../conditions";
import type { WidgetCondition } from "../lifecycle";

const hasContent = vi.hoisted(() => vi.fn());

// Only `content:empty` is asked of the probe here. Every other read rejects, so
// a condition that reached one would have no verdict rather than an answer this
// file never stated.
vi.mock("../condition-probe", () => {
  const unexpected = () => Promise.reject(new Error("not asked in this file"));
  return {
    conditionProbe: (caller: unknown) => ({
      caller,
      hasContent,
      readableSlugs: unexpected,
      readableSingles: unexpected,
      mayCreateEntry: unexpected,
      mayCreateCollection: unexpected,
    }),
  };
});

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
  visibleWhen?: string | readonly string[];
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
      conditionsNeeded([{ ...transient, visibleWhen: "billing:overdue" }]).size
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
    const unknown = { ...transient, visibleWhen: "billing:overdue" };
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
      [permanent, transient, { ...other, visibleWhen: "billing:overdue" }],
      verdict(true)
    );
    expect(mixed.map(w => w.id)).toEqual([permanent.id, transient.id]);
  });

  it("keeps a card naming SEVERAL conditions only while every one holds", () => {
    // 🔴 ANDed, not any. The case this exists for is a card offered while the
    // install is empty AND its offer is unanswered: under "any", declining the
    // offer would leave the card showing on the strength of emptiness, which is
    // the behaviour the list was added to remove.
    const pair: Card = {
      id: "core/seed",
      lifecycle: "conditional",
      visibleWhen: ["content:empty", "seed:unanswered"],
    };
    const verdicts = (
      empty: boolean,
      unanswered: boolean
    ): ReadonlyMap<WidgetCondition, boolean> =>
      new Map([
        ["content:empty", empty],
        ["seed:unanswered", unanswered],
      ] as const);

    expect(widgetsHeldByVerdict([pair], verdicts(true, true))).toEqual([pair]);
    expect(widgetsHeldByVerdict([pair], verdicts(true, false))).toEqual([]);
    expect(widgetsHeldByVerdict([pair], verdicts(false, true))).toEqual([]);
    expect(widgetsHeldByVerdict([pair], verdicts(false, false))).toEqual([]);
  });

  it("hides a card whose list holds one condition nobody answered", () => {
    // Fail closed, per member. One answered condition does not carry a card
    // whose other condition went unevaluated.
    const pair: Card = {
      id: "core/seed",
      lifecycle: "conditional",
      visibleWhen: ["content:empty", "seed:unanswered"],
    };
    expect(
      widgetsHeldByVerdict([pair], new Map([["content:empty", true]]))
    ).toEqual([]);
  });

  it("hides a card that names an EMPTY list", () => {
    // Registration refuses it, so arriving here means a declaration that got
    // past validation another way -- and a conditional card with no rule is one
    // that shows always, which is what the lifecycle exists to stop.
    const empty: Card = {
      id: "core/none",
      lifecycle: "conditional",
      visibleWhen: [],
    };
    expect(widgetsHeldByVerdict([empty], verdict(true))).toEqual([]);
  });

  it("asks once for a condition two cards share through different shapes", () => {
    // One card names it alone, the other inside a list. A set keyed on the NAME
    // is what makes that one evaluation rather than two.
    const needed = conditionsNeeded<Card>([
      { id: "a", lifecycle: "conditional", visibleWhen: "content:empty" },
      {
        id: "b",
        lifecycle: "conditional",
        visibleWhen: ["content:empty", "seed:unanswered"],
      },
    ]);
    expect([...needed].sort()).toEqual(["content:empty", "seed:unanswered"]);
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

describe("what the layout read learns", () => {
  const reader: ReadCaller = { user: { id: "user-1", roles: ["editor"] } };

  beforeEach(() => {
    hasContent.mockReset();
  });

  it("asks whether the reader has content even when no widget names it", async () => {
    hasContent.mockResolvedValue(false);

    const result = await layoutConditions([permanent], reader);

    expect(result.contentEmpty).toBe(true);
    expect(result.widgets).toEqual([permanent]);
    expect(hasContent).toHaveBeenCalledTimes(1);
  });

  it("reports content once the reader can see a row", async () => {
    hasContent.mockResolvedValue(true);

    const result = await layoutConditions([permanent], reader);

    expect(result.contentEmpty).toBe(false);
  });

  it("does not call an install empty because the count FAILED", async () => {
    // The empty state is drawn in place of every card, so it may only follow
    // an answer. A failed count read as empty would blank a full dashboard.
    hasContent.mockRejectedValue(new Error("count failed"));

    const result = await layoutConditions([permanent, transient], reader);

    expect(result.contentEmpty).toBe(false);
    // The same missing verdict hides the card that named the condition, so
    // one failure is not read two ways.
    expect(result.widgets).toEqual([permanent]);
  });

  it("answers the dashboard and a card naming the condition from ONE count", async () => {
    // Two counts could straddle the reader's first entry and disagree: the
    // empty state drawn while the card that shows only on an empty install
    // has been dropped, or the reverse.
    hasContent.mockResolvedValue(false);

    const result = await layoutConditions([permanent, transient], reader);

    expect(result.contentEmpty).toBe(true);
    expect(result.widgets).toEqual([permanent, transient]);
    expect(hasContent).toHaveBeenCalledTimes(1);
  });
});
