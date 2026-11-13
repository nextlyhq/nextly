/**
 * One width for the bar's fold, read by script (the bar) and by style (the
 * editor's outline, and the room the bar's right part keeps): the classes
 * carry the same width as the number, so the outline folds where the bar does.
 */
import { describe, expect, it } from "vitest";

import {
  BAR_FOLD_BELOW_PX,
  barFolds,
  END_PLACE_ROOM,
  UNFOLDED_BAR_ONLY,
} from "./bar-fold";

/** The rule's width as its classes write it, in rem at 16 px. */
const AS_REM = `${BAR_FOLD_BELOW_PX / 16}rem`;

describe("the bar's fold", () => {
  it("folds below its width, and not at it or above", () => {
    expect(barFolds(BAR_FOLD_BELOW_PX - 1)).toBe(true);
    expect(barFolds(BAR_FOLD_BELOW_PX)).toBe(false);
    expect(barFolds(null)).toBe(false);
  });

  it("is written in the classes at the same width", () => {
    expect(END_PLACE_ROOM).toBe(`@[${AS_REM}]/topbar:min-w-[32rem]`);
    expect(UNFOLDED_BAR_ONLY).toBe(`@max-[${AS_REM}]/topbar:hidden`);
  });
});
