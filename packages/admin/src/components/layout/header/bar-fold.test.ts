/**
 * One width for the bar's fold, read by script (the bar) and by style (the
 * editor's outline, and the room the bar's right part keeps): the classes
 * carry the same width as the number, in the same unit, so the outline folds
 * where the bar does at any root font size.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  BAR_FOLD_BELOW_REM,
  barFolds,
  END_PLACE_ROOM,
  UNFOLDED_BAR_ONLY,
} from "./bar-fold";

afterEach(() => {
  document.documentElement.style.fontSize = "";
});

describe("the bar's fold", () => {
  it("folds below its width, and not at it or above, at the default root size", () => {
    expect(barFolds(BAR_FOLD_BELOW_REM * 16 - 1)).toBe(true);
    expect(barFolds(BAR_FOLD_BELOW_REM * 16)).toBe(false);
    expect(barFolds(null)).toBe(false);
  });

  it("folds where the classes do at a larger root font size", () => {
    // At 20 px a rem, the classes' 44rem is 880 px: the outline hides its
    // toggle below 880, so the bar folds there too, and not at 880.
    document.documentElement.style.fontSize = "20px";
    expect(barFolds(800)).toBe(true);
    expect(barFolds(879)).toBe(true);
    expect(barFolds(880)).toBe(false);
  });

  it("is written in the classes at the same width, against the room the bar's controls share", () => {
    expect(END_PLACE_ROOM).toBe(
      `@[${BAR_FOLD_BELOW_REM}rem]/barroom:min-w-[32rem]`
    );
    expect(UNFOLDED_BAR_ONLY).toBe(
      `@max-[${BAR_FOLD_BELOW_REM}rem]/barroom:hidden`
    );
  });
});
