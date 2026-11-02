/** The rows a card spans while its body asks for more height than its stored rows hold. */
import { describe, expect, it } from "vitest";

import { grownRows } from "../grow";
import { cardBodyHeightPx } from "../measures";

describe("grownRows", () => {
  it("keeps the stored rows when the body asks for nothing, or for what they already hold", () => {
    expect(grownRows(4, undefined)).toBe(4);
    expect(grownRows(4, cardBodyHeightPx(4))).toBe(4);
    expect(grownRows(4, 10)).toBe(4);
  });

  it("spans the fewest rows past the stored ones whose body holds what is asked", () => {
    // One pixel past four rows' body is five rows; exactly six rows' body is six, not seven.
    expect(grownRows(4, cardBodyHeightPx(4) + 1)).toBe(5);
    expect(grownRows(4, cardBodyHeightPx(6))).toBe(6);
    expect(grownRows(4, cardBodyHeightPx(6) + 1)).toBe(7);
  });

  it("never draws a card shorter than its stored rows, and ignores a height that is no number", () => {
    expect(grownRows(8, cardBodyHeightPx(3))).toBe(8);
    expect(grownRows(4, Number.NaN)).toBe(4);
  });
});
