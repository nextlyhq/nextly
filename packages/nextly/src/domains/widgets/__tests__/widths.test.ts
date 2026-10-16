import { describe, expect, it } from "vitest";

import {
  WIDGET_WIDTHS,
  allowedWidths,
  isWidgetWidth,
  widthFromSize,
} from "../widths";

describe("widthFromSize", () => {
  it("maps each declared size to the width of the same span", () => {
    expect(widthFromSize("sm")).toBe("quarter");
    expect(widthFromSize("md")).toBe("third");
    expect(widthFromSize("lg")).toBe("half");
    expect(widthFromSize("xl")).toBe("twoThirds");
    expect(widthFromSize("full")).toBe("full");
  });

  it("reads a missing or unknown size as full, never as a guess", () => {
    // A stored size this core does not know came from a newer plugin; the
    // admin has always drawn it full, so converting it to anything else would
    // change what the person was looking at.
    expect(widthFromSize(undefined)).toBe("full");
    expect(widthFromSize("xxl")).toBe("full");
    expect(widthFromSize("")).toBe("full");
    expect(widthFromSize(6)).toBe("full");
    // Not a key of the map's prototype either.
    expect(widthFromSize("toString")).toBe("full");
  });
});

describe("isWidgetWidth", () => {
  it("accepts exactly the five widths", () => {
    for (const width of WIDGET_WIDTHS) expect(isWidgetWidth(width)).toBe(true);
    for (const other of [
      "sm",
      "lg",
      "Full",
      "",
      undefined,
      12,
      "constructor",
    ]) {
      expect(isWidgetWidth(other)).toBe(false);
    }
  });
});

describe("allowedWidths", () => {
  it("allows every width when the widget bounds neither end", () => {
    expect(allowedWidths(undefined, undefined)).toEqual(WIDGET_WIDTHS);
  });

  it("allows the widths between the declared smallest and largest size", () => {
    expect(allowedWidths("md", "full")).toEqual([
      "third",
      "half",
      "twoThirds",
      "full",
    ]);
    expect(allowedWidths("sm", "lg")).toEqual(["quarter", "third", "half"]);
    expect(allowedWidths("full", "full")).toEqual(["full"]);
  });

  it("bounds one end when only one is declared", () => {
    expect(allowedWidths("lg", undefined)).toEqual([
      "half",
      "twoThirds",
      "full",
    ]);
    expect(allowedWidths(undefined, "md")).toEqual(["quarter", "third"]);
  });

  it("ignores a bound it cannot read rather than allowing nothing", () => {
    // A bound from a newer plugin is a value this core cannot place; reading it
    // as "no bound" keeps the card arrangeable instead of offering no width.
    expect(allowedWidths("huge", "md")).toEqual(["quarter", "third"]);
    expect(allowedWidths("md", "huge")).toEqual([
      "third",
      "half",
      "twoThirds",
      "full",
    ]);
  });

  it("allows every width rather than none when the bounds cross", () => {
    // The registry refuses a minimum above the maximum, so this is a guard:
    // an empty answer would leave a card with no width to draw at.
    expect(allowedWidths("full", "sm")).toEqual(WIDGET_WIDTHS);
  });
});
