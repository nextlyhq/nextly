import { renderHook } from "@testing-library/react";
import type { WidgetSlot } from "nextly/widget-result";
import { describe, expect, it } from "vitest";

import type { DashboardLayoutRead } from "@admin/types/dashboard/widgets";

import {
  useHiddenWhileEmptyAtFirstPaint,
  type CardAnswers,
} from "../hidden-while-empty";

/** The dashboard width the answers below are read at, and the dashboard is drawn at. */
const WIDE = 1200;

/**
 * A layout answer whose read, sent the dashboard width `askedAtWidth`, found `hidden` empty, or
 * judged no card when `hidden` is not given; naming `ownAnswer` as the widgets that leave by their
 * own answer.
 */
function answer(
  hidden?: string[],
  ownAnswer?: string[],
  askedAtWidth = WIDE
): DashboardLayoutRead {
  return {
    placements: [
      {
        id: "core/needs-attention",
        widgetId: "core/needs-attention",
        w: 8,
        h: 3,
        removed: false,
      },
      {
        id: "core/quick-create",
        widgetId: "core/quick-create",
        w: 4,
        h: 3,
        removed: false,
      },
    ],
    widgets: {},
    available: [],
    defaultPlacements: [],
    version: 0,
    source: "default",
    arranged: false,
    scope: "tok",
    audience: "aud",
    ...(hidden === undefined ? {} : { hiddenWhileEmpty: hidden }),
    ...(ownAnswer === undefined ? {} : { hiddenWhenAnswerEmpty: ownAnswer }),
    askedAtWidth,
  };
}

