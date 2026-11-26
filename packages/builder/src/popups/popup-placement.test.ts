/**
 * Where a builder popup goes when it opens, and what that place is measured
 * from: the anchor near each edge of a 1568×737 window, under a 48 px top bar.
 */
import { describe, expect, it } from "vitest";

import {
  type PopupBox,
  type PopupInsets,
  anchorOf,
  holdFor,
  planPopup,
} from "./popup-placement";

const WINDOW = { width: 1568, height: 737 };
/** 8 px from every edge, and clear of a 48 px top bar. */
const INSETS: PopupInsets = { top: 56, right: 8, bottom: 8, left: 8 };
const SIZE = { width: 240, height: 300 };

const box = (
  left: number,
  top: number,
  width = 120,
  height = 28
): PopupBox => ({ left, top, width, height });

/** The popup's box a plan puts it in, as the popover library would. */
function placedBox(
  anchor: PopupBox,
  plan: ReturnType<typeof planPopup>,
  size: { width: number; height: number },
  sideOffset: number
): PopupBox {
  switch (plan.side) {
    case "bottom":
      return {
        left: anchor.left + plan.alignOffset,
        top: anchor.top + anchor.height + sideOffset,
        ...size,
      };
    case "top":
      return {
        left: anchor.left + plan.alignOffset,
        top: anchor.top - sideOffset - size.height,
        ...size,
      };
    case "right":
      return {
        left: anchor.left + anchor.width + sideOffset,
        top: anchor.top + plan.alignOffset,
        ...size,
      };
    case "left":
      return {
        left: anchor.left - sideOffset - size.width,
        top: anchor.top + plan.alignOffset,
        ...size,
      };
  }
}

function inside(placed: PopupBox): boolean {
  return (
    placed.left >= INSETS.left &&
    placed.top >= INSETS.top &&
    placed.left + placed.width <= WINDOW.width - INSETS.right &&
    placed.top + placed.height <= WINDOW.height - INSETS.bottom
  );
}

describe("a builder popup's place when it opens", () => {
  const plan = (
    anchor: PopupBox,
    side: "top" | "right" | "bottom" | "left",
    align: "start" | "center" | "end" = "start"
  ) =>
    planPopup({
      anchor,
      size: SIZE,
      viewport: WINDOW,
      insets: INSETS,
      side,
      align,
      sideOffset: 8,
    });

  it("keeps the side asked for where there is room on it", () => {
    const anchor = box(400, 100);
    const result = plan(anchor, "bottom");
    expect(result).toEqual({ side: "bottom", alignOffset: 0 });
    expect(inside(placedBox(anchor, result, SIZE, 8))).toBe(true);
  });

  it("opens upward from an anchor near the window's bottom edge", () => {
    const anchor = box(400, 680);
    const result = plan(anchor, "bottom");
    expect(result.side).toBe("top");
    expect(inside(placedBox(anchor, result, SIZE, 8))).toBe(true);
  });

  it("opens downward from an anchor near the top bar", () => {
    const anchor = box(400, 60);
    const result = plan(anchor, "top");
    expect(result.side).toBe("bottom");
    expect(inside(placedBox(anchor, result, SIZE, 8))).toBe(true);
  });

  it("opens to the left from an anchor at the window's right edge", () => {
    const anchor = box(1440, 300);
    const result = plan(anchor, "right");
    expect(result.side).toBe("left");
    expect(inside(placedBox(anchor, result, SIZE, 8))).toBe(true);
  });

  it("opens to the right from an anchor at the window's left edge", () => {
    const anchor = box(10, 300);
    const result = plan(anchor, "left");
    expect(result.side).toBe("right");
    expect(inside(placedBox(anchor, result, SIZE, 8))).toBe(true);
  });

  it("keeps the side asked for when told to, room or not", () => {
    const anchor = box(1440, 300);
    const result = planPopup({
      anchor,
      size: SIZE,
      viewport: WINDOW,
      insets: INSETS,
      side: "right",
      align: "start",
      sideOffset: 8,
      keepSide: true,
    });
    expect(result.side).toBe("right");
  });

  it("moves along its side to stay inside the window, low on the screen", () => {
    // The type size editor beside a row in the lower half of the panel:
    // beside it, raised just enough to fit above the window's bottom.
    const anchor = box(1250, 600);
    const result = plan(anchor, "left");
    expect(result.side).toBe("left");
    const placed = placedBox(anchor, result, SIZE, 8);
    expect(placed.top + placed.height).toBe(WINDOW.height - INSETS.bottom);
    expect(inside(placed)).toBe(true);
  });

  it("keeps clear of the top bar along its side", () => {
    const anchor = box(300, 30);
    const result = plan(anchor, "right");
    expect(placedBox(anchor, result, SIZE, 8).top).toBe(INSETS.top);
  });

  it("moves sideways to stay inside the window's left and right edges", () => {
    const right = box(1500, 100, 40);
    const atRight = placedBox(right, plan(right, "bottom"), SIZE, 8);
    expect(atRight.left + atRight.width).toBe(WINDOW.width - INSETS.right);

    const left = box(4, 100, 40);
    const atLeft = placedBox(left, plan(left, "bottom", "end"), SIZE, 8);
    expect(atLeft.left).toBe(INSETS.left);
  });

  it("starts where its alignment puts it", () => {
    const anchor = box(400, 100, 120);
    expect(plan(anchor, "bottom", "center").alignOffset).toBe(60 - 120);
    expect(plan(anchor, "bottom", "end").alignOffset).toBe(120 - 240);
  });

  it("takes the roomier side when it fits on neither, and scrolls inside", () => {
    const tall = { width: 240, height: 900 };
    const anchor = box(400, 500);
    const result = planPopup({
      anchor,
      size: tall,
      viewport: WINDOW,
      insets: INSETS,
      side: "bottom",
      align: "start",
      sideOffset: 8,
    });
    // 500 − 8 − 56 above against 737 − 8 − 528 − 8 below.
    expect(result.side).toBe("top");
  });

  it("is pinned to the start edge when it is taller than the window", () => {
    const tall = { width: 240, height: 900 };
    const anchor = box(300, 400);
    const result = planPopup({
      anchor,
      size: tall,
      viewport: WINDOW,
      insets: INSETS,
      side: "right",
      align: "start",
      sideOffset: 8,
    });
    expect(anchor.top + result.alignOffset).toBe(INSETS.top);
  });

  it("is placed on whole pixels", () => {
    const anchor = box(400.4, 100, 120.3);
    const { alignOffset } = plan(anchor, "bottom", "center");
    expect(Number.isInteger(anchor.left + alignOffset)).toBe(false);
    expect(Number.isInteger(alignOffset)).toBe(true);
  });
});

