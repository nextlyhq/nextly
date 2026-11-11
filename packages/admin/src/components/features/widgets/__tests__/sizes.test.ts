/**
 * The size a card is DRAWN at, and the class text that draws it.
 *
 * Three questions, all decided in `sizes.ts` and nowhere else: the size a stored
 * placement is drawn at once its widget's bounds are known, how many columns a
 * card of `w` is drawn across in each of the three bands of the dashboard's own
 * width, and the sizes the card menu offers. The classes are asserted as the
 * RENDERED text, because Tailwind builds a rule only for class text it finds in
 * source.
 */
import { GRID_COLUMNS, sizeBounds, type WidgetSizeBounds } from "nextly/config";
import { describe, expect, it } from "vitest";

import {
  AS_SIZED_FROM_PX,
  COLUMN_GAP_PX,
  GRID_CLASS,
  ROW_GAP_PX,
  SPAN_CLASSES,
  TWO_UP_FROM_PX,
  WIDE_COLUMN_GAP_PX,
  WIDE_GAP_FROM_PX,
  cardSpanClass,
  columnGapPx,
  columnsName,
  drawnSize,
  drawnSpan,
  isOneColumn,
  sizeName,
  widthChoiceName,
  widthChoices,
} from "../sizes";

/** Bounds as a widget's declaration would give them, through core's own filling-in. */
function bounds(
  min: { w: number; h: number },
  start: { w: number; h: number },
  max: { w: number; h: number }
): WidgetSizeBounds {
  return sizeBounds({ default: start, min, max });
}

const EVERY_W = Array.from({ length: GRID_COLUMNS }, (_, index) => index + 1);

describe("the size a stored placement is drawn at", () => {
  const range = bounds({ w: 3, h: 2 }, { w: 6, h: 3 }, { w: 8, h: 5 });

  it("is the stored size while it lies within the widget's bounds", () => {
    expect(drawnSize({ w: 4, h: 4 }, range)).toEqual({ w: 4, h: 4 });
    expect(drawnSize({ w: 3, h: 2 }, range)).toEqual({ w: 3, h: 2 });
    expect(drawnSize({ w: 8, h: 5 }, range)).toEqual({ w: 8, h: 5 });
  });

  it("is the nearest size inside them when it lies outside, each direction on its own", () => {
    // 🔴 The separating cases for the clamp: a plain "fall back to the default" would draw all
    // three at 6x3, and a clamp of one direction only would leave one of them out of bounds.
    expect(drawnSize({ w: 12, h: 3 }, range)).toEqual({ w: 8, h: 3 });
    expect(drawnSize({ w: 1, h: 9 }, range)).toEqual({ w: 3, h: 5 });
    expect(
      drawnSize(
        { w: 4, h: 2 },
        bounds({ w: 3, h: 3 }, { w: 6, h: 3 }, { w: 8, h: 5 })
      )
    ).toEqual({ w: 4, h: 3 });
  });

  it("draws a card whose widget's bounds narrowed at the new end, and leaves the stored value alone", () => {
    const stored = { w: 12, h: 6 };
    const narrowed = bounds({ w: 4, h: 2 }, { w: 4, h: 2 }, { w: 6, h: 4 });
    expect(drawnSize(stored, narrowed)).toEqual({ w: 6, h: 4 });
    // Kept as stored until its owner saves: drawing reads the value, it never writes it.
    expect(stored).toEqual({ w: 12, h: 6 });
  });

  it("draws a stored value the grid could not draw at all at the widget's default", () => {
    expect(drawnSize({ w: Number.NaN, h: 3 }, range)).toEqual({ w: 6, h: 3 });
    expect(drawnSize({ w: 13, h: 3 }, range)).toEqual({ w: 6, h: 3 });
    expect(drawnSize({ w: 2.5, h: 3 }, range)).toEqual({ w: 6, h: 3 });
    // One row cannot hold the frame, so no size is ever one row high.
    expect(drawnSize({ w: 4, h: 1 }, range)).toEqual({ w: 6, h: 3 });
  });
});