describe("the cards a dashboard is drawn without while empty", () => {
  /**
   * The verdict held from `first` on a dashboard `width` wide, re-rendered with each later one;
   * `"unmeasured"` for a dashboard not measured yet (named, since a default parameter would turn
   * an `undefined` passed for it into the default width).
   */
  function held(
    first: DashboardLayoutRead | undefined,
    width: number | "unmeasured" = WIDE
  ) {
    const dashboardWidth: number | undefined =
      width === "unmeasured" ? undefined : width;
    return renderHook(
      ({ layout, dashboardWidth }) =>
        useHiddenWhileEmptyAtFirstPaint(layout, dashboardWidth),
      { initialProps: { layout: first, dashboardWidth } }
    );
  }

  it("are the first answer's, and a card a later read finds empty stays shown", () => {
    const { result, rerender } = held(answer([]));
    expect([...result.current.hidden]).toEqual([]);

    // The last item cleared while the reader looked: the card stays, saying
    // nothing is waiting, rather than leaving and moving the cards after it.
    rerender({
      dashboardWidth: WIDE,
      layout: answer(["core/needs-attention"]),
    });
    expect([...result.current.hidden]).toEqual([]);
    expect([...result.current.revealed]).toEqual([]);
  });

  it("show a hidden card a later read finds with something waiting, marked as revealed", () => {
    const { result, rerender } = held(answer(["core/needs-attention"]));
    expect([...result.current.hidden]).toEqual(["core/needs-attention"]);
    expect([...result.current.revealed]).toEqual([]);

    // A return visit's refetch found new work: the card is shown, and says so.
    rerender({ dashboardWidth: WIDE, layout: answer([]) });
    expect([...result.current.hidden]).toEqual([]);
    expect([...result.current.revealed]).toEqual(["core/needs-attention"]);

    // Found empty again: once shown it stays shown for the visit.
    rerender({
      dashboardWidth: WIDE,
      layout: answer(["core/needs-attention"]),
    });
    expect([...result.current.hidden]).toEqual([]);
  });

  it("are none for a dashboard drawn before any answer, and none join when one arrives", () => {
    const { result, rerender } = held(undefined);
    expect(result.current.hidden.size).toBe(0);

    rerender({
      dashboardWidth: WIDE,
      layout: answer(["core/needs-attention"]),
    });
    expect(result.current.hidden.size).toBe(0);
  });

  it("are none for a server that predates the verdict", () => {
    const { result } = held(answer());
    expect(result.current.hidden.size).toBe(0);
  });

  it("are left as they are by a later answer that judged no card, which reveals none of them", () => {
    const { result, rerender } = held(answer(["core/needs-attention"]));
    // A read sent no dashboard width judges no card: no verdict, not "none
    // empty", so the card it says nothing about stays off the page.
    rerender({ dashboardWidth: WIDE, layout: answer() });
    expect([...result.current.hidden]).toEqual(["core/needs-attention"]);
    expect(result.current.revealed.size).toBe(0);
  });

  it("are the answer's when it was judged at a width that draws every card at the tier this one does", () => {
    // 1210 draws a card of every span at the tier 1200 does: the verdict holds.
    const { result } = held(answer(["core/needs-attention"], [], WIDE), 1210);
    expect([...result.current.hidden]).toEqual(["core/needs-attention"]);
  });

  it("are none for a cached answer judged at a width that draws a card at another tier", () => {
    // Read on a wide dashboard, drawn now on one 500 wide, where the eight-column card is drawn
    // across the dashboard at another tier: what was judged of it there says nothing here.
    const { result, rerender } = held(
      answer(["core/needs-attention"], [], WIDE),
      500
    );
    expect(result.current.hidden.size).toBe(0);
    expect(result.current.revealed.size).toBe(0);

    // The refetch judged at this width finds it empty: shown at first, it stays shown.
    rerender({
      dashboardWidth: 500,
      layout: answer(["core/needs-attention"], [], 500),
    });
    expect(result.current.hidden.size).toBe(0);
  });

  it("are taken once the dashboard has a width, from the answer judged at that width", () => {
    // Drawn before the dashboard was measured: nothing is decided yet.
    const { result, rerender } = held(
      answer(["core/needs-attention"]),
      "unmeasured"
    );
    expect(result.current.hidden.size).toBe(0);

    // Measured, before the first paint: the verdict is taken now, not locked as none.
    rerender({
      dashboardWidth: WIDE,
      layout: answer(["core/needs-attention"]),
    });
    expect([...result.current.hidden]).toEqual(["core/needs-attention"]);
  });

  it("are left as they are by a later answer judged at a width of another tier", () => {
    const { result, rerender } = held(answer(["core/needs-attention"]));
    // Found with something waiting, but judged for a dashboard 500 wide: no verdict here.
    rerender({ dashboardWidth: WIDE, layout: answer([], [], 500) });
    expect([...result.current.hidden]).toEqual(["core/needs-attention"]);
    expect(result.current.revealed.size).toBe(0);
  });

  it("name the widgets whose cards leave by their own answer, as the latest answer names them", () => {
    const { result, rerender } = held(answer([], ["acme/legacy-quiet"]));
    expect([...result.current.hiddenWhenAnswerEmpty]).toEqual([
      "acme/legacy-quiet",
    ]);
    rerender({ dashboardWidth: WIDE, layout: answer([], []) });
    expect(result.current.hiddenWhenAnswerEmpty.size).toBe(0);
  });

  describe("against the cards' own batch answers", () => {
    const CARD = "core/needs-attention";

    /** Needs attention's answer holding `count` items, empty by its own test at none. */
    function slot(count: number): WidgetSlot {
      const items = Array.from({ length: count }, (_, at) => ({
        id: `acme/item-${at}`,
        label: "Item",
      }));
      return {
        ok: true,
        result: { op: "data", data: { items } },
        ...(count === 0 ? { empty: true as const } : {}),
      };
    }

    /** The batch's answers: the card's slot, and whether it is still being asked. */
    function batch(card: WidgetSlot | undefined, asking = false): CardAnswers {
      return {
        slots: card === undefined ? {} : { [CARD]: card },
        fetching: new Set(asking ? [CARD] : []),
      };
    }

    function heldWith(answers: CardAnswers) {
      return renderHook(
        ({ layout, asked }) =>
          useHiddenWhileEmptyAtFirstPaint(layout, WIDE, asked),
        { initialProps: { layout: answer([CARD]), asked: answers } }
      );
    }

    it("shows a card the layout read found empty once its own batch answer holds something, marked as revealed", () => {
      // None waiting when the layout read judged it; the batch has not answered yet.
      const { result, rerender } = heldWith(batch(undefined, true));
      expect([...result.current.hidden]).toEqual([CARD]);

      // Its batch answer, by the same test, holds nothing: still off the page.
      rerender({ layout: answer([CARD]), asked: batch(slot(0)) });
      expect([...result.current.hidden]).toEqual([CARD]);
      expect(result.current.revealed.size).toBe(0);

      // A refetch of the batch finds one item: the card is shown, and says so.
      rerender({ layout: answer([CARD]), asked: batch(slot(1)) });
      expect([...result.current.hidden]).toEqual([]);
      expect([...result.current.revealed]).toEqual([CARD]);

      // Empty again: once shown it stays shown for the visit.
      rerender({ layout: answer([CARD]), asked: batch(slot(0)) });
      expect([...result.current.hidden]).toEqual([]);
    });

    it("judges no answer still being asked, which may be the previous load's", () => {
      // An answer with something, carried from another load while this one asks.
      const { result, rerender } = heldWith(batch(slot(1), true));
      expect([...result.current.hidden]).toEqual([CARD]);

      // Asked and answered empty: the carried answer never showed the card.
      rerender({ layout: answer([CARD]), asked: batch(slot(0)) });
      expect([...result.current.hidden]).toEqual([CARD]);
      expect(result.current.revealed.size).toBe(0);
    });

    it("leaves a card hidden whose batch answer failed", () => {
      const { result } = heldWith(batch({ ok: false, error: "Failed" }));
      expect([...result.current.hidden]).toEqual([CARD]);
    });
  });
});
