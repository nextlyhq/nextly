/**
 * How many of the Get started card's steps it draws: only whole ones, leaving room for the
 * control that shows the rest.
 */
import { describe, expect, it } from "vitest";

import { stepsThatFit } from "./fold";

describe("stepsThatFit", () => {
  it("draws every step when the last one ends within the body, with no room kept for a control", () => {
    expect(stepsThatFit([100, 200, 300], 300, 44)).toBe(3);
    expect(stepsThatFit([], 300, 44)).toBe(0);
  });

  it("draws only whole steps that end above the control's room when the rest do not fit", () => {
    // The fourth ends past the body; the third ends within it but inside the control's 44 px,
    // so it is folded too: the control must fit below the last step drawn.
    expect(stepsThatFit([100, 150, 280, 320], 300, 44)).toBe(2);
    // The must-differ half: with no room needed for the control, the third would have fitted.
    expect(stepsThatFit([100, 150, 280, 320], 300, 0)).toBe(3);
  });

  it("draws no step at all when not even the first fits above the control", () => {
    expect(stepsThatFit([280, 340], 300, 44)).toBe(0);
  });
});
