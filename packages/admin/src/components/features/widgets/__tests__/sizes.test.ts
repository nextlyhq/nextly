/**
 * The size -> span map is the only place a widget's width is decided, so these
 * assert the RENDERED class text rather than a lookup succeeding.
 */
import { describe, expect, it } from "vitest";

import {
  WIDGET_SPAN_CLASSES,
  legacySizeToWidgetSize,
  widgetSpanClass,
} from "../sizes";

import type { WidgetSize } from "nextly/config";

const ALL_SIZES: WidgetSize[] = ["sm", "md", "lg", "xl", "full"];

describe("widget span classes", () => {
  it("gives every size a full-width base span, so a phone is one column", () => {
    for (const size of ALL_SIZES) {
      const classes = widgetSpanClass(size).split(" ");
      expect(classes).toContain("col-span-12");
    }
  });

  it("never emits an unprefixed span narrower than 12", () => {
    // The defect in the grid this replaces: `col-span-6` with no breakpoint
    // prefix, which is half a phone screen.
    for (const size of ALL_SIZES) {
      const unprefixed = widgetSpanClass(size)
        .split(" ")
        .filter(c => !c.includes(":"));
      expect(unprefixed).toEqual(["col-span-12"]);
    }
  });

  it("narrows only at md and lg, and to the declared column counts", () => {
    expect(widgetSpanClass("sm")).toBe(
      "col-span-12 md:col-span-6 lg:col-span-3"
    );
    expect(widgetSpanClass("md")).toBe(
      "col-span-12 md:col-span-6 lg:col-span-4"
    );
    expect(widgetSpanClass("lg")).toBe(
      "col-span-12 md:col-span-12 lg:col-span-6"
    );
    expect(widgetSpanClass("xl")).toBe(
      "col-span-12 md:col-span-12 lg:col-span-8"
    );
    expect(widgetSpanClass("full")).toBe("col-span-12");
  });

  it("uses only md and lg as breakpoints", () => {
    for (const size of ALL_SIZES) {
      for (const cls of widgetSpanClass(size).split(" ")) {
        const [prefix] = cls.split(":");
        if (cls.includes(":")) expect(["md", "lg"]).toContain(prefix);
      }
    }
  });

  it("writes every class out in full, because Tailwind scans source text", () => {
    // A `col-span-${n}` template literal produces no class in the built
    // stylesheet. Assert the map holds literal strings with no interpolation
    // residue rather than trusting the call site.
    for (const value of Object.values(WIDGET_SPAN_CLASSES)) {
      expect(value).not.toMatch(/[$`{}]/);
      expect(value).toMatch(/^col-span-12( (md|lg):col-span-\d+)*$/);
    }
  });

  it("falls back to full width for a size the registry does not know", () => {
    expect(widgetSpanClass(undefined)).toBe("col-span-12");
    expect(widgetSpanClass("enormous" as WidgetSize)).toBe("col-span-12");
  });
});

describe("legacySizeToWidgetSize", () => {
  it("maps the deprecated half alias onto the six-column size", () => {
    expect(legacySizeToWidgetSize("half")).toBe("lg");
    expect(widgetSpanClass(legacySizeToWidgetSize("half"))).toContain(
      "lg:col-span-6"
    );
  });

  it("maps the deprecated full alias onto full", () => {
    expect(legacySizeToWidgetSize("full")).toBe("full");
  });

  it("defaults an undeclared size to full width", () => {
    expect(legacySizeToWidgetSize(undefined)).toBe("full");
  });
});
