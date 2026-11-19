/**
 * Which of a style envelope's values a block's `supports` lets it keep, and
 * how many it can't: the one answer "Turn into" and the builder's paste of a
 * style both read.
 *
 * @module style/supports-map.test
 */
import { describe, expect, it } from "vitest";

import type { NodeStyles } from "../document";

import { supportedStylesOf } from "./supports-map";

/** A heading's look: colour and size on two devices, and on hover. */
const STYLES = {
  base: {
    base: { color: "red", fontSize: "32px", padding: "8px" },
    mobile: { fontSize: "20px" },
  },
  hover: { base: { color: "darkred" } },
} as unknown as NodeStyles;

describe("the styles a block's supports keep", () => {
  it("keeps every supported value at each state and device, and counts each one left out", () => {
    const { styles, skipped } = supportedStylesOf(STYLES, { spacing: true });
    expect(styles).toEqual({ base: { base: { padding: "8px" } } });
    // Colour and size at rest, size on mobile, colour on hover.
    expect(skipped).toBe(4);
  });

  it("keeps everything for a block that supports it all, as a copy", () => {
    const { styles, skipped } = supportedStylesOf(STYLES, {
      typography: true,
      color: true,
      spacing: true,
    });
    expect(styles).toEqual(STYLES);
    expect(styles).not.toBe(STYLES);
    expect(skipped).toBe(0);
  });

  it("drops a state or device left empty, and answers nothing when nothing is left", () => {
    expect(supportedStylesOf(STYLES, undefined)).toEqual({
      styles: undefined,
      skipped: 5,
    });
    expect(supportedStylesOf(undefined, { color: true })).toEqual({
      styles: undefined,
      skipped: 0,
    });
  });

  it("carries an entry the catalog doesn't know, which supports don't decide", () => {
    const { styles, skipped } = supportedStylesOf(
      { base: { base: { "--accent": "blue" } } } as unknown as NodeStyles,
      undefined
    );
    expect(styles).toEqual({ base: { base: { "--accent": "blue" } } });
    expect(skipped).toBe(0);
  });
});
