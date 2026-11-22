/**
 * A colour's contrast in the Design panel's words: the WCAG 2 ratio to two
 * decimals, and "Readable as text" from 4.5:1, "Large text only" from 3:1,
 * else "Low contrast".
 */
import * as engine from "@nextlyhq/blocks-engine";
import { describe, expect, it, vi } from "vitest";

import { contrastLine } from "./variable-contrast";

describe("a colour's contrast, in words", () => {
  it("says #6b7280 on white is 4.83:1, readable as text", () => {
    expect(contrastLine("#6b7280", "#ffffff")).toEqual({
      ratio: "4.83:1",
      band: "Readable as text",
    });
  });

  it("says #e5e7eb on white is 1.24:1, low contrast", () => {
    expect(contrastLine("#e5e7eb", "#ffffff")).toEqual({
      ratio: "1.24:1",
      band: "Low contrast",
    });
  });

  it("says a ratio from 3:1 to under 4.5:1 is for large text only", () => {
    // #949494 on white is 3.03:1.
    expect(contrastLine("#949494", "#ffffff")).toEqual({
      ratio: "3.03:1",
      band: "Large text only",
    });
  });

  it("puts the bands' edges where WCAG does: 4.5 readable, 3 large text", () => {
    // #767676 on white is 4.54:1; #777777 is 4.48:1.
    expect(contrastLine("#767676", "#ffffff")?.band).toBe("Readable as text");
    expect(contrastLine("#777777", "#ffffff")?.band).toBe("Large text only");
  });

  it("says nothing for a colour it cannot read", () => {
    expect(contrastLine("var(--x)", "#ffffff")).toBeUndefined();
    expect(contrastLine("#000000", "banana")).toBeUndefined();
  });
});

describe("the band, from the engine's verdict", () => {
  it("says what the engine's level means, not a second reading of the ratio", () => {
    // A verdict that disagrees with its own ratio: only a band read from the
    // level says "Large text only" here.
    const spy = vi.spyOn(engine, "checkContrast").mockReturnValue({
      ratio: 9,
      level: "AA-large",
      passesBodyText: false,
    });
    try {
      expect(contrastLine("#000000", "#ffffff")?.band).toBe("Large text only");
    } finally {
      spy.mockRestore();
    }
  });
});