describe("a caller's own shift along the side", () => {
  const plan = (align: "start" | "center" | "end") =>
    planPopup({
      anchor: box(400, 100, 120),
      size: SIZE,
      viewport: WINDOW,
      insets: INSETS,
      side: "bottom",
      align,
      sideOffset: 8,
      alignOffset: 10,
    });

  it("is read as the popover reads it", () => {
    expect(plan("start").alignOffset).toBe(10);
    expect(plan("end").alignOffset).toBe(120 - 240 - 10);
    // The popover leaves a centered popup's offset unread.
    expect(plan("center").alignOffset).toBe(60 - 120);
  });
});

describe("how a planned popup is held", () => {
  const anchor = box(400, 500, 120, 28);

  /** The popup's top-left corner, as the popover puts it from a hold. */
  const corner = (hold: ReturnType<typeof holdFor>) =>
    hold.side === "bottom"
      ? {
          left: anchor.left + hold.alignOffset,
          top: anchor.top + anchor.height + hold.sideOffset,
        }
      : {
          left: anchor.left + anchor.width + hold.sideOffset,
          top: anchor.top + hold.alignOffset,
        };

  it("keeps a popup below or beside as it was planned", () => {
    expect(
      holdFor({ side: "bottom", alignOffset: -5 }, anchor, SIZE, 8, INSETS)
    ).toEqual({
      side: "bottom",
      sideOffset: 8,
      alignOffset: -5,
    });
    expect(
      holdFor({ side: "right", alignOffset: -5 }, anchor, SIZE, 8, INSETS)
    ).toEqual({
      side: "right",
      sideOffset: 8,
      alignOffset: -5,
    });
  });

  it("holds a popup above its anchor by its top, where it opened", () => {
    const hold = holdFor(
      { side: "top", alignOffset: 0 },
      anchor,
      SIZE,
      8,
      INSETS
    );
    expect(hold.side).toBe("bottom");
    // Its bottom 8 px above the anchor, so its top is 300 px higher still.
    expect(corner(hold)).toEqual({ left: 400, top: 500 - 8 - 300 });
  });

  it("holds a popup left of its anchor by its left edge", () => {
    const hold = holdFor(
      { side: "left", alignOffset: 0 },
      anchor,
      SIZE,
      8,
      INSETS
    );
    expect(hold.side).toBe("right");
    expect(corner(hold)).toEqual({ left: 400 - 8 - 240, top: 500 });
  });

  it("starts a popup taller than the room above at the window's inset", () => {
    const tall = { width: 240, height: 900 };
    const hold = holdFor(
      { side: "top", alignOffset: 0 },
      anchor,
      tall,
      8,
      INSETS
    );
    expect(corner(hold).top).toBe(INSETS.top);
  });
});

describe("the anchor a placed popup was measured from", () => {
  const anchor = box(400, 300, 120, 28);
  const sideOffset = 8;

  for (const side of ["top", "right", "bottom", "left"] as const) {
    it(`reads the anchor back from a popup on its ${side}`, () => {
      const held = { side, alignOffset: -37 };
      const placed = placedBox(anchor, held, SIZE, sideOffset);
      expect(
        anchorOf(
          placed,
          { ...held, sideOffset },
          {
            width: anchor.width,
            height: anchor.height,
          }
        )
      ).toEqual(anchor);
    });
  }
});
