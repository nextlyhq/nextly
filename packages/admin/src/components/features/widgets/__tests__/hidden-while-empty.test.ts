import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { DashboardLayoutResponse } from "@admin/types/dashboard/widgets";

import { useHiddenWhileEmptyAtFirstPaint } from "../hidden-while-empty";

/** A layout answer whose read found `hidden` empty. */
function answer(hidden?: string[]): DashboardLayoutResponse {
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
    scope: "tok",
    audience: "aud",
    ...(hidden === undefined ? {} : { hiddenWhileEmpty: hidden }),
  };
}

describe("the cards a dashboard is drawn without while empty", () => {
  function held(first: DashboardLayoutResponse | undefined) {
    return renderHook(({ layout }) => useHiddenWhileEmptyAtFirstPaint(layout), {
      initialProps: { layout: first as DashboardLayoutResponse | undefined },
    });
  }

  it("are the first answer's, and a card a later read finds empty stays shown", () => {
    const { result, rerender } = held(answer([]));
    expect([...result.current.hidden]).toEqual([]);

    // The last item cleared while the reader looked: the card stays, saying
    // nothing is waiting, rather than leaving and moving the cards after it.
    rerender({ layout: answer(["core/needs-attention"]) });
    expect([...result.current.hidden]).toEqual([]);
    expect([...result.current.revealed]).toEqual([]);
  });

  it("show a hidden card a later read finds with something waiting, marked as revealed", () => {
    const { result, rerender } = held(answer(["core/needs-attention"]));
    expect([...result.current.hidden]).toEqual(["core/needs-attention"]);
    expect([...result.current.revealed]).toEqual([]);

    // A return visit's refetch found new work: the card is shown, and says so.
    rerender({ layout: answer([]) });
    expect([...result.current.hidden]).toEqual([]);
    expect([...result.current.revealed]).toEqual(["core/needs-attention"]);

    // Found empty again: once shown it stays shown for the visit.
    rerender({ layout: answer(["core/needs-attention"]) });
    expect([...result.current.hidden]).toEqual([]);
  });

  it("are none for a dashboard drawn before any answer, and none join when one arrives", () => {
    const { result, rerender } = held(undefined);
    expect(result.current.hidden.size).toBe(0);

    rerender({ layout: answer(["core/needs-attention"]) });
    expect(result.current.hidden.size).toBe(0);
  });

  it("are none for a server that predates the verdict", () => {
    const { result } = held(answer());
    expect(result.current.hidden.size).toBe(0);
  });
});
