/**
 * The width a card is DRAWN at, and the class text that draws it.
 *
 * Two questions, both decided in `sizes.ts` and nowhere else: which of the
 * five widths a stored placement is drawn at once its widget's allowed widths
 * are known, and which span classes draw that width at each container band.
 * The classes are asserted as the RENDERED text, because Tailwind builds a
 * rule only for class text it finds in source.
 */
import {
  WIDGET_WIDTHS as CORE_WIDGET_WIDTHS,
  widthFromSize as coreWidthFromSize,
} from "nextly/config";
import { describe, expect, it } from "vitest";

import type { WidgetWidth } from "@admin/types/dashboard/widgets";

import {
  WIDGET_WIDTHS,
  WIDTH_NAMES,
  WIDTH_SPAN_CLASSES,
  cardSpanClass,
  drawnWidth,
  legacySizeToWidgetSize,
  widthFromDeclaredSize,
} from "../sizes";

describe("the width a stored placement is drawn at", () => {
  it("is the stored width while the widget still allows it", () => {
    for (const width of WIDGET_WIDTHS) {
      expect(drawnWidth(width, WIDGET_WIDTHS)).toBe(width);
    }
  });

  it.each<[string, WidgetWidth[], WidgetWidth]>([
    // A tie: half (6 of 12 tracks) is 2 tracks from a third and from two
    // thirds, and the WIDER one wins.
    ["half", ["third", "twoThirds"], "twoThirds"],
    // Nearness is measured in TRACKS, the width a reader sees, not in steps
    // of the width list: these are one step either way, yet one side is
    // nearer on screen, and that side wins.
    ["third", ["quarter", "half"], "quarter"],
    ["twoThirds", ["half", "full"], "half"],
    ["half", ["quarter", "full"], "quarter"],
    // Not ties: the nearer one wins, whichever side it is on.
    ["quarter", ["half", "full"], "half"],
    ["full", ["third"], "third"],
    ["full", ["quarter", "half"], "half"],
    ["quarter", ["third", "full"], "third"],
    ["twoThirds", ["quarter", "half"], "half"],
  ])(
    "draws stored %s at the nearest allowed of %j, the wider on a tie",
    (stored, allowed, drawn) => {
      expect(drawnWidth(stored, allowed)).toBe(drawn);
    }
  );

  it("does not depend on the order the allowed widths arrive in", () => {
    // The server sends them narrowest first; a tie must not be decided by
    // which of the two was met first in a list that happened to be reversed.
    expect(drawnWidth("half", ["twoThirds", "third"])).toBe("twoThirds");
  });

  it("draws a width from a newer core as full, then as the nearest allowed", () => {
    expect(drawnWidth("enormous", undefined)).toBe("full");
    expect(drawnWidth("enormous", WIDGET_WIDTHS)).toBe("full");
    expect(drawnWidth("enormous", ["quarter", "half"])).toBe("half");
  });

  it("does not read inherited names as widths", () => {
    // A plain lookup answers `Object.prototype` members for these, so the
    // fallback never runs. The value comes from storage over the wire.
    for (const name of ["constructor", "toString", "__proto__"]) {
      expect(drawnWidth(name, undefined)).toBe("full");
    }
  });

  it("keeps the stored width when nothing says what the widget allows", () => {
    expect(drawnWidth("third", undefined)).toBe("third");
    expect(drawnWidth("third", [])).toBe("third");
  });
});

