/**
 * The browser suite's focus check counts only a mark a reader can see.
 *
 * A control that regresses to `outline: 2px solid transparent` or a
 * transparent ring still has an outline width and a shadow spread; only the
 * colour says nothing is drawn. So the check is held to the real indicators
 * the admin and the builder draw, and to each invisible one.
 */
import { describe, expect, it } from "vitest";

import { focusMarkShown } from "../e2e/tests/support/focus-mark.mjs";

const NONE = {
  outlineStyle: "none",
  outlineWidth: "0px",
  outlineColor: "rgb(0, 0, 0)",
  boxShadow: "none",
};

describe("the browser suite's focus check", () => {
  it.each([
    [
      "a solid outline",
      { ...NONE, outlineStyle: "solid", outlineWidth: "2px" },
    ],
    [
      "an outline in an oklch colour",
      {
        ...NONE,
        outlineStyle: "solid",
        outlineWidth: "2px",
        outlineColor: "oklch(0.55 0.2 270)",
      },
    ],
    [
      "a ring after an offset layer",
      {
        ...NONE,
        boxShadow:
          "rgb(255, 255, 255) 0px 0px 0px 2px, rgb(99, 102, 241) 0px 0px 0px 4px",
      },
    ],
    [
      "a half-transparent ring",
      { ...NONE, boxShadow: "rgba(99, 102, 241, 0.5) 0px 0px 0px 3px" },
    ],
  ])("passes %s", (_name, style) => {
    expect(focusMarkShown(style)).toBe(true);
  });

  it.each([
    ["no outline and no shadow", NONE],
    [
      "a transparent outline",
      {
        ...NONE,
        outlineStyle: "solid",
        outlineWidth: "2px",
        outlineColor: "transparent",
      },
    ],
    [
      "an outline at alpha 0",
      {
        ...NONE,
        outlineStyle: "solid",
        outlineWidth: "2px",
        outlineColor: "rgba(0, 0, 0, 0)",
      },
    ],
    [
      "an outline at alpha 0 in the space form",
      {
        ...NONE,
        outlineStyle: "solid",
        outlineWidth: "2px",
        outlineColor: "oklch(0.5 0.1 200 / 0)",
      },
    ],
    [
      "an outline of width 0",
      { ...NONE, outlineStyle: "solid", outlineWidth: "0px" },
    ],
    [
      "a transparent ring",
      { ...NONE, boxShadow: "transparent 0px 0px 0px 3px" },
    ],
    [
      "a ring at alpha 0",
      { ...NONE, boxShadow: "rgba(99, 102, 241, 0) 0px 0px 0px 3px" },
    ],
    [
      "a soft shadow with no spread",
      { ...NONE, boxShadow: "rgb(0, 0, 0) 0px 1px 2px 0px" },
    ],
  ])("refuses %s", (_name, style) => {
    expect(focusMarkShown(style)).toBe(false);
  });
});
