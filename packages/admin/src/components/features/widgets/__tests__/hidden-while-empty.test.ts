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
  it("are the first answer's, held for the visit whatever a later read says", () => {
    const { result, rerender } = renderHook(
      ({ layout }) => useHiddenWhileEmptyAtFirstPaint(layout),
      {
        initialProps: {
          layout: answer(["core/needs-attention"]) as
            | DashboardLayoutResponse
            | undefined,
        },
      }
    );
    expect([...result.current]).toEqual(["core/needs-attention"]);

    // An item arrived and the layout was read again: the card does not join
    // the page mid-view, which would move every card after it.
    rerender({ layout: answer([]) });
    expect([...result.current]).toEqual(["core/needs-attention"]);
  });

  it("are none for a dashboard drawn before any answer, and stay so when one arrives", () => {
    const { result, rerender } = renderHook(
      ({ layout }) => useHiddenWhileEmptyAtFirstPaint(layout),
      {
        initialProps: {
          layout: undefined as DashboardLayoutResponse | undefined,
        },
      }
    );
    expect(result.current.size).toBe(0);

    // The cards are already drawn: an answer that arrives later moves none.
    rerender({ layout: answer(["core/needs-attention"]) });
    expect(result.current.size).toBe(0);
  });

  it("are none for a server that predates the verdict", () => {
    const { result } = renderHook(() =>
      useHiddenWhileEmptyAtFirstPaint(answer())
    );
    expect(result.current.size).toBe(0);
  });
});