describe("the three bands, by the dashboard's own width", () => {
  it("draws every card at its own w from 1,024 px", () => {
    for (const w of EVERY_W) {
      expect(drawnSpan(w, AS_SIZED_FROM_PX), `w ${w}`).toBe(w);
      expect(drawnSpan(w, 1440), `w ${w}`).toBe(w);
    }
  });

  it("draws a card of w 6 or less at 6 and a wider one at 12, from 640 to 1,023 px", () => {
    for (const dashboardWidth of [TWO_UP_FROM_PX, 768, AS_SIZED_FROM_PX - 1]) {
      for (const w of EVERY_W) {
        expect(
          drawnSpan(w, dashboardWidth),
          `w ${w} at ${dashboardWidth}`
        ).toBe(w <= 6 ? 6 : 12);
      }
    }
  });

  it("draws every card at 12 below 640 px but a quarter one, which pairs at 6", () => {
    for (const w of EVERY_W) {
      expect(drawnSpan(w, TWO_UP_FROM_PX - 1)).toBe(w <= 3 ? 6 : 12);
      expect(drawnSpan(w, 360)).toBe(w <= 3 ? 6 : 12);
    }
    expect(isOneColumn(TWO_UP_FROM_PX - 1)).toBe(true);
    expect(isOneColumn(TWO_UP_FROM_PX)).toBe(false);
  });

  it("changes band exactly at 639/640 and 1,023/1,024 px", () => {
    // 🔴 The band edges themselves: a `<=` where a `<` belongs moves a whole band by a pixel.
    expect(drawnSpan(4, 639)).toBe(12);
    expect(drawnSpan(4, 640)).toBe(6);
    expect(drawnSpan(4, 1023)).toBe(6);
    expect(drawnSpan(4, 1024)).toBe(4);
    expect(drawnSpan(8, 1023)).toBe(12);
    expect(drawnSpan(8, 1024)).toBe(8);
  });
});