describe("span classes", () => {
  it("draws every width full below 640px of dashboard width", () => {
    for (const width of WIDGET_WIDTHS) {
      const unprefixed = WIDTH_SPAN_CLASSES[width]
        .split(" ")
        .filter(c => !c.includes(":"));
      expect(unprefixed).toEqual(["col-span-12"]);
    }
  });

  it("draws the three narrow widths at half, and the wide two full, from 640px", () => {
    // The middle band: 640-1023px of the DASHBOARD's own width.
    const at640 = (width: WidgetWidth) =>
      WIDTH_SPAN_CLASSES[width]
        .split(" ")
        .find(c => c.startsWith("@min-[640px]/dashboard:"));
    expect(at640("quarter")).toBe("@min-[640px]/dashboard:col-span-6");
    expect(at640("third")).toBe("@min-[640px]/dashboard:col-span-6");
    expect(at640("half")).toBe("@min-[640px]/dashboard:col-span-6");
    expect(at640("twoThirds")).toBe("@min-[640px]/dashboard:col-span-12");
    // Full is full in every band, so it needs no prefixed class at all.
    expect(at640("full")).toBeUndefined();
  });

  it("draws each width as chosen from 1024px: 3, 4, 6, 8 and 12 tracks", () => {
    const at1024 = (width: WidgetWidth) =>
      WIDTH_SPAN_CLASSES[width]
        .split(" ")
        .find(c => c.startsWith("@min-[1024px]/dashboard:"));
    expect(at1024("quarter")).toBe("@min-[1024px]/dashboard:col-span-3");
    expect(at1024("third")).toBe("@min-[1024px]/dashboard:col-span-4");
    expect(at1024("half")).toBe("@min-[1024px]/dashboard:col-span-6");
    expect(at1024("twoThirds")).toBe("@min-[1024px]/dashboard:col-span-8");
    expect(WIDTH_SPAN_CLASSES.full).toBe("col-span-12");
  });

  it("answers to the dashboard's own container, never the viewport", () => {
    // A viewport breakpoint (`md:`, `lg:`) would size cards by the window, so
    // a dashboard beside an open sidebar would draw columns it has no room for.
    for (const width of WIDGET_WIDTHS) {
      for (const cls of WIDTH_SPAN_CLASSES[width].split(" ")) {
        if (cls.includes(":"))
          expect(cls).toMatch(/^@min-\[\d+px\]\/dashboard:/);
      }
    }
  });

  it("writes every class out in full, because Tailwind scans source text", () => {
    for (const value of Object.values(WIDTH_SPAN_CLASSES)) {
      expect(value).not.toMatch(/[$`{}]/);
    }
  });

  it("draws a card through the nearest allowed width", () => {
    // The one function the grid calls: a stored half the widget no longer
    // allows is drawn at two-thirds, not at half and not full.
    expect(cardSpanClass("half", ["third", "twoThirds"])).toBe(
      WIDTH_SPAN_CLASSES.twoThirds
    );
    expect(cardSpanClass("enormous", undefined)).toBe(WIDTH_SPAN_CLASSES.full);
  });
});

describe("what each width is called", () => {
  it("names every width and its fraction", () => {
    expect(
      WIDGET_WIDTHS.map(
        w => `${WIDTH_NAMES[w].name} ${WIDTH_NAMES[w].fraction}`
      )
    ).toEqual([
      "Quarter width ¼",
      "Third width ⅓",
      "Half width ½",
      "Two-thirds width ⅔",
      "Full width Full",
    ]);
  });
});

describe("a widget's declared size, before an arrangement is read", () => {
  it("maps each size onto the width of the same span", () => {
    expect(widthFromDeclaredSize("sm")).toBe("quarter");
    expect(widthFromDeclaredSize("md")).toBe("third");
    expect(widthFromDeclaredSize("lg")).toBe("half");
    expect(widthFromDeclaredSize("xl")).toBe("twoThirds");
    expect(widthFromDeclaredSize("full")).toBe("full");
  });

  it("draws a size it does not know, or none, full", () => {
    expect(widthFromDeclaredSize(undefined)).toBe("full");
    expect(widthFromDeclaredSize("enormous")).toBe("full");
    expect(widthFromDeclaredSize("constructor")).toBe("full");
  });
});

describe("legacySizeToWidgetSize", () => {
  it("maps the deprecated half alias onto the half-width size", () => {
    expect(legacySizeToWidgetSize("half")).toBe("lg");
    expect(widthFromDeclaredSize(legacySizeToWidgetSize("half"))).toBe("half");
  });

  it("maps the deprecated full alias onto full", () => {
    expect(legacySizeToWidgetSize("full")).toBe("full");
  });

  it("defaults an undeclared size to full width", () => {
    expect(legacySizeToWidgetSize(undefined)).toBe("full");
  });
});

describe("the width vocabulary is core's", () => {
  it("is the five widths in core's ranking, as nextly/config publishes them", () => {
    expect([...CORE_WIDGET_WIDTHS]).toEqual([
      "quarter",
      "third",
      "half",
      "twoThirds",
      "full",
    ]);
    // The same list, not an equal copy: a width added or renamed in core
    // reaches the admin with nothing here to update.
    expect(WIDGET_WIDTHS).toBe(CORE_WIDGET_WIDTHS);
  });

  it("gives every width core has a span, a name and a label, and none it lacks", () => {
    const core = [...CORE_WIDGET_WIDTHS].sort();
    expect(Object.keys(WIDTH_SPAN_CLASSES).sort()).toEqual(core);
    expect(Object.keys(WIDTH_NAMES).sort()).toEqual(core);
  });

  it("reads a declared size as core does", () => {
    for (const size of [
      "sm",
      "md",
      "lg",
      "xl",
      "full",
      "enormous",
      undefined,
    ]) {
      expect(widthFromDeclaredSize(size), String(size)).toBe(
        coreWidthFromSize(size)
      );
    }
  });
});
