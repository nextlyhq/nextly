/**
 * The parts of a text style as Design's editor reads and writes them: the
 * devices its size is set for, its case, its letter spacing with its unit,
 * and its font.
 */
import {
  BASE_BREAKPOINT,
  type BreakpointSet,
  type NodeStyles,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import {
  fontChoiceOf,
  letterSpacingParts,
  letterSpacingValue,
  partAt,
  TEXT_STYLE_CASES,
  textStyleDevices,
} from "./text-style-parts";

const breakpoints = {
  viewport: [
    { id: "tablet", label: "Tablet", maxWidth: 1024 },
    { id: "mobile", label: "Mobile", maxWidth: 640 },
  ],
  container: [],
} as unknown as BreakpointSet;

describe("the devices a size is set for", () => {
  it("are Desktop, then the site's own devices, widest first", () => {
    expect(textStyleDevices(breakpoints)).toEqual([
      { id: BASE_BREAKPOINT, label: "Desktop" },
      { id: "tablet", label: "Tablet" },
      { id: "mobile", label: "Mobile" },
    ]);
  });

  it("are Desktop alone on a site with no devices of its own", () => {
    expect(textStyleDevices(undefined)).toEqual([
      { id: BASE_BREAKPOINT, label: "Desktop" },
    ]);
  });
});

describe("a part's value", () => {
  const styles = {
    base: {
      [BASE_BREAKPOINT]: { fontSize: "56px" },
      mobile: { fontSize: "32px" },
    },
  } as NodeStyles;

  it("is read at the device it is set for", () => {
    expect(partAt(styles, BASE_BREAKPOINT, "fontSize")).toBe("56px");
    expect(partAt(styles, "mobile", "fontSize")).toBe("32px");
    expect(partAt(styles, "tablet", "fontSize")).toBeUndefined();
  });
});

describe("its case", () => {
  it("is named in the author's words, for each value it stores", () => {
    expect(TEXT_STYLE_CASES).toEqual([
      ["none", "As typed"],
      ["uppercase", "UPPERCASE"],
      ["lowercase", "lowercase"],
      ["capitalize", "Capitalised"],
    ]);
  });
});

describe("its letter spacing", () => {
  it("takes em when a bare number is typed", () => {
    expect(letterSpacingValue("0.08", "em")).toBe("0.08em");
    expect(letterSpacingValue("+0.08", "em")).toBe("0.08em");
    expect(letterSpacingValue("1", "px")).toBe("1px");
    expect(letterSpacingValue("-0.5", "em")).toBe("-0.5em");
  });

  it("keeps a unit typed with the number, and clears when emptied", () => {
    expect(letterSpacingValue("2px", "em")).toBe("2px");
    expect(letterSpacingValue("", "em")).toBeNull();
    expect(letterSpacingValue("wide", "em")).toBeUndefined();
  });

  it("is read back as its number and unit, em when it holds none", () => {
    expect(letterSpacingParts("0.08em")).toEqual({ amount: "0.08", unit: "em" });
    expect(letterSpacingParts("1px")).toEqual({ amount: "1", unit: "px" });
    expect(letterSpacingParts(undefined)).toEqual({ amount: "", unit: "em" });
  });
});

describe("its font", () => {
  it("is the Body font, the Headings font, or a family the site loads", () => {
    expect(fontChoiceOf({ $token: "font.body" })).toBe("body");
    expect(fontChoiceOf({ $token: "font.heading" })).toBe("heading");
    expect(fontChoiceOf("Inter, sans-serif")).toBe("Inter, sans-serif");
    expect(fontChoiceOf(undefined)).toBe("");
  });
});
