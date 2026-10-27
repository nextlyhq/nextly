/**
 * Whether the Get started card is drawn, and with what: decided from the step
 * answer and the card's own settings, after the reader's row is read.
 */
import { describe, expect, it, vi } from "vitest";

import type { ConditionProbe } from "../condition-probe";
import {
  getStartedDrawn,
  getStartedView,
  withoutDormantCard,
} from "../get-started-card";
import type { GetStartedAnswer, GetStartedStep } from "../get-started-steps";
import type { WidgetPlacement } from "../layout";

const step = (
  key: string,
  status: GetStartedStep["status"],
  kind: GetStartedStep["kind"] = "invite"
): GetStartedStep => ({ key, kind, status });

function answerOf(steps: GetStartedStep[], unknown = false): GetStartedAnswer {
  return {
    unknown,
    steps,
    done: steps.filter(s => s.status === "done" || s.status === "skipped")
      .length,
    total: steps.length,
  };
}

const FINISHED = answerOf([step("collection", "done", "collection")]);

const card = (patch: Partial<WidgetPlacement> = {}): WidgetPlacement => ({
  id: "started",
  widgetId: "core/get-started",
  w: 12,
  h: 3,
  removed: false,
  ...patch,
});

function probeAnswering(answer: GetStartedAnswer) {
  const getStarted = vi.fn(async () => answer);
  return {
    getStarted,
    probe: { getStarted } as unknown as ConditionProbe,
  };
}

describe("when the card is drawn", () => {
  it("is drawn while a step is waiting or not known, or setup could not be checked", () => {
    expect(getStartedDrawn(answerOf([step("invite", "open")]), undefined)).toBe(
      true
    );
    expect(
      getStartedDrawn(answerOf([step("invite", "unknown")]), undefined)
    ).toBe(true);
    expect(getStartedDrawn(answerOf([], true), undefined)).toBe(true);
  });

  it('stays to say "You\'re all set" only for a reader who acted on it or skipped a step', () => {
    expect(getStartedDrawn(FINISHED, { acted: true })).toBe(true);
    expect(getStartedDrawn(FINISHED, { skipped: ["invite"] })).toBe(true);
    // Everyone else's finished card goes quietly: every saved row holds one.
    expect(getStartedDrawn(FINISHED, undefined)).toBe(false);
    expect(getStartedDrawn(FINISHED, { acted: "yes", skipped: "invite" })).toBe(
      false
    );
  });
});

describe("the card's view in the layout read", () => {
  it("works out nothing for a reader whose layout holds no card", async () => {
    const { probe, getStarted } = probeAnswering(FINISHED);
    expect(await getStartedView(probe, undefined, true)).toEqual({
      drawn: false,
      answer: null,
    });
    expect(getStarted).not.toHaveBeenCalled();
  });

  it("works out nothing for a removed card unless its answer is asked for", async () => {
    const open = answerOf([step("invite", "open")]);
    const { probe, getStarted } = probeAnswering(open);
    expect(await getStartedView(probe, card({ removed: true }), false)).toEqual(
      { drawn: false, answer: null }
    );
    expect(getStarted).not.toHaveBeenCalled();

    // Asked for as the card is restored: answered, and still not drawn.
    expect(await getStartedView(probe, card({ removed: true }), true)).toEqual({
      drawn: false,
      answer: open,
    });
  });

  it("applies the card's skips before deciding, so a skipped last step leaves it drawn as all set", async () => {
    const { probe } = probeAnswering(answerOf([step("invite", "open")]));
    const view = await getStartedView(
      probe,
      card({ config: { skipped: ["invite"] } }),
      false
    );
    expect(view.answer?.steps).toEqual([step("invite", "skipped")]);
    expect(view.answer?.done).toBe(1);
    expect(view.drawn).toBe(true);
  });
});

describe("a dormant card", () => {
  const others = {
    id: "team",
    widgetId: "core/team",
    w: 4,
    h: 4,
    removed: false,
  } as const;

  it("is left out of what the reader is handed, and a removed one is kept for Removed", () => {
    expect(withoutDormantCard([card(), others], () => false)).toEqual([others]);
    expect(
      withoutDormantCard([card({ removed: true }), others], () => false)
    ).toEqual([card({ removed: true }), others]);
    expect(withoutDormantCard([card(), others], () => true)).toEqual([
      card(),
      others,
    ]);
  });
});