describe("span classes", () => {
  /**
   * The span the class text draws at a dashboard width, read back from the classes themselves:
   * the unprefixed `col-span-N`, then each `@min-[Npx]/dashboard:` override the width reaches.
   */
  function spanTheClassesDraw(w: number, dashboardWidth: number): number {
    let span = 0;
    for (const token of cardSpanClass(w).split(" ")) {
      const plain = /^col-span-(\d+)$/.exec(token);
      const banded = /^@min-\[(\d+)px\]\/dashboard:col-span-(\d+)$/.exec(token);
      if (plain) span = Number(plain[1]);
      else if (banded && dashboardWidth >= Number(banded[1]))
        span = Number(banded[2]);
    }
    return span;
  }

  it("agrees with the numbers at every band edge, so the predicted tier is the drawn one", () => {
    // 🔴 The numbers predict a card's tier before it is drawn and the classes draw it; a band
    // or a span changed in one and not the other would predict one tier and measure another.
    const samples = [
      TWO_UP_FROM_PX - 1,
      TWO_UP_FROM_PX,
      AS_SIZED_FROM_PX - 1,
      AS_SIZED_FROM_PX,
      1600,
    ];
    for (const w of EVERY_W) {
      for (const dashboardWidth of samples) {
        expect(
          spanTheClassesDraw(w, dashboardWidth),
          `w ${w} at ${dashboardWidth}px`
        ).toBe(drawnSpan(w, dashboardWidth));
      }
    }
  });

  it("holds a class for every w from 1 to 12 and draws one it does not know full", () => {
    expect(Object.keys(SPAN_CLASSES).map(Number)).toEqual(EVERY_W);
    expect(cardSpanClass(13)).toBe("col-span-12");
    expect(cardSpanClass(12)).toBe("col-span-12");
  });

  it("answers to the dashboard's own container, never the viewport", () => {
    // A viewport breakpoint (`md:`, `lg:`) would size cards by the window, so a dashboard
    // beside an open sidebar would draw columns it has no room for.
    for (const w of EVERY_W) {
      for (const cls of cardSpanClass(w).split(" ")) {
        if (cls.includes(":"))
          expect(cls).toMatch(/^@min-\[\d+px\]\/dashboard:/);
      }
    }
  });

  it("writes every class out in full, because Tailwind scans source text", () => {
    for (const value of [...Object.values(SPAN_CLASSES), GRID_CLASS]) {
      expect(value).not.toMatch(/[$`{}]/);
    }
  });
});

describe("rows and gaps", () => {
  it("draws the grid twelve columns wide in rows as tall as their cards, in order, never dense", () => {
    const classes = GRID_CLASS.split(" ");
    expect(classes).toContain("grid-cols-12");
    expect(classes).toContain("grid-flow-row");
    // 🔴 Rows take their tallest card's height: a fixed row height would clip or pad every card.
    expect(classes).toContain("auto-rows-auto");
    expect(classes.filter(name => name.startsWith("auto-rows-"))).toEqual([
      "auto-rows-auto",
    ]);
    // 🔴 A dense grid backfills a gap with a later card, so the drawn order would leave the
    // saved order the reading and Tab order follow.
    expect(GRID_CLASS).not.toMatch(/dense/);
  });

  it("gaps 16 px across below a 1,280 px dashboard and 24 px from it, 16 px down at every width", () => {
    expect(columnGapPx(WIDE_GAP_FROM_PX - 1)).toBe(COLUMN_GAP_PX);
    expect(columnGapPx(WIDE_GAP_FROM_PX)).toBe(WIDE_COLUMN_GAP_PX);
    expect([COLUMN_GAP_PX, WIDE_COLUMN_GAP_PX, WIDE_GAP_FROM_PX]).toEqual([
      16, 24, 1280,
    ]);
    expect(ROW_GAP_PX).toBe(16);
    // The class text says the same, answering to the dashboard's container.
    const classes = GRID_CLASS.split(" ");
    expect(classes).toContain("gap-x-[16px]");
    expect(classes).toContain("gap-y-[16px]");
    expect(classes).toContain("@min-[1280px]/dashboard:gap-x-[24px]");
  });
});

describe("the sizes the card menu offers", () => {
  it("offers the named widths within the bounds, and the bounds' own ends", () => {
    expect(
      widthChoices(bounds({ w: 3, h: 2 }, { w: 6, h: 3 }, { w: 12, h: 3 }))
    ).toEqual([3, 4, 6, 8, 9, 12]);
    // A minimum of 5 is offered though it is no named width; 3 and 4 lie below it.
    expect(
      widthChoices(bounds({ w: 5, h: 2 }, { w: 6, h: 3 }, { w: 9, h: 3 }))
    ).toEqual([5, 6, 8, 9]);
    expect(
      widthChoices(bounds({ w: 12, h: 4 }, { w: 12, h: 4 }, { w: 12, h: 4 }))
    ).toEqual([12]);
  });

  it("offers the widget's declared default and the width the card is drawn at", () => {
    // 🔴 A default of 5 in bounds of 3 to 12 is no named width: without it the card starts at a
    // width no choice names, nothing is checked, and once moved it cannot go back to 5.
    expect(
      widthChoices(bounds({ w: 3, h: 2 }, { w: 5, h: 3 }, { w: 12, h: 3 }))
    ).toEqual([3, 4, 5, 6, 8, 9, 12]);
    // A card drawn at 7 (stored so, within the bounds) has its width among the choices too.
    expect(
      widthChoices(bounds({ w: 3, h: 2 }, { w: 6, h: 3 }, { w: 12, h: 3 }), 7)
    ).toEqual([3, 4, 6, 7, 8, 9, 12]);
    // The must-differ half: a drawn width outside the bounds is not offered.
    expect(
      widthChoices(bounds({ w: 4, h: 2 }, { w: 6, h: 3 }, { w: 8, h: 3 }), 12)
    ).toEqual([4, 6, 8]);
  });

  it("never offers a size past the bounds", () => {
    const range = bounds({ w: 4, h: 2 }, { w: 6, h: 3 }, { w: 8, h: 4 });
    for (const w of widthChoices(range)) {
      expect(w).toBeGreaterThanOrEqual(4);
      expect(w).toBeLessThanOrEqual(8);
    }
  });

  it("names a size by its share of the row alone, its stored rows unsaid", () => {
    expect(columnsName(1)).toBe("1 column");
    expect(columnsName(6)).toBe("6 columns");
    // A stored `h` sets no height, so two sizes of one width are named alike.
    expect(sizeName({ w: 6, h: 4 })).toBe("50% wide");
    expect(sizeName({ w: 6, h: 9 })).toBe("50% wide");
    // A width that is no named one is said by its own share, rounded.
    expect(sizeName({ w: 5, h: 3 })).toBe("42% wide");
  });

  it("offers a named width by its percent, its columns beneath", () => {
    // The label is the share of the row, the column count the detail; the whole name is what a
    // screen reader hears.
    expect(widthChoiceName(6)).toEqual({
      label: "50%",
      detail: "6 columns",
      spoken: "50% width",
    });
    expect(widthChoiceName(12)).toEqual({
      label: "100%",
      detail: "12 columns",
      spoken: "100% width",
    });
    expect([3, 4, 8, 9].map(w => widthChoiceName(w).label)).toEqual([
      "25%",
      "33%",
      "66%",
      "75%",
    ]);
  });

  it("offers any other width by its own share of the row, rounded, its columns beneath", () => {
    // The must-differ half: 5 and 7 are no named width, so their percent is worked out from the
    // columns rather than looked up.
    expect(widthChoiceName(5)).toEqual({
      label: "42%",
      detail: "5 columns",
      spoken: "42% width",
    });
    expect(widthChoiceName(1)).toEqual({
      label: "8%",
      detail: "1 column",
      spoken: "8% width",
    });
    expect([2, 7, 10, 11].map(w => widthChoiceName(w).label)).toEqual([
      "17%",
      "58%",
      "83%",
      "92%",
    ]);
  });
});
